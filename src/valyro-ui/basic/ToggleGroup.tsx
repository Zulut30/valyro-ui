'use client';

import { useMemo, useRef, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { withRef, useLayoutEffect } from '../primitives/react-compat';
import { revealInList, useOverflowScroll, useSlidingIndicator, type IndicatorRect } from '../navigation/internal';
import { Tooltip } from './Tooltip';
import { useToggleGroup, type ToggleGroupType, type ToggleGroupValue } from './useToggleGroup';
import '../primitives/motion.css';
import './ToggleGroup.css';

export interface ToggleGroupOption {
  value: string;
  /** Visible text; leave it out for an icon-only button (then `label` is required). */
  children?: ReactNode;
  icon?: ReactNode;
  /** Accessible name and tooltip of an icon-only button. */
  label?: string;
  disabled?: boolean;
}

export interface ToggleGroupLabels {
  /** Accessible name of the group when neither `aria-label` nor `aria-labelledby` is given. */
  group: string;
}

const defaultLabels: ToggleGroupLabels = { group: 'Options' };

export type ToggleGroupProps<M extends ToggleGroupType = 'single'> = Omit<
  ComponentPropsWithRef<'div'>,
  'defaultValue' | 'onChange' | 'children'
> & {
  /** The buttons in order. Or compose them as children: `ToggleGroup.Item`. */
  items?: readonly ToggleGroupOption[];
  /** The compound form instead of `items`: `ToggleGroup.Item` elements. */
  children?: ReactNode;
  /** `single`: at most one pressed (alignment); `multiple`: any number (bold, italic, underline). */
  type?: M;
  /** The pressed value (`single`, null for none) or values (`multiple`). */
  value?: ToggleGroupValue<M>;
  defaultValue?: ToggleGroupValue<M>;
  onValueChange?: (value: ToggleGroupValue<M>) => void;
  /** `single`: pressing the pressed button releases it. */
  allowEmpty?: boolean;
  /** A row or a column; arrow keys follow it. */
  orientation?: 'horizontal' | 'vertical';
  /** Arrow keys wrap from the last button to the first. */
  loop?: boolean;
  /** Disables every button. */
  disabled?: boolean;
  /** Joined into one control on a shared track; `false` spaces the buttons apart and lets the row wrap. */
  attached?: boolean;
  /** Button height and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** `single`: one pressed fill slides between the buttons instead of each button filling on its own. */
  indicator?: boolean;
  labels?: Partial<ToggleGroupLabels>;
};

export interface ToggleGroupItemProps extends ToggleGroupOption {}

/** A button of the compound form (`ToggleGroup.Item`): the props of a ToggleGroupOption. */
export const ToggleGroupItem = collectionPart<ToggleGroupItemProps>('ToggleGroup.Item');

/** The indicator's box, kept while nothing is pressed so it can fade out where it was. */
function useIndicatorBox(rect: IndicatorRect | null) {
  const last = useRef<IndicatorRect | null>(null);
  const wasHidden = useRef(true);
  const box = rect ?? last.current;
  // Coming back from hidden (or the first measure), it appears in place instead of sliding from the old spot.
  const jump = !!rect && (rect.instant || wasHidden.current);
  useLayoutEffect(() => {
    if (rect) last.current = rect;
    wasHidden.current = !rect;
  });
  return { box, visible: !!rect, jump };
}

export const ToggleGroup = withRef(function ToggleGroup<M extends ToggleGroupType = 'single'>({
  items: itemsProp,
  children,
  type,
  value,
  defaultValue,
  onValueChange,
  allowEmpty = true,
  orientation = 'horizontal',
  loop = true,
  disabled = false,
  attached = true,
  size = 'md',
  indicator = false,
  labels: labelsProp,
  className,
  ...rest
}: ToggleGroupProps<M>) {
  const labels = { ...defaultLabels, ...labelsProp };
  const items = useMemo(
    () => itemsProp ?? partsOf<ToggleGroupItemProps>(children, ToggleGroupItem).map(({ props }) => ({ ...props })),
    [itemsProp, children],
  );
  // The state, keys and ARIA come from the headless hook, so `useToggleGroup` builds the same group.
  const group = useToggleGroup<M>({ items, type, value, defaultValue, onValueChange, allowEmpty, orientation, loop, disabled });
  const sliding = indicator && type !== 'multiple';
  const listRef = useRef<HTMLDivElement>(null);
  const pressedKey = group.pressed.join('\n');
  const rect = useSlidingIndicator(listRef, sliding ? pressedKey : null, ':scope > [data-state="on"]');
  const { box, visible, jump } = useIndicatorBox(sliding ? rect : null);
  const scrolls = attached && orientation === 'horizontal';
  useOverflowScroll(listRef, scrolls ? items.length : -1, scrolls ? ':scope > [data-state="on"]' : undefined);

  // A pressed button scrolled out of a narrow row comes back into view.
  useLayoutEffect(() => {
    const list = listRef.current;
    const on = list?.querySelector<HTMLElement>(':scope > [data-state="on"]');
    if (list?.getAttribute('data-overflow') === 'true' && on) revealInList(list, on);
  }, [pressedKey]);

  const named = rest['aria-label'] != null || rest['aria-labelledby'] != null;

  return (
    <div
      {...group.getGroupProps({
        'aria-label': named ? undefined : labels.group,
        ...rest,
        className: cx('ui-toggle-group', className),
        'data-size': size,
        'data-attached': attached || undefined,
        'data-indicator': sliding || undefined,
        'data-indicator-ready': (sliding && box != null) || undefined,
      })}
    >
      <div
        ref={listRef}
        className="ui-toggle-group__viewport"
        onFocus={(event) => {
          // Tab or an arrow onto a button past the faded edge scrolls it clear of the fade.
          const list = listRef.current;
          if (list?.getAttribute('data-overflow') === 'true' && event.target.parentElement === list) revealInList(list, event.target);
        }}
      >
        {items.map((item) => {
          const iconOnly = item.children == null;
          const button = (
            <button
              key={item.value}
              {...group.getItemProps(item, {
                className: 'ui-toggle-group__item',
                'aria-label': iconOnly ? item.label : undefined,
                'data-icon-only': iconOnly || undefined,
              })}
            >
              {item.icon && <span className="ui-toggle-group__icon">{item.icon}</span>}
              {!iconOnly && <span className="ui-toggle-group__label">{item.children}</span>}
            </button>
          );
          return iconOnly && item.label ? (
            <Tooltip key={item.value} content={item.label}>
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
        {sliding && box && (
          <span
            className="ui-toggle-group__indicator"
            aria-hidden="true"
            data-hidden={!visible || undefined}
            data-jump={jump || undefined}
            style={
              {
                width: box.width,
                height: box.height,
                transform: `translate(${box.left}px, ${box.top}px)`,
              } as CSSProperties
            }
          />
        )}
      </div>
    </div>
  );
}, { Item: ToggleGroupItem });
