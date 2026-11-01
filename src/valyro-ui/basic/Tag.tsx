'use client';

import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cx, isMotionReduced, mergeRefs } from '../primitives';
import { childElements } from '../primitives/compound';
import { announce } from '../primitives/liveAnnouncer';
import { animateSpring, themeSlowMs } from '../primitives/spring';
import { flipDelta, type FlipBox } from '../primitives/useFlip';
import { useControllableState } from '../primitives/useControllableState';
import { useRemovableList } from '../primitives/useRemovableList';
import { inertAttr, useLayoutEffect, withRef } from '../primitives/react-compat';
import { XIcon } from '../icons';
import type { BadgeColor, BadgeVariant } from './Badge';
import './Badge.css';
import './Tag.css';

export interface TagLabels {
  /** Accessible name of the remove button. */
  remove: (label: string) => string;
}

const defaultTagLabels: TagLabels = { remove: (label) => `Remove ${label}` };

export interface TagProps extends Omit<ComponentPropsWithRef<'span'>, 'onClick'> {
  /** Hue, as on Badge. */
  color?: BadgeColor;
  /** `subtle` tinted fill, `solid` saturated fill, `outline` a tinted ring — as on Badge. */
  variant?: BadgeVariant;
  /** Height, padding and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** An icon or a small avatar before the text. */
  icon?: ReactNode;
  /** Shows a × button; called on its click and on Delete or Backspace while the tag has focus. */
  onRemove?: () => void;
  /** Makes the tag's text a button (a filter, "open"). */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Makes the tag's text a link. */
  href?: string;
  /** Neither the text nor the × responds. */
  disabled?: boolean;
  /** The tag's text for the remove button's name and announcements, when the children are not plain text. */
  textValue?: string;
  labels?: Partial<TagLabels>;
}

/** What a TagGroup tells the tags it wraps. */
interface TagItemContextValue {
  /** Removes the item (data mode). */
  remove?: () => void;
  /** Called before a tag's own onRemove: focus moves on and the removal is announced. */
  willRemove: (label: string) => void;
}

const TagItemContext = createContext<TagItemContextValue | null>(null);

const textOf = (children: ReactNode): string =>
  typeof children === 'string' || typeof children === 'number'
    ? String(children)
    : Array.isArray(children)
      ? children.map(textOf).join('')
      : isValidElement(children)
        ? textOf((children.props as { children?: ReactNode }).children)
        : '';

export const Tag = withRef(function Tag({
  color = 'gray',
  variant = 'subtle',
  size = 'md',
  icon,
  onRemove: onRemoveProp,
  onClick,
  href,
  disabled = false,
  textValue,
  labels: labelsProp,
  className,
  children,
  onKeyDown,
  ...rest
}: TagProps) {
  const labels = { ...defaultTagLabels, ...labelsProp };
  const item = useContext(TagItemContext);
  const text = textValue ?? textOf(children);
  const removeOwn = onRemoveProp ?? item?.remove;
  const remove = removeOwn
    ? () => {
        if (disabled) return;
        item?.willRemove(text);
        removeOwn();
      }
    : undefined;

  const content = (
    <>
      {icon && <span className="ui-tag__icon">{icon}</span>}
      {children != null && children !== false && <span className="ui-tag__label">{children}</span>}
    </>
  );

  return (
    <span
      {...rest}
      className={cx('ui-tag ui-badge', className)}
      data-color={color}
      data-variant={variant}
      data-size={size}
      data-removable={remove ? '' : undefined}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !remove) return;
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          remove();
        }
      }}
    >
      {href != null ? (
        <a className="ui-tag__action" href={disabled ? undefined : href} aria-disabled={disabled || undefined}>
          {content}
        </a>
      ) : onClick ? (
        <button type="button" className="ui-tag__action" onClick={onClick} disabled={disabled}>
          {content}
        </button>
      ) : (
        content
      )}
      {remove && (
        <button type="button" className="ui-tag__remove" aria-label={labels.remove(text)} disabled={disabled} onClick={remove}>
          <XIcon aria-hidden="true" />
        </button>
      )}
    </span>
  );
});

