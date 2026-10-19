'use client';

import { createContext, useContext, useEffect, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GripVerticalIcon } from '../icons';
import {
  composeHandlers,
  cx,
  getDirection,
  inlineArrowStep,
  mergeRefs,
  Portal,
  useControllableState,
  useLatest,
} from '../primitives';
import { edgeScrollStep } from '../data-display/kanban';
import { arrayMove, closestIndex, columnCount, keyboardTarget, type Box, type SortableLayout } from './sorting';
import './Sortable.css';
import { withRef, useId, useLayoutEffect, inertAttr, cleanupRef } from '../primitives/react-compat';

export type SortableKey = string | number;

export interface SortableItemState {
  index: number;
  /** The item is being moved: its placeholder during a pointer drag, or lifted with the keyboard. */
  isDragging: boolean;
  /** Rendering the copy that follows the pointer. */
  isOverlay: boolean;
  disabled: boolean;
}

export interface SortableMove<T> {
  item: T;
  from: number;
  to: number;
}

export interface SortableLabels {
  /** Keyboard instructions, linked to every draggable item or handle. */
  instructions: string;
  /** Accessible name of a `SortableHandle`. */
  handle: (item: string) => string;
  pickedUp: (item: string, position: number, total: number) => string;
  moved: (item: string, position: number, total: number) => string;
  dropped: (item: string, position: number, total: number) => string;
  cancelled: (item: string, position: number, total: number) => string;
}

export const defaultSortableLabels: SortableLabels = {
  instructions:
    'Press Space or Enter to pick up the item. While it is picked up, use the arrow keys to move it, Space or Enter to drop it, Escape to cancel.',
  handle: (item) => `Reorder ${item}`,
  pickedUp: (item, position, total) => `Picked up ${item}. Position ${position} of ${total}.`,
  moved: (item, position, total) => `${item}: position ${position} of ${total}.`,
  dropped: (item, position, total) => `Dropped ${item} at position ${position} of ${total}.`,
  cancelled: (item, position, total) => `Reorder cancelled. ${item} is back at position ${position} of ${total}.`,
};

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

interface ItemContextValue {
  /** Whether the handle starts drags (Sortable `handle`); otherwise it's a decorative grip. */
  active: boolean;
  /** Accessible name of the handle. */
  handleLabel: string;
  instructionsId: string;
  disabled: boolean;
  grabbed: boolean;
  overlay: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

const ItemContext = createContext<ItemContextValue | null>(null);

interface PointerDrag {
  key: SortableKey;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Released: the copy glides into its slot before the drag ends. */
  dropping: boolean;
}

/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Touch on an item needs a press-and-hold, so swipes keep scrolling the page. */
const LONG_PRESS_MS = 260;
const INTERACTIVE = 'a[href], button, input, textarea, select, [contenteditable="true"], [role="button"], [role="checkbox"], [role="switch"]';
const EMPTY: readonly never[] = [];

function defaultGetKey(item: unknown): SortableKey {
  if (typeof item === 'string' || typeof item === 'number') return item;
  const id = (item as { id?: unknown } | null)?.id;
  if (typeof id === 'string' || typeof id === 'number') return id;
  throw new Error('Sortable: items need a string or number `id`, or pass `getKey`.');
}

/** "180ms" / "0.24s" → milliseconds. */
function parseDuration(value: string) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.trim().endsWith('ms') ? n : n * 1000;
}

function motion(element: Element) {
  const style = getComputedStyle(element);
  return {
    duration: parseDuration(style.getPropertyValue('--ui-duration')),
    easing: style.getPropertyValue('--ui-ease').trim() || 'ease',
  };
}

/** Viewport box of an item's layout position, ignoring the transforms of running animations. */
function layoutBox(item: HTMLElement, list: HTMLElement, origin: DOMRect): Box {
  return {
    left: origin.left + list.clientLeft - list.scrollLeft + item.offsetLeft,
    top: origin.top + list.clientTop - list.scrollTop + item.offsetTop,
    width: item.offsetWidth,
    height: item.offsetHeight,
  };
}

