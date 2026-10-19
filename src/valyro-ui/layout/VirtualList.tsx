'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type Key, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cx, mergeRefs, useControllableState, useLatest, useVirtualizer } from '../primitives';
import { findTypeaheadMatch } from '../primitives/useListNavigation';
import { Spinner } from '../basic/Spinner';
import './VirtualList.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export interface VirtualListItemState {
  /** Highlighted by the keyboard (listbox mode). */
  active: boolean;
  selected: boolean;
  disabled: boolean;
}

export interface VirtualListLabels {
  /** Loading row text and its screen-reader announcement. */
  loading: string;
  empty: string;
}

export const defaultVirtualListLabels: VirtualListLabels = {
  loading: 'Loading more…',
  empty: 'No items',
};

export interface VirtualListProps<T> extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'defaultValue'> {
  /** All items; only those near the viewport are rendered. */
  items: readonly T[];
  /** Renders one item's content; `state` carries its active, selected and disabled flags in listbox mode. */
  renderItem: (item: T, index: number, state: VirtualListItemState) => ReactNode;
  /** Stable key per item, used for selection and to keep measured sizes. Defaults to `item.id`, then the index. */
  getItemKey?: (item: T, index: number) => Key;
  /** Accessible name of the list. */
  label?: string;
  /** Height of the scrolling viewport. */
  height?: CSSProperties['height'];
  /** Every item has this height in px: nothing is measured, which is the fastest mode (100k+ rows). */
  itemSize?: number;
  /** Starting guess for measured items (when `itemSize` is not set). */
  estimatedItemSize?: number;
  /** Space between items, in px. */
  gap?: number;
  /** Space before the first and after the last item, in px. */
  padding?: number;
  /** Items rendered beyond each edge of the viewport. */
  overscan?: number;
  /**
   * `single` / `multiple` turn the list into a listbox with keyboard navigation (arrows, Home/End,
   * Page Up/Down, type-ahead with `getItemText`) and selection. `none` with `onAction` is a
   * navigable listbox without selection; otherwise a plain list.
   */
  selectionMode?: 'none' | 'single' | 'multiple';
  selected?: Key[];
  defaultSelected?: Key[];
  onSelectedChange?: (keys: Key[]) => void;
  /** Called on Enter or click. */
  onAction?: (item: T, index: number) => void;
  /** Text for type-ahead (listbox mode). */
  getItemText?: (item: T) => string;
  /** Items skipped by keyboard navigation, type-ahead, clicks and selection (listbox mode). */
  isItemDisabled?: (item: T, index: number) => boolean;
  /** Section of an item; consecutive items with the same section get a header. Items must already be in section order. */
  getSection?: (item: T, index: number) => string;
  /** Content of a section header. Defaults to the section name. */
  renderSectionHeader?: (section: string) => ReactNode;
  /** Keeps the current section's header pinned to the top. */
  stickySectionHeaders?: boolean;
  /** Header height in px when `itemSize` is set (measured otherwise). */
  sectionHeaderSize?: number;
  /** Called once per item count when the end is within `threshold` px, to load the next page. */
  onEndReached?: () => void;
  /** Called once per item count when the start is within `threshold` px, to load older items (chat). */
  onStartReached?: () => void;
  /** Distance from an end, in px, that counts as reaching it. */
  threshold?: number;
  /** Shows a loading row at the end (or at the start while loading older items with `onStartReached`). */
  loading?: boolean | 'start' | 'end';
  /** Starts at the last item and keeps following new ones while scrolled to the end — for chat and logs. */
  followOutput?: boolean;
  /** `panel` frames the viewport like a card; `plain` leaves it bare for use inside other surfaces. */
  variant?: 'panel' | 'plain';
  /** Hairlines between items. */
  dividers?: boolean;
  /** Replaces the default empty state. */
  empty?: ReactNode;
  labels?: Partial<VirtualListLabels>;
}

type Row = { kind: 'item'; index: number } | { kind: 'header'; section: string } | { kind: 'loading' };

function defaultItemKey(item: unknown, index: number): Key {
  const id = item != null && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
  return typeof id === 'string' || typeof id === 'number' ? id : index;
}

