'use client';

import { createContext, useContext, type ButtonHTMLAttributes, type ComponentPropsWithRef, type FocusEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GripVerticalIcon } from '../icons';
import { cx, Portal } from '../primitives';
import { withUserProps } from '../primitives/prop-getters';
import { DragMoveBar, DragStartButton } from './drag-moves';
import { type SortableLayout } from './sorting';
import { useSortable, type SortableItemState, type SortableKey, type SortableLabels, type SortableMove } from './useSortable';
import './Sortable.css';
import { withRef } from '../primitives/react-compat';

export {
  defaultSortableLabels,
  type SortableItemState,
  type SortableKey,
  type SortableLabels,
  type SortableMove,
} from './useSortable';

export interface SortableProps<T> extends Omit<ComponentPropsWithRef<'ul'>, 'children' | 'onChange'> {
  /** Controlled items, in order. */
  items?: readonly T[];
  defaultItems?: readonly T[];
  /** Called after a drop that changed the order (pointer or keyboard). */
  onReorder?: (items: T[], move: SortableMove<T>) => void;
  /** Stable key of an item. Defaults to `item.id`, or the item itself for strings and numbers. */
  getKey?: (item: T) => SortableKey;
  /** Renders one item; also renders the copy that follows the pointer (`state.isOverlay`). */
  children: (item: T, state: SortableItemState) => ReactNode;
  /** `grid` matches drop positions in both directions and moves rows with ArrowUp / ArrowDown. */
  layout?: SortableLayout;
  /** Only a `SortableHandle` inside the item starts a drag; the rest of the item stays interactive. */
  handle?: boolean;
  /** Turn off reordering: no item can be picked up by pointer or keyboard, and handles are disabled. */
  disabled?: boolean;
  /** Items that can't be picked up (others can still move past them). */
  isItemDisabled?: (item: T) => boolean;
  /** Item name for announcements and handle labels. Defaults to "item 3". */
  getItemLabel?: (item: T) => string;
  labels?: Partial<SortableLabels>;
}

export interface SortableHandleProps extends ComponentPropsWithRef<'button'> {}

/** The handle's props (useSortable's getHandleProps), and whether it is one. */
interface ItemContextValue extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether the handle starts drags (Sortable `handle`); otherwise it's a decorative grip. */
  active: boolean;
  overlay: boolean;
}

const ItemContext = createContext<ItemContextValue | null>(null);

/** Placeholder, focus ring and lifted ring follow the corner radius of the item's content. */
function syncRadius(item: HTMLElement | null | undefined) {
  const content = item?.firstElementChild;
  if (item && content) item.style.setProperty('--_radius', getComputedStyle(content).borderRadius);
}

export const Sortable = withRef(function Sortable<T>({
  items,
  defaultItems,
  onReorder,
  getKey,
  children,
  layout = 'vertical',
  handle = false,
  disabled = false,
  isItemDisabled,
  getItemLabel,
  labels,
  className,
  ref,
  ...rest
}: SortableProps<T>) {
  // The order, the pointer drag, the keys, the move buttons and the announcements come from the headless hook.
  const sortable = useSortable<T>({ items, defaultItems, onReorder, getKey, layout, handle, disabled, isItemDisabled, getItemLabel, labels });
  const { overlayItem, grabbed } = sortable;

  return (
    <>
      <ul
        {...sortable.getListProps({ ...rest, ref })}
        className={cx('ui-sortable', className)}
        data-layout={layout}
      >
        {sortable.shown.map((item, index) => {
          const key = sortable.getKey(item);
          const state = sortable.getItemState(item, index);
          const isGrabbed = grabbed === key;
          const draggable = !handle && !state.disabled;
          const name = sortable.getItemLabel(item);
          return (
            <li
              key={key}
              className="ui-sortable__item"
              {...sortable.getItemProps(item, {
                // The press is where a drag begins: the lifted copy takes the content's corners.
                onPointerDown: (event: ReactPointerEvent<HTMLElement>) => syncRadius(event.currentTarget),
                onFocus: (event: FocusEvent<HTMLElement>) => syncRadius(event.currentTarget),
              })}
            >
              <ItemContext.Provider value={{ active: handle, overlay: false, ...(handle ? sortable.getHandleProps(item) : {}) }}>
                {children(item, state)}
              </ItemContext.Provider>
              {/* Without a handle, a screen reader's cursor needs a button to press: Space never reaches the item. */}
              {draggable && !isGrabbed && <DragStartButton label={sortable.labels.handle(name)} onPress={() => sortable.lift(key)} />}
              {isGrabbed && <DragMoveBar label={sortable.labels.handle(name)} onEscape={sortable.cancel} actions={sortable.getMoveActions(item)} />}
            </li>
          );
        })}
      </ul>

      {overlayItem !== undefined && (
        <Portal>
          <div className="ui-sortable__overlay" data-layout={layout} {...sortable.getOverlayProps()}>
            <div className="ui-sortable__lift">
              <ItemContext.Provider value={{ active: handle, overlay: true }}>
                {children(overlayItem, {
                  index: sortable.shown.indexOf(overlayItem),
                  isDragging: true,
                  isOverlay: true,
                  disabled: false,
                })}
              </ItemContext.Provider>
            </div>
          </div>
        </Portal>
      )}

      <p className="ui-sr-only" {...sortable.getInstructionsProps()} />
    </>
  );
});

/**
 * Drag grip for a Sortable item. With `handle` on the Sortable it is the only way to start a drag: dragged by
 * pointer or touch, or pressed (a click, a tap, Enter, Space, a screen reader's activation) to lift the item and
 * show its move buttons, and pressed again to drop it. Otherwise it is a decorative grip.
 */
export const SortableHandle = withRef(function SortableHandle({ className, children, ref, ...rest }: SortableHandleProps) {
  const item = useContext(ItemContext);
  if (!item) throw new Error('SortableHandle must be rendered inside a <Sortable> item.');
  const content = children ?? <GripVerticalIcon size={16} />;

  if (!item.active || item.overlay) {
    return (
      <span className={cx('ui-sortable__handle', className)} data-decorative="" aria-hidden="true">
        {content}
      </span>
    );
  }
  const { active: _active, overlay: _overlay, ...handleProps } = item;
  return (
    <button
      {...withUserProps(handleProps, { ...rest, ref, disabled: handleProps.disabled || rest.disabled })}
      className={cx('ui-sortable__handle', className)}
    >
      {content}
    </button>
  );
});