/* ---------------------------------------------------------------------------------------------- TagGroup */

export interface TagGroupLabels {
  /** The button that shows the tags past `max`. */
  more: (hidden: number) => string;
  /** The button that hides them again. */
  less: string;
  /** Announced after a tag is removed. */
  removed: (label: string) => string;
}

const defaultGroupLabels: TagGroupLabels = {
  more: (hidden) => `+${hidden}`,
  less: 'Show less',
  removed: (label) => `Removed ${label}`,
};

export interface TagGroupProps<T = string> extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'defaultValue'> {
  /** Data mode: the items, one tag each (`renderTag`); removing one updates them and keeps focus in the group. */
  items?: readonly T[];
  defaultItems?: readonly T[];
  onItemsChange?: (items: T[]) => void;
  /** A stable key per item. Default: the item itself, or its `id`, `value` or `label`. */
  getKey?: (item: T) => string;
  /** The item's text for announcements. Default: the item itself, or its `label` or `name`. */
  getLabel?: (item: T) => string;
  /** The tag of an item. Default: a `Tag` with its label. */
  renderTag?: (item: T) => ReactNode;
  /** Data mode: tags get a × that removes them. Default true. */
  removable?: boolean;
  /** Or plain `Tag` children, each with a `key` (they glide out and close ranks when you remove one). */
  children?: ReactNode;
  /** Show at most this many tags, then a "+N" button that shows the rest. */
  max?: number;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Size of the "+N" button, to match the tags. */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name of the list. */
  label?: string;
  /** Where focus goes when the last tag is removed (the input of a tags field). */
  fallbackFocus?: RefObject<HTMLElement | null>;
  labels?: Partial<TagGroupLabels>;
}

const MORE_KEY = '__ui-tag-more__';
const FLIP_ID = 'ui-tag-flip';
const ITEMS = ':scope > [data-tag-key]:not([data-exiting])';

type Boxes = Map<string, FlipBox>;

function measure(root: HTMLElement): Boxes {
  const origin = root.getBoundingClientRect();
  const map: Boxes = new Map();
  for (const element of root.querySelectorAll<HTMLElement>(ITEMS)) {
    const rect = element.getBoundingClientRect();
    map.set(element.dataset.tagKey ?? '', { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
  }
  return map;
}

function defaultKey(item: unknown): string {
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    return String(record.id ?? record.value ?? record.key ?? record.label);
  }
  return String(item);
}

function defaultLabel(item: unknown): string {
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    return String(record.label ?? record.name ?? record.value ?? '');
  }
  return String(item);
}

interface Entry {
  key: string;
  node: ReactNode;
  /** Index among the shown tags (the "+N" button has none). */
  index: number;
}

interface Exit {
  key: string;
  node: ReactNode;
  box: FlipBox;
}

/**
 * Removed tags leave on their own (fade and shrink, out of the flow where they stood) while the others glide
 * into the gap on a spring and the list's height follows: the layout before a change is read while React
 * renders it, the one after in a layout effect, and the difference plays as a FLIP.
 */