/** An item remembered by key, with the index it last had as a hint. */
export interface VirtualListKeyRef {
  key: Key;
  index: number;
}

/**
 * Current index of a remembered item: its last index while nothing moved, otherwise a scan (items
 * were added above it, e.g. older messages loaded at the start). -1 once the item is gone. The hint
 * is updated in place so the scan runs once per shift.
 */
export function indexOfKeyRef<T>(items: readonly T[], getItemKey: (item: T, index: number) => Key, ref: VirtualListKeyRef | null): number {
  if (!ref) return -1;
  if (ref.index < items.length && getItemKey(items[ref.index], ref.index) === ref.key) return ref.index;
  for (let i = 0; i < items.length; i++) {
    if (getItemKey(items[i], i) === ref.key) {
      ref.index = i;
      return i;
    }
  }
  return -1;
}

/**
 * Index of the active item. When it was removed (deleted, archived), the item that took its place becomes
 * active, so the keyboard goes on from there instead of jumping to the top; the ref follows it in place.
 */
export function resolveActiveRef<T>(items: readonly T[], getItemKey: (item: T, index: number) => Key, ref: VirtualListKeyRef | null): number {
  const index = indexOfKeyRef(items, getItemKey, ref);
  if (index >= 0 || !ref || items.length === 0) return index;
  const next = Math.min(ref.index, items.length - 1);
  ref.key = getItemKey(items[next], next);
  ref.index = next;
  return next;
}

const isEditableTarget = (target: EventTarget) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * A windowed list: renders only what is on screen, so 100k rows scroll smoothly. Fixed or
 * measured item sizes, optional listbox keyboard model and selection, sticky section headers,
 * and infinite loading at either end (with a stable scroll position when older items are prepended).
 */
