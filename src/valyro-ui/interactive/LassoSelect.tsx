'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentPropsWithRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefCallback,
} from 'react';
import { cx, useControllableState } from '../primitives';
import { withRef } from '../primitives/react-compat';
import { Button } from '../basic/Button';
import { useLabels } from '../agents/labels';
import { combineLasso, gestureMode, lassoHits, lassoRect, LASSO_IGNORE, type LassoHitMode, type LassoRect, type LassoSelectionMode } from './lasso';
import './LassoSelect.css';

export { combineLasso, lassoHits, lassoRect, gestureMode, type LassoHitMode, type LassoRect, type LassoSelectionMode } from './lasso';

export type LassoChangeReason = 'lasso' | 'toggle' | 'all' | 'none';

export interface LassoChangeDetail {
  reason: LassoChangeReason;
  /** The operation of a lasso gesture after the modifier keys: Shift adds, Ctrl / Cmd toggles. */
  mode?: LassoSelectionMode;
  /** The item a toggle changed. */
  id?: string;
}

export interface LassoSelectLabels {
  /** Name of the selectable area. */
  region: string;
  count: (selected: number) => string;
  selectAll: string;
  clear: string;
  /** Touch mode: a tap toggles an item. */
  multiSelect: string;
  /** Accessible name of an item's checkbox (from `useLassoItem(id, { label })`). */
  select: (label: string) => string;
}

const DEFAULT_LABELS: LassoSelectLabels = {
  region: 'Selectable items',
  count: (selected) => (selected === 1 ? '1 selected' : `${selected} selected`),
  selectAll: 'Select all',
  clear: 'Clear selection',
  multiSelect: 'Select multiple',
  select: (label) => `Select ${label}`,
};

export interface LassoSelectProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange'> {
  /** Every selectable id, in document order: the known set, the order of the result and the scope of Select all. */
  itemIds: string[];
  /** Selected ids. A change of it during a gesture cancels the gesture. */
  selectedIds?: string[];
  defaultSelectedIds?: string[];
  onSelectedIdsChange?: (ids: string[], detail: LassoChangeDetail) => void;
  /** `intersect` (default): touching an item selects it; `contain`: the item must be fully inside the lasso. */
  hitMode?: LassoHitMode;
  /** What a gesture does without modifier keys. Default `replace`. Shift adds, Ctrl / Cmd toggles (and wins). */
  selectionMode?: LassoSelectionMode;
  /** Viewport rectangle of an item, for layouts that know it better than the registered element (null: skip it). */
  getItemRect?: (id: string) => DOMRect | null;
  /** Ids that keep their state: a lasso, a toggle and Select all leave them as they are. */
  disabledIds?: string[];
  /** Hides the toolbar (count, Select all, Clear, Select multiple). Default true. */
  showToolbar?: boolean;
  /** The items: elements that call `useLassoItem(id)`. */
  children?: ReactNode;
  labels?: Partial<LassoSelectLabels>;
}

interface LassoContextValue {
  register: (id: string, element: Element | null) => void;
  selected: ReadonlySet<string>;
  disabled: ReadonlySet<string>;
  toggle: (id: string) => void;
  multi: boolean;
  labels: LassoSelectLabels;
}

const LassoContext = createContext<LassoContextValue | null>(null);

/** Starting distance of a lasso, in px: shorter presses stay clicks. */
const THRESHOLD = 6;

export interface LassoItemOptions {
  /** Name of the item, for its checkbox (`Select <label>`). */
  label?: string;
}

/**
 * Registers an item of the surrounding LassoSelect: spread `itemProps` on the item's outer element (its rectangle is
 * what the lasso hits) and `checkboxProps` on an `<input>` next to its content — the keyboard and touch path.
 */
export function useLassoItem(id: string, options: LassoItemOptions = {}) {
  const context = useContext(LassoContext);
  const register = context?.register;
  const ref: RefCallback<HTMLElement> = useCallback((element) => register?.(id, element), [register, id]);
  const selected = !!context?.selected.has(id);
  const disabled = !!context?.disabled.has(id);
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (!context || disabled || (event.target as Element).closest(LASSO_IGNORE)) return;
    // Ctrl / Cmd-click toggles, as in file managers; in “Select multiple” a plain tap does.
    if (context.multi || event.ctrlKey || event.metaKey) context.toggle(id);
  };
  return {
    selected,
    disabled,
    itemProps: {
      ref,
      onClick,
      'data-lasso-item': id,
      'data-selected': selected || undefined,
      'data-disabled': disabled || undefined,
    },
    checkboxProps: {
      type: 'checkbox' as const,
      className: 'ui-lasso__checkbox',
      checked: selected,
      disabled,
      onChange: (_event: ChangeEvent<HTMLInputElement>) => context?.toggle(id),
      'aria-label': options.label && context ? context.labels.select(options.label) : undefined,
    },
  };
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