/** Nearest ancestor (or the list itself) that scrolls along the list's axis; null means the window. */
/** Placeholder, focus ring and lifted ring follow the corner radius of the item's content. */
function syncRadius(item: HTMLElement | undefined) {
  const content = item?.firstElementChild;
  if (item && content) item.style.setProperty('--_radius', getComputedStyle(content).borderRadius);
}

function scrollParent(node: HTMLElement, layout: SortableLayout): HTMLElement | null {
  for (let el: HTMLElement | null = node; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    const y = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const x = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if ((layout !== 'horizontal' && y) || (layout !== 'vertical' && x)) return el;
  }
  return null;
}

export const Sortable = withRef(function Sortable<T>({
  items: itemsProp,
  defaultItems,
  onReorder,
  getKey = defaultGetKey,
  children,
  layout = 'vertical',
  handle = false,
  disabled = false,
  isItemDisabled,
  getItemLabel,
  labels: labelsProp,
  className,
  onBlur,
  ref,
  ...rest
}: SortableProps<T>) {
  const labels = { ...defaultSortableLabels, ...labelsProp };
  const [items, setItems] = useControllableState<readonly T[]>({ value: itemsProp, defaultValue: defaultItems ?? EMPTY });
  /** Live order while an item is moving (pointer drag or keyboard grab). */
  const [order, setOrder] = useState<readonly T[] | null>(null);
  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const [grabbed, setGrabbed] = useState<SortableKey | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const listRef = useRef<HTMLUListElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<SortableKey, HTMLLIElement>());
  const pointer = useRef({ x: 0, y: 0 });
  /** Item rects captured right before a reorder, for the FLIP animation. */
  const snapshot = useRef<Map<SortableKey, DOMRect> | null>(null);
  const flips = useRef(new WeakMap<Element, Animation>());
  const pendingFocus = useRef<SortableKey | null>(null);
  const suppressClick = useRef(false);
  const pressCleanup = useRef<(() => void) | null>(null);
  const baseId = useId();
  const instructionsId = `${baseId}-instructions`;

  const shown = order ?? items;
  const keySignature = JSON.stringify(shown.map(getKey));
  const latest = useLatest({ items, shown, labels, getKey, onReorder, grabbed });

  const labelOf = (item: T, index: number) => getItemLabel?.(item) ?? `item ${index + 1}`;
  const indexOfKey = (list: readonly T[], key: SortableKey) => list.findIndex((item) => latest.current.getKey(item) === key);

  const takeSnapshot = () => {
    const rects = new Map<SortableKey, DOMRect>();
    for (const [key, el] of itemRefs.current) rects.set(key, el.getBoundingClientRect());
    snapshot.current = rects;
  };

  // FLIP: items that changed place glide from where they were.
  useLayoutEffect(() => {
    const first = snapshot.current;
    snapshot.current = null;
    const list = listRef.current;
    if (!first || !list) return;
    const { duration, easing } = motion(list);
    // Reduced motion zeroes the duration tokens (1ms).
    if (duration <= 1) return;
    for (const [key, el] of itemRefs.current) {
      const from = first.get(key);
      if (!from) continue;
      flips.current.get(el)?.cancel();
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      flips.current.set(el, el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing }));
    }
  }, [keySignature]);

  // A reorder remounts nothing, but moving the focused node in the DOM can drop focus.
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    const item = itemRefs.current.get(key);
    const target = handle ? item?.querySelector<HTMLElement>('[data-sortable-handle]') : item;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  });

  // Window listeners of an unfinished press must not outlive the list.
  useEffect(
    () => () => {
      pressCleanup.current?.();
      delete document.documentElement.dataset.uiSorting;
    },
    [],
  );

  const commit = (next: readonly T[], key: SortableKey) => {
    const { items: current } = latest.current;
    const from = indexOfKey(current, key);
    const to = indexOfKey(next, key);
    if (from === -1 || to === -1 || from === to) return;
    const result = next.slice();
    setItems(result);
    latest.current.onReorder?.(result, { item: current[from], from, to });
  };

  const announce = (message: (item: string, position: number, total: number) => string, list: readonly T[], key: SortableKey) => {
    const index = indexOfKey(list, key);
    if (index === -1) return;
    setAnnouncement(message(labelOf(list[index], indexOfKey(latest.current.items, key)), index + 1, list.length));
  };

  /* ── Pointer: the item stays as a placeholder in its live slot, a copy follows the pointer ── */

  useEffect(() => {
    const list = listRef.current;
    if (!drag || drag.dropping || !list) return;
    const scroller = scrollParent(list, layout);
    let frame = 0;
    const tick = () => {
      const { x, y } = pointer.current;
      const overlay = overlayRef.current;
      if (overlay) overlay.style.transform = `translate3d(${x - drag.offsetX}px, ${y - drag.offsetY}px, 0)`;

      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (layout !== 'vertical') scroller.scrollLeft += edgeScrollStep(x, rect.left, rect.right);
        if (layout !== 'horizontal') scroller.scrollTop += edgeScrollStep(y, rect.top, rect.bottom);
      } else if (layout !== 'horizontal') {
        const dy = edgeScrollStep(y, 0, window.innerHeight);
        if (dy) window.scrollBy(0, dy);
      }

      // Skip while a reorder is still rendering: the DOM and `shown` would disagree.
      if (!snapshot.current) {
        const { shown: current, getKey: keyOf } = latest.current;
        const origin = list.getBoundingClientRect();
        const boxes: Box[] = [];
        for (const item of current) {
          const el = itemRefs.current.get(keyOf(item));
          if (el) boxes.push(layoutBox(el, list, origin));
        }
        if (boxes.length === current.length) {
          const center = { x: x - drag.offsetX + drag.width / 2, y: y - drag.offsetY + drag.height / 2 };
          const target = closestIndex(boxes, center, layout);
          const from = indexOfKey(current, drag.key);
          if (target !== -1 && from !== -1 && target !== from) {
            takeSnapshot();
            setOrder(arrayMove(current, from, target));
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // indexOfKey and takeSnapshot read refs only, so they are not dependencies.
  }, [drag, layout, latest]);

  // Released: glide the copy into the item's final slot, then end the drag.
  useLayoutEffect(() => {
    if (!drag?.dropping) return;
    const overlay = overlayRef.current;
    const item = itemRefs.current.get(drag.key);
    const list = listRef.current;
    const done = () => {
      setDrag(null);
      setOrder(null);
    };
    if (!overlay || !item || !list) {
      done();
      return;
    }
    const target = layoutBox(item, list, list.getBoundingClientRect());
    const { duration, easing } = motion(list);
    const animation = overlay.animate(
      [{ transform: overlay.style.transform }, { transform: `translate3d(${target.left}px, ${target.top}px, 0)` }],
      { duration: Math.max(duration, 1), easing, fill: 'forwards' },
    );
    animation.onfinish = done;
    animation.oncancel = done;
  }, [drag]);

  const startPress = (event: ReactPointerEvent<HTMLElement>, key: SortableKey, fromHandle: boolean) => {
    suppressClick.current = false;
    if (disabled || drag || latest.current.grabbed !== null || event.button !== 0 || !event.isPrimary) return;
    // Interactive content inside an item keeps its own behaviour.
    if (!fromHandle && (event.target as HTMLElement).closest(INTERACTIVE) !== null) return;
    const node = itemRefs.current.get(key);
    if (!node) return;
    if (fromHandle) event.preventDefault();

    const start = { x: event.clientX, y: event.clientY };
    const longPress = event.pointerType === 'touch' && !fromHandle;
    let started = false;
    let pressTimer = 0;

    const begin = () => {
      started = true;
      syncRadius(node);
      const rect = node.getBoundingClientRect();
      const { items: current } = latest.current;
      setOrder(current);
      setDrag({
        key,
        width: rect.width,
        height: rect.height,
        offsetX: start.x - rect.left,
        offsetY: start.y - rect.top,
        dropping: false,
      });
      document.documentElement.dataset.uiSorting = '';
      announce(latest.current.labels.pickedUp, current, key);
    };

    const cleanup = () => {
      window.clearTimeout(pressTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('contextmenu', onContextMenu);
      pressCleanup.current = null;
    };

    const finish = (drop: boolean) => {
      cleanup();
      if (!started) return;
      suppressClick.current = true;
      delete document.documentElement.dataset.uiSorting;
      const { items: current, shown: preview, labels: currentLabels } = latest.current;
      if (drop) {
        commit(preview, key);
        announce(currentLabels.dropped, preview, key);
      } else {
        takeSnapshot();
        setOrder(current);
        announce(currentLabels.cancelled, current, key);
      }
      setDrag((prev) => (prev ? { ...prev, dropping: true } : prev));
    };

    function onMove(e: PointerEvent) {
      if (e.pointerId !== event.pointerId) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (started) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (longPress) {
        // Moving before the hold completes means the user is scrolling.
        if (moved > 8) cleanup();
      } else if (moved > DRAG_THRESHOLD) {
        begin();
      }
    }
    function onUp(e: PointerEvent) {
      if (e.pointerId === event.pointerId) finish(true);
    }
    function onCancel(e: PointerEvent) {
      if (e.pointerId === event.pointerId) finish(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape' || !started) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
    // Once a touch drag has started, the page must not scroll under the finger.
    function onTouchMove(e: TouchEvent) {
      if (started && e.cancelable) e.preventDefault();
    }
    // A long press opens the context menu on touch devices.
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    pressCleanup.current?.();
    pressCleanup.current = cleanup;
    pointer.current = start;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    if (event.pointerType === 'touch') {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('contextmenu', onContextMenu);
    }
    if (longPress) pressTimer = window.setTimeout(begin, LONG_PRESS_MS);
  };

  /* ── Keyboard: Space/Enter lifts, arrows move, Space/Enter drops, Escape cancels ── */

  const cancelGrab = () => {
    const key = latest.current.grabbed;
    if (key === null) return;
    takeSnapshot();
    setGrabbed(null);
    setOrder(null);
    announce(labels.cancelled, latest.current.items, key);
  };

  const onItemKeyDown = (event: KeyboardEvent<HTMLElement>, key: SortableKey, itemDisabled: boolean) => {
    if (drag || disabled) return;
    const { items: current, shown: preview } = latest.current;

    if (grabbed === null) {
      if ((event.key === ' ' || event.key === 'Enter') && !itemDisabled) {
        event.preventDefault();
        setGrabbed(key);
        setOrder(current);
        announce(labels.pickedUp, current, key);
      }
      return;
    }
    if (grabbed !== key) return;

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      pendingFocus.current = key;
      // Apply the move to the items as they are now: items that arrived while this one was held must stay.
      const from = indexOfKey(current, key);
      if (from < 0) {
        // The held item was removed meanwhile: nothing to drop.
        cancelGrab();
        return;
      }
      const dropped = arrayMove(current, from, indexOfKey(preview, key));
      commit(dropped, key);
      setGrabbed(null);
      setOrder(null);
      announce(labels.dropped, dropped, key);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      pendingFocus.current = key;
      cancelGrab();
      return;
    }

    const index = indexOfKey(preview, key);
    const list = listRef.current;
    const columns =
      layout === 'grid' && list
        ? columnCount(preview.map((item) => itemRefs.current.get(latest.current.getKey(item))?.offsetTop ?? 0))
        : 1;
    const target = keyboardTarget(
      event.key,
      index,
      preview.length,
      layout,
      inlineArrowStep(event.key, getDirection(event.currentTarget)),
      columns,
    );
    if (target === null) return;
    event.preventDefault();
    if (target === index) return;
    const next = arrayMove(preview, index, target);
    takeSnapshot();
    pendingFocus.current = key;
    setOrder(next);
    announce(labels.moved, next, key);
    // Keep the moved item in view inside scrolling lists.
    requestAnimationFrame(() => itemRefs.current.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };

  const dragged = drag ? shown.find((item) => getKey(item) === drag.key) : undefined;
  const draggedIndex = drag ? indexOfKey(shown, drag.key) : -1;

  return (
    <>
      <ul
        {...rest}
        ref={mergeRefs(listRef, ref)}
        className={cx('ui-sortable', className)}
        data-layout={layout}
        data-dragging={drag ? '' : undefined}
        data-grabbing={grabbed !== null ? '' : undefined}
        onBlur={(event) => {
          onBlur?.(event);
          if (grabbed === null) return;
          const root = event.currentTarget;
          // Checked a frame later: a moved item can blur for a moment before it is refocused.
          requestAnimationFrame(() => {
            if (root.isConnected && !root.contains(document.activeElement)) cancelGrab();
          });
        }}
      >
        {shown.map((item, index) => {
          const key = getKey(item);
          const itemDisabled = disabled || !!isItemDisabled?.(item);
          const isGrabbed = grabbed === key;
          const draggable = !handle && !itemDisabled;
          const context: ItemContextValue = {
            active: handle,
            handleLabel: labels.handle(labelOf(item, indexOfKey(items, key))),
            instructionsId,
            disabled: itemDisabled,
            grabbed: isGrabbed,
            overlay: false,
            onPointerDown: handle && !itemDisabled ? (event) => startPress(event, key, true) : undefined,
            onKeyDown: handle && !itemDisabled ? (event) => onItemKeyDown(event, key, itemDisabled) : undefined,
          };
          return (
            <li
              key={key}
              ref={cleanupRef((node) => {
                if (!node) return;
                itemRefs.current.set(key, node);
                return () => {
                  if (itemRefs.current.get(key) === node) itemRefs.current.delete(key);
                };
              })}
              className="ui-sortable__item"
              data-placeholder={drag?.key === key || undefined}
              data-grabbed={isGrabbed || undefined}
              data-disabled={itemDisabled || undefined}
              data-draggable={draggable || undefined}
              tabIndex={draggable ? 0 : undefined}
              aria-describedby={draggable ? instructionsId : undefined}
              onPointerDown={draggable ? (event) => startPress(event, key, false) : undefined}
              onKeyDown={
                draggable
                  ? (event) => {
                      if (event.target === event.currentTarget) onItemKeyDown(event, key, itemDisabled);
                    }
                  : undefined
              }
              onFocus={(event) => {
                syncRadius(event.currentTarget);
                // Focus moving to another item (or its handle) puts a lifted one back.
                if (grabbed !== null && grabbed !== key) cancelGrab();
              }}
              onClickCapture={(event) => {
                if (!suppressClick.current) return;
                suppressClick.current = false;
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <ItemContext.Provider value={context}>
                {children(item, { index, isDragging: drag?.key === key || isGrabbed, isOverlay: false, disabled: itemDisabled })}
              </ItemContext.Provider>
            </li>
          );
        })}
      </ul>

      {drag && dragged !== undefined && (
        <Portal>
          <div
            ref={(node) => {
              // Positioned before the first paint so the copy never flashes at the corner.
              if (node && !node.style.transform) {
                node.style.transform = `translate3d(${pointer.current.x - drag.offsetX}px, ${pointer.current.y - drag.offsetY}px, 0)`;
              }
              overlayRef.current = node;
            }}
            className="ui-sortable__overlay"
            data-layout={layout}
            data-dropping={drag.dropping || undefined}
            style={{ width: drag.width, height: drag.height }}
            aria-hidden="true"
            inert={inertAttr(true)}
          >
            <div className="ui-sortable__lift">
              <ItemContext.Provider
                value={{ active: handle, handleLabel: '', instructionsId, disabled: false, grabbed: true, overlay: true }}
              >
                {children(dragged, { index: draggedIndex, isDragging: true, isOverlay: true, disabled: false })}
              </ItemContext.Provider>
            </div>
          </div>
        </Portal>
      )}

      <div className="ui-sr-only">
        <p id={instructionsId}>{labels.instructions}</p>
        <div aria-live="assertive" aria-atomic="true">
          {announcement}
        </div>
      </div>
    </>
  );
});

/**
 * Drag grip for a Sortable item. With `handle` on the Sortable it is the only way to start
 * a drag (pointer, touch or Space/Enter); otherwise it is a decorative grip.
 */
export const SortableHandle = withRef(function SortableHandle({ className, children, onPointerDown, onKeyDown, ref, ...rest }: SortableHandleProps) {
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
  return (
    <button
      type="button"
      aria-label={item.handleLabel}
      {...rest}
      ref={ref}
      className={cx('ui-sortable__handle', className)}
      data-sortable-handle=""
      aria-describedby={item.instructionsId}
      aria-pressed={item.grabbed || undefined}
      disabled={item.disabled || rest.disabled}
      onPointerDown={composeHandlers(onPointerDown, (event) => item.onPointerDown?.(event))}
      onKeyDown={composeHandlers(onKeyDown, (event) => item.onKeyDown?.(event))}
    >
      {content}
    </button>
  );
});