export const VirtualList = withRef(function VirtualList<T>({
  items,
  renderItem,
  getItemKey = defaultItemKey,
  label,
  height = 400,
  itemSize,
  estimatedItemSize = 48,
  gap = 0,
  padding = 0,
  overscan = 6,
  selectionMode = 'none',
  selected: selectedProp,
  defaultSelected = [],
  onSelectedChange,
  onAction,
  getItemText,
  isItemDisabled,
  getSection,
  renderSectionHeader,
  stickySectionHeaders = true,
  sectionHeaderSize = 32,
  onEndReached,
  onStartReached,
  threshold = 240,
  loading = false,
  followOutput = false,
  variant = 'panel',
  dividers = false,
  empty,
  labels: labelsProp,
  className,
  style,
  ref,
  onKeyDown,
  onFocus,
  ...rest
}: VirtualListProps<T>) {
  const labels = { ...defaultVirtualListLabels, ...labelsProp };
  const scrollRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [selected, setSelected] = useControllableState({ value: selectedProp, defaultValue: defaultSelected, onChange: onSelectedChange });
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // The active item by key: items prepended by onStartReached must not move it to another item.
  const [active, setActiveRef] = useState<VirtualListKeyRef | null>(null);
  const interactive = selectionMode !== 'none' || onAction !== undefined;
  const loadingAt = loading === true ? 'end' : loading || null;

  // Flat rows: section headers between items, plus the loading row. Plain lists skip the array.
  const rows = useMemo<Row[] | null>(() => {
    if (!getSection && !loadingAt) return null;
    const out: Row[] = [];
    if (loadingAt === 'start') out.push({ kind: 'loading' });
    let section: string | undefined;
    items.forEach((item, index) => {
      if (getSection) {
        const next = getSection(item, index);
        if (next !== section) out.push({ kind: 'header', section: next });
        section = next;
      }
      out.push({ kind: 'item', index });
    });
    if (loadingAt === 'end') out.push({ kind: 'loading' });
    return out;
  }, [items, getSection, loadingAt]);
  const rowCount = rows ? rows.length : items.length;
  const rowAt = useCallback((row: number): Row => (rows ? rows[row] : { kind: 'item', index: row }), [rows]);
  // Item index → row index, for scrolling to and rendering the active item.
  const rowOfItem = useMemo(() => {
    if (!rows) return (index: number) => index;
    const map = new Int32Array(items.length);
    rows.forEach((row, i) => {
      if (row.kind === 'item') map[row.index] = i;
    });
    return (index: number) => map[index];
  }, [rows, items.length]);

  const rowKey = useCallback(
    (row: number): Key => {
      const r = rowAt(row);
      if (r.kind === 'header') return `§${r.section}`;
      if (r.kind === 'loading') return '§loading';
      return getItemKey(items[r.index], r.index);
    },
    [rowAt, getItemKey, items],
  );
  const estimateSize = useMemo(() => {
    if (!rows) return itemSize ?? estimatedItemSize;
    const loadingSize = itemSize ?? 48;
    return (row: number) => {
      const kind = rows[row].kind;
      if (kind === 'header') return sectionHeaderSize;
      if (kind === 'loading') return loadingSize;
      return itemSize ?? estimatedItemSize;
    };
  }, [rows, itemSize, estimatedItemSize, sectionHeaderSize]);

  // Following the output: true at the end, false once the user scrolls back up. Registered before
  // the virtualizer's listener, which re-renders synchronously, so the state is current by then.
  const atEnd = useRef(followOutput);
  const lastTop = useRef(0);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const track = () => {
      if (element.scrollHeight - element.scrollTop - element.clientHeight <= 2) atEnd.current = true;
      else if (element.scrollTop < lastTop.current - 1) atEnd.current = false;
      lastTop.current = element.scrollTop;
    };
    element.addEventListener('scroll', track, { passive: true });
    return () => element.removeEventListener('scroll', track);
  }, []);

  const v = useVirtualizer({
    count: rowCount,
    scrollRef,
    estimateSize,
    getItemKey: rowKey,
    overscan,
    gap,
    paddingStart: padding,
    paddingEnd: padding,
    initialSize: typeof height === 'number' ? height : 400,
    preserveScrollOnPrepend: true,
  });
  const measured = itemSize === undefined;

  /* ── Infinite loading and following the output ── */
  const reported = useRef({ start: -1, end: -1 });
  // Another data set (a new filter's first page can have the same length): its ends are new.
  const firstKey = items.length > 0 ? getItemKey(items[0], 0) : null;
  const seenFirstKey = useRef(firstKey);
  if (seenFirstKey.current !== firstKey) {
    seenFirstKey.current = firstKey;
    reported.current = { start: -1, end: -1 };
  }
  // A load that ended without new items (it failed) may be asked again, but only by a new scroll, not in a loop.
  const retry = useRef(false);
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !loadingAt) retry.current = true;
    wasLoading.current = loadingAt !== null;
  }, [loadingAt]);
  const callbacks = useLatest({ onEndReached, onStartReached, loading: loadingAt !== null });
  const lastScrollTop = useRef(0);
  const checkEnds = useCallback(
    (event?: Event) => {
      const element = scrollRef.current;
      if (!element) return;
      const fromEnd = element.scrollHeight - element.scrollTop - element.clientHeight;
      const moved = element.scrollTop - lastScrollTop.current;
      lastScrollTop.current = element.scrollTop;
      const { onEndReached: end, onStartReached: start, loading: busy } = callbacks.current;
      if (busy || items.length === 0) return;
      // A retry needs a scroll towards that end: the browser clamping scrollTop as the loading row goes away
      // also fires `scroll`, and with followOutput that would retry a failing load forever.
      const again = event !== undefined && retry.current;
      if (end && fromEnd <= threshold && (reported.current.end !== items.length || (again && moved > 0))) {
        reported.current.end = items.length;
        retry.current = false;
        end();
      }
      if (start && element.scrollTop <= threshold && (reported.current.start !== items.length || (again && moved < 0))) {
        reported.current.start = items.length;
        retry.current = false;
        start();
      }
    },
    [callbacks, items.length, threshold],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener('scroll', checkEnds, { passive: true });
    return () => element.removeEventListener('scroll', checkEnds);
  }, [checkEnds]);
  // Content shorter than the viewport never scrolls: check after every change too.
  useEffect(() => checkEnds(), [checkEnds, v.range.start, v.range.end, loadingAt]);

  // While following, every commit re-aims at the end: new items, and heights that change as
  // fonts load or the width changes, would otherwise leave the newest message out of view.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!followOutput || !atEnd.current || !element || rowCount === 0) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 1) v.scrollToIndex(rowCount - 1, { align: 'end' });
  });

  /* ── Listbox keyboard model ── */
  const disabledAt = (index: number) => isItemDisabled?.(items[index], index) ?? false;
  const step = (from: number, delta: number) => {
    for (let i = from + delta; i >= 0 && i < items.length; i += delta) if (!disabledAt(i)) return i;
    return from;
  };
  const keyOf = (index: number) => getItemKey(items[index], index);
  const setActive = (index: number) => setActiveRef({ key: keyOf(index), index });
  const activeIndex = resolveActiveRef(items, getItemKey, active);
  const moveTo = (index: number) => {
    if (index < 0 || index >= items.length) return;
    setActive(index);
    v.scrollToIndex(rowOfItem(index), { align: 'auto' });
  };
  const anchor = useRef<VirtualListKeyRef | null>(null);
  /** Single: selects. Multiple: toggles, or with `range` adds everything from the last toggled item. */
  const select = (index: number, { range = false } = {}) => {
    if (selectionMode === 'none' || disabledAt(index)) return;
    const key = keyOf(index);
    const anchorIndex = indexOfKeyRef(items, getItemKey, anchor.current);
    if (selectionMode === 'single') {
      setSelected([key]);
    } else if (range && anchorIndex >= 0) {
      const [a, b] = [Math.min(anchorIndex, index), Math.max(anchorIndex, index)];
      const next = new Set(selected);
      for (let i = a; i <= b; i++) if (!disabledAt(i)) next.add(keyOf(i));
      setSelected([...next]);
    } else {
      setSelected(selectedSet.has(key) ? selected.filter((k) => k !== key) : [...selected, key]);
    }
    if (!range) anchor.current = { key, index };
  };

  const typeahead = useRef({ query: '', at: 0 });
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !interactive || items.length === 0 || isEditableTarget(event.target)) return;
    const visible = Math.max(1, v.range.end - v.range.start - 1);
    const current = activeIndex;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
        next = current < 0 ? step(-1, 1) : step(current, 1);
        break;
      case 'ArrowUp':
        next = current < 0 ? step(items.length, -1) : step(current, -1);
        break;
      case 'Home':
        next = step(-1, 1);
        break;
      case 'End':
        next = step(items.length, -1);
        break;
      // A page jump lands on the nearest enabled item at or before (after) the target.
      case 'PageDown':
        next = step(Math.min(items.length - 1, Math.max(current, 0) + visible) + 1, -1);
        break;
      case 'PageUp':
        next = step(Math.max(0, current - visible) - 1, 1);
        break;
      case 'Enter':
        if (current < 0 || disabledAt(current)) return;
        event.preventDefault();
        if (selectionMode === 'single') select(current);
        onAction?.(items[current], current);
        return;
      case ' ':
        if (current < 0 || selectionMode === 'none') break;
        event.preventDefault();
        select(current, { range: event.shiftKey });
        return;
      case 'a':
        if (selectionMode === 'multiple' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          setSelected(items.flatMap((item, index) => (disabledAt(index) ? [] : [getItemKey(item, index)])));
          return;
        }
        break;
    }
    if (next !== null) {
      event.preventDefault();
      moveTo(next);
      if (event.shiftKey && selectionMode === 'multiple' && next !== current) select(next, { range: true });
      return;
    }
    if (getItemText && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = event.timeStamp;
      const query = (now - typeahead.current.at > 700 ? '' : typeahead.current.query) + event.key.toLowerCase();
      typeahead.current = { query, at: now };
      const match = findTypeaheadMatch(items.length, query, current, (i) => getItemText(items[i]), disabledAt);
      if (match >= 0) {
        event.preventDefault();
        moveTo(match);
      }
    }
  };

  const optionId = (index: number) => `${id}-option-${index}`;

  // The active row stays mounted while scrolled away, so aria-activedescendant always resolves.
  const rendered = v.items.slice();
  if (activeIndex >= 0) {
    const row = rowOfItem(activeIndex);
    if (!rendered.some((item) => item.index === row)) {
      const extra = v.getItem(row);
      if (extra) rendered.push(extra);
    }
  }

  // Pinned header: the section of the first visible row.
  let stickyRow = -1;
  if (rows && getSection && stickySectionHeaders && rowCount > 0) {
    for (let i = Math.min(v.range.start, rowCount - 1); i >= 0; i--) {
      if (rows[i].kind === 'header') {
        stickyRow = i;
        break;
      }
    }
  }

  const header = (section: string) => (renderSectionHeader ? renderSectionHeader(section) : section);
  const role = interactive ? 'listbox' : 'list';
  const isEmpty = items.length === 0 && !loadingAt;

  const handleItemClick = (index: number) => (event: MouseEvent) => {
    if (!interactive || disabledAt(index)) return;
    setActive(index);
    if (selectionMode !== 'none') select(index, { range: event.shiftKey });
    onAction?.(items[index], index);
  };

  const renderRow = (row: number, start: number, sticky = false) => {
    const r = rowAt(row);
    const style: CSSProperties = sticky ? {} : { transform: `translateY(${start}px)` };
    if (!sticky && !measured) style.height = v.getItem(row)?.size;
    const common = { 'data-index': row, ref: measured ? v.measureElement : undefined, style };
    if (r.kind === 'header') {
      return (
        <div key={`h:${r.section}:${sticky}`} {...common} role="presentation" className="ui-virtual-list__header" data-sticky={sticky || undefined}>
          {header(r.section)}
        </div>
      );
    }
    if (r.kind === 'loading') {
      return (
        <div key="loading" {...common} className="ui-virtual-list__loading" aria-hidden="true">
          <Spinner size={16} label={null} />
          {labels.loading}
        </div>
      );
    }
    const item = items[r.index];
    const disabled = disabledAt(r.index);
    const isSelected = selectedSet.has(getItemKey(item, r.index));
    const isActive = r.index === activeIndex;
    return (
      <div
        key={getItemKey(item, r.index)}
        {...common}
        id={interactive ? optionId(r.index) : undefined}
        role={interactive ? 'option' : 'listitem'}
        className="ui-virtual-list__item"
        aria-setsize={items.length}
        aria-posinset={r.index + 1}
        aria-selected={selectionMode !== 'none' ? isSelected : undefined}
        aria-disabled={disabled || undefined}
        data-active={isActive || undefined}
        data-selected={isSelected || undefined}
        data-interactive={interactive || undefined}
        onClick={interactive ? handleItemClick(r.index) : undefined}
      >
        {renderItem(item, r.index, { active: isActive, selected: isSelected, disabled })}
      </div>
    );
  };

  return (
    <div
      className={cx('ui-virtual-list', className)}
      style={style}
      data-variant={variant}
      data-dividers={dividers || undefined}
      data-interactive={interactive || undefined}
    >
      <div
        {...rest}
        ref={mergeRefs(scrollRef, ref)}
        role={role}
        aria-label={label}
        aria-multiselectable={selectionMode === 'multiple' || undefined}
        aria-activedescendant={interactive && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-busy={loadingAt ? true : undefined}
        // Focusable so the keyboard can scroll (and navigate, in listbox mode).
        tabIndex={0}
        className={cx('ui-virtual-list__viewport', variant === 'panel' && 'ui-panel')}
        style={{ height }}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          onFocus?.(event);
          // Keyboard focus only: a click sets the active item itself and must not scroll first.
          const keyboard = event.currentTarget.matches(':focus-visible');
          if (!interactive || !keyboard || event.target !== event.currentTarget || activeIndex >= 0 || items.length === 0) return;
          const firstSelected = items.findIndex((item, index) => selectedSet.has(getItemKey(item, index)));
          const start = firstSelected >= 0 ? firstSelected : step(-1, 1);
          if (start >= 0) moveTo(start);
        }}
      >
        {isEmpty ? (
          <div className="ui-virtual-list__empty" role="presentation">
            {empty ?? labels.empty}
          </div>
        ) : (
          <div className="ui-virtual-list__inner" role="presentation" style={{ height: v.totalSize }}>
            {stickyRow >= 0 && renderRow(stickyRow, 0, true)}
            {rendered.map((item) => (item.index === stickyRow ? null : renderRow(item.index, item.start)))}
          </div>
        )}
      </div>
      <span className="ui-sr-only" role="status">
        {loadingAt ? labels.loading : ''}
      </span>
    </div>
  );
});