interface Gesture {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  snapshot: string[];
  mode: LassoSelectionMode;
  started: boolean;
}

/**
 * Drag a rectangle over cards or files to select a group; the app then runs its bulk action on the ids. The lasso
 * starts on empty space only (links, buttons, fields and items keep their own behaviour), measures only the
 * registered items, once per frame, and commits on release; Escape restores the selection it started from. Every
 * item also has a checkbox, and “Select multiple” turns taps into toggles on touch screens.
 */
export const LassoSelect = withRef(function LassoSelect({
  itemIds,
  selectedIds: selectedProp,
  defaultSelectedIds = [],
  onSelectedIdsChange,
  hitMode = 'intersect',
  selectionMode = 'replace',
  getItemRect,
  disabledIds = [],
  showToolbar = true,
  children,
  labels,
  className,
  style,
  ref,
  ...rest
}: LassoSelectProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const [rawSelected, setSelected] = useControllableState<string[]>({ value: selectedProp, defaultValue: defaultSelectedIds });
  const selected = useMemo(() => itemIds.filter((id) => rawSelected.includes(id)), [itemIds, rawSelected]);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  /** The lasso rectangle: always in the page, drawn per frame without a render; it fades in and out. */
  const rectRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<string[] | null>(null);
  const [multi, setMulti] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, Element>());
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const latest = useRef({ itemIds, selected, disabledIds, hitMode, getItemRect });
  latest.current = { itemIds, selected, disabledIds, hitMode, getItemRect };

  const commit = (next: string[], detail: LassoChangeDetail) => {
    if (sameIds(next, latest.current.selected)) return;
    setSelected(next);
    onSelectedIdsChange?.(next, detail);
    setAnnouncement(copy.count(next.length));
  };

  const register = useCallback((id: string, element: Element | null) => {
    if (element) items.current.set(id, element);
    else items.current.delete(id);
  }, []);

  /** Lasso and item rectangles in the area's content coordinates, so scrolling moves neither. */
  const measure = () => {
    const area = areaRef.current;
    const g = gesture.current;
    if (!area || !g) return null;
    const box = area.getBoundingClientRect();
    const toContent = (x: number, y: number) => ({ x: x - box.left - area.clientLeft + area.scrollLeft, y: y - box.top - area.clientTop + area.scrollTop });
    const end = toContent(g.clientX, g.clientY);
    const lasso = lassoRect(g.startX, g.startY, end.x, end.y);
    const { itemIds: ids, disabledIds: off, hitMode: mode, getItemRect: rectOf } = latest.current;
    const hits = ids.filter((id) => {
      const r = rectOf?.(id) ?? items.current.get(id)?.getBoundingClientRect() ?? null;
      if (!r) return false;
      const start = toContent(r.left, r.top);
      return lassoHits(lasso, { left: start.x, top: start.y, width: r.width, height: r.height }, mode);
    });
    return { lasso, next: combineLasso(ids, g.snapshot, hits, g.mode, off) };
  };

  const drawRect = (lasso: LassoRect) => {
    const el = rectRef.current;
    if (!el) return;
    el.style.left = `${lasso.left}px`;
    el.style.top = `${lasso.top}px`;
    el.style.width = `${lasso.width}px`;
    el.style.height = `${lasso.height}px`;
    el.setAttribute('data-visible', '');
  };
  const update = () => {
    frame.current = 0;
    const result = measure();
    if (!result) return;
    drawRect(result.lasso);
    // The items re-render only when the set under the lasso changes, not on every frame.
    if (!draftRef.current || !sameIds(draftRef.current, result.next)) {
      draftRef.current = result.next;
      setDraft(result.next);
    }
  };
  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(update);
  };

  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    window.removeEventListener('keydown', onWindowKey, true);
    if (g?.started && areaRef.current?.hasPointerCapture?.(g.pointerId)) areaRef.current.releasePointerCapture(g.pointerId);
    // The rectangle fades out where it is (CSS), instead of vanishing.
    rectRef.current?.removeAttribute('data-visible');
    draftRef.current = null;
    setSelecting(false);
    setDraft(null);
  };
  const endRef = useRef(end);
  endRef.current = end;
  // One listener for the component's life, so the one added at the start of a gesture is the one removed at its end.
  // Escape restores the selection the gesture started from: nothing was committed yet.
  const onWindowKey = useRef((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    endRef.current();
  }).current;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Touch keeps scrolling the page: on touch screens selection goes through the checkboxes and “Select multiple”.
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return;
    const target = event.target as Element;
    if (target.closest(LASSO_IGNORE) || target.closest('[data-lasso-item]')) return;
    const area = event.currentTarget;
    const box = area.getBoundingClientRect();
    gesture.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: event.clientX - box.left - area.clientLeft + area.scrollLeft,
      startY: event.clientY - box.top - area.clientTop + area.scrollTop,
      clientX: event.clientX,
      clientY: event.clientY,
      snapshot: latest.current.selected,
      mode: gestureMode(selectionMode, event),
      started: false,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    g.clientX = event.clientX;
    g.clientY = event.clientY;
    if (!g.started) {
      if (Math.hypot(event.clientX - g.startClientX, event.clientY - g.startClientY) < THRESHOLD) return;
      g.started = true;
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // A synthetic or already released pointer: the lasso still follows the moves it gets.
      }
      window.addEventListener('keydown', onWindowKey, true);
      setSelecting(true);
    }
    event.preventDefault();
    schedule();
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    g.clientX = event.clientX;
    g.clientY = event.clientY;
    const result = g.started ? measure() : null;
    const mode = g.mode;
    end();
    if (result) commit(result.next, { reason: 'lasso', mode });
  };

  // A new selection from outside wins over a gesture in progress.
  const selectedKey = selected.join('\u0000');
  const startedKey = useRef(selectedKey);
  useEffect(() => {
    const g = gesture.current;
    if (g?.started && selectedKey !== startedKey.current) end();
    startedKey.current = selectedKey;
  }, [selectedKey]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener('keydown', onWindowKey, true);
    },
    [onWindowKey],
  );

  const toggle = (id: string) => {
    if (disabledIds.includes(id)) return;
    const current = latest.current.selected;
    commit(current.includes(id) ? current.filter((x) => x !== id) : itemIds.filter((x) => x === id || current.includes(x)), { reason: 'toggle', id });
  };
  const keepDisabled = (keep: (id: string) => boolean) => itemIds.filter((id) => (disabledIds.includes(id) ? selected.includes(id) : keep(id)));

  const shown = draft ?? selected;
  const context: LassoContextValue = {
    register,
    selected: new Set(shown),
    disabled: new Set(disabledIds),
    toggle,
    multi,
    labels: copy,
  };

  return (
    <div ref={ref} className={cx('ui-lasso', className)} data-selecting={selecting || undefined} data-multi={multi || undefined} style={style} {...rest}>
      {showToolbar && (
        <div className="ui-lasso__toolbar">
          <span className="ui-lasso__count">{copy.count(shown.length)}</span>
          <Button size="sm" variant="ghost" onClick={() => commit(keepDisabled(() => true), { reason: 'all' })}>
            {copy.selectAll}
          </Button>
          <Button size="sm" variant="ghost" disabled={selected.length === 0} onClick={() => commit(keepDisabled(() => false), { reason: 'none' })}>
            {copy.clear}
          </Button>
          <Button className="ui-lasso__multi" size="sm" variant={multi ? 'secondary' : 'ghost'} aria-pressed={multi} onClick={() => setMulti((value) => !value)}>
            {copy.multiSelect}
          </Button>
        </div>
      )}
      <div
        ref={areaRef}
        className="ui-lasso__area"
        role="group"
        aria-label={copy.region}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={end}
        onLostPointerCapture={() => gesture.current?.started && end()}
        onScroll={() => gesture.current?.started && schedule()}
      >
        <LassoContext.Provider value={context}>{children}</LassoContext.Provider>
        <div ref={rectRef} className="ui-lasso__rect" aria-hidden="true" />
      </div>
      <div className="ui-sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
});