function useTagMotion(rootRef: RefObject<HTMLDivElement | null>, entries: Entry[]) {
  const keyString = entries.map((entry) => entry.key).join('\n');
  const committed = useRef<{ keys: string; list: Entry[] } | null>(null);
  const before = useRef<{ keys: string; boxes: Boxes; height: number } | null>(null);
  const [exits, setExits] = useState<Exit[]>([]);

  // The layout the change starts from: read while the DOM still shows the last commit, moves in flight included.
  const root = rootRef.current;
  if (root && committed.current && committed.current.keys !== keyString && before.current?.keys !== keyString) {
    before.current = { keys: keyString, boxes: measure(root), height: root.getBoundingClientRect().height };
  }

  useLayoutEffect(() => {
    const element = rootRef.current;
    const last = committed.current;
    committed.current = { keys: keyString, list: entries };
    const start = before.current;
    before.current = null;
    if (!element || !last || !start || last.keys === keyString) return;
    const reduced = isMotionReduced(element);
    const now = new Set(entries.map((entry) => entry.key));
    const gone = last.list.filter((entry) => !now.has(entry.key) && start.boxes.has(entry.key));

    if (reduced) return;
    // Measure the new layout without the moves still playing.
    const items = [...element.querySelectorAll<HTMLElement>(ITEMS)];
    for (const item of items) for (const running of item.getAnimations()) if (running.id === FLIP_ID) running.cancel();
    for (const running of element.getAnimations()) if (running.id === FLIP_ID) running.cancel();
    const after = measure(element);
    const height = element.getBoundingClientRect().height;

    if (gone.length) {
      setExits((current) => [
        ...current.filter((exit) => !now.has(exit.key) && !gone.some((entry) => entry.key === exit.key)),
        ...gone.map((entry) => ({ key: entry.key, node: entry.node, box: start.boxes.get(entry.key)! })),
      ]);
    }
    for (const item of items) {
      const key = item.dataset.tagKey ?? '';
      const to = after.get(key);
      const from = start.boxes.get(key);
      if (!to) continue;
      if (!from) {
        // A tag that appears (added, or shown by "+N"): fades in and grows from a little smaller.
        const fade = item.animate({ opacity: [0, 1] }, { duration: themeSlowMs(item) * 0.6, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
        fade.id = FLIP_ID;
        const grow = animateSpring(item, { scale: ['0.9', '1'] }, 'snappy');
        if (grow) grow.id = FLIP_ID;
        continue;
      }
      const resized = Math.abs(from.width - to.width) > 1;
      if (resized) {
        // A button whose label changed ("+3" → "Show less") grows to its new width from its start edge.
        const grow = animateSpring(item.querySelector('.ui-tag-group__more') ?? item, { width: [`${from.width}px`, `${to.width}px`] }, 'smooth');
        if (grow) grow.id = FLIP_ID;
      }
      const delta = flipDelta(from, to);
      if (!delta) continue;
      const rtl = resized && getComputedStyle(item).direction === 'rtl';
      // With the width animated, the start edge travels (centres would drift by half the change).
      const x = resized ? (rtl ? from.left + from.width - (to.left + to.width) : from.left - to.left) : delta.x;
      if (Math.abs(x) < 0.5 && Math.abs(delta.y) < 0.5) continue;
      const move = animateSpring(item, { translate: [`${x}px ${delta.y}px`, '0px 0px'] }, 'snappy');
      if (move) move.id = FLIP_ID;
    }
    if (Math.abs(height - start.height) > 0.5) {
      const grow = animateSpring(element, { height: [`${start.height}px`, `${height}px`] }, 'smooth');
      if (grow) grow.id = FLIP_ID;
    }
  });

  const done = (key: string) => setExits((current) => current.filter((exit) => exit.key !== key));
  // A safety net: an exit whose animation never ends (a hidden tab) still leaves.
  useEffect(() => {
    if (!exits.length) return;
    const timer = setTimeout(() => setExits([]), 1500);
    return () => clearTimeout(timer);
  }, [exits]);
  return { exits: exits.filter((exit) => !entries.some((entry) => entry.key === exit.key)), done };
}

export const TagGroup = withRef(function TagGroup<T = string>({
  items: itemsProp,
  defaultItems,
  onItemsChange,
  getKey = defaultKey,
  getLabel = defaultLabel,
  renderTag,
  removable = true,
  children,
  max,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  size = 'md',
  label,
  fallbackFocus,
  labels: labelsProp,
  className,
  ref,
  ...rest
}: TagGroupProps<T>) {
  const labels = { ...defaultGroupLabels, ...labelsProp };
  const dataMode = itemsProp !== undefined || defaultItems !== undefined;
  const [items, setItems] = useControllableState<readonly T[]>({ value: itemsProp, defaultValue: defaultItems ?? [], onChange: onItemsChange as ((items: readonly T[]) => void) | undefined });
  const [expanded, setExpanded] = useControllableState({ value: expandedProp, defaultValue: defaultExpanded, onChange: onExpandedChange });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRoot = useMemo(() => mergeRefs(rootRef, ref), [ref]);

  const focusTarget = (index: number) => {
    const item = rootRef.current?.querySelectorAll<HTMLElement>(`${ITEMS}:not([data-tag-key="${MORE_KEY}"])`)[index];
    return item?.querySelector<HTMLElement>('.ui-tag__remove:not(:disabled), .ui-tag__action, button, a[href]');
  };
  const removable_ = useRemovableList({ getElement: focusTarget, fallback: () => fallbackFocus?.current ?? rootRef.current?.querySelector<HTMLElement>('.ui-tag-group__more') });

  // Every tag in order, keyed: from the data or from the children.
  const all: { key: string; node: (index: number) => ReactNode; data?: T }[] = dataMode
    ? items.map((item) => ({ key: getKey(item), data: item, node: () => (renderTag ? renderTag(item) : <Tag>{getLabel(item)}</Tag>) }))
    : childElements(children).map((child, index) => ({ key: child.key != null ? String(child.key) : `__ui-tag-${index}__`, node: () => child }));
  const limited = max != null && max >= 0 && all.length > max;
  const shown = limited && !expanded ? all.slice(0, max) : all;

  const willRemove = (key: string, text: string) => {
    const index = shown.findIndex((entry) => entry.key === key);
    const holder = rootRef.current?.querySelector(`${ITEMS}[data-tag-key="${CSS.escape(key)}"]`);
    if (index >= 0) removable_.removeAt(index, shown.length, holder);
    if (text) announce(labels.removed(text), 'polite');
  };

  const entries: Entry[] = shown.map((entry, index) => {
    const context: TagItemContextValue = {
      remove:
        dataMode && removable
          ? () => setItems((current) => current.filter((item) => getKey(item) !== entry.key))
          : undefined,
      willRemove: (text) => willRemove(entry.key, text || (entry.data !== undefined ? getLabel(entry.data) : '')),
    };
    return { key: entry.key, index, node: <TagItemContext.Provider value={context}>{entry.node(index)}</TagItemContext.Provider> };
  });
  if (limited) {
    entries.push({
      key: MORE_KEY,
      index: -1,
      node: (
        <button type="button" className="ui-tag-group__more" data-size={size} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          <span key={expanded ? 'less' : 'more'} className="ui-tag-group__more-label">
            {expanded ? labels.less : labels.more(all.length - (max ?? 0))}
          </span>
        </button>
      ),
    });
  }

  const { exits, done } = useTagMotion(rootRef, entries);

  return (
    <div
      role="list"
      aria-label={label}
      {...rest}
      ref={setRoot}
      className={cx('ui-tag-group', className)}
    >
      {entries.map((entry) => (
        <span key={entry.key} role="listitem" className="ui-tag-group__item" data-tag-key={entry.key}>
          {entry.node}
        </span>
      ))}
      {exits.map((exit) => (
        <span
          key={`exit:${exit.key}`}
          className="ui-tag-group__item"
          data-tag-key={exit.key}
          data-exiting=""
          aria-hidden="true"
          inert={inertAttr(true)}
          style={{ left: exit.box.left, top: exit.box.top, width: exit.box.width, height: exit.box.height }}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) done(exit.key);
          }}
        >
          {exit.node}
        </span>
      ))}
    </div>
  );
});
