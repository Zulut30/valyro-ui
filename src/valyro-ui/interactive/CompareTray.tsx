'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx, isMotionReduced, themeSlowMs, useControllableState, usePresence } from '../primitives';
import { inertAttr, useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { useFold } from '../primitives/useFold';
import { ChevronUpIcon, XIcon } from '../icons';
import { Button } from '../basic/Button';
import { IconButton } from '../basic/IconButton';
import { Dialog } from '../feedback/Dialog';
import { useLabels } from '../agents/labels';
import { useElementSize, warnOnce } from './shared';
import { compareCell, mergeShown } from './compare';

/** A chip folding out of the row: starts from rest and comes to rest (ease-in-out), not a fast-start ease-out. */
const LEAVE_EASE = 'cubic-bezier(0.45, 0, 0.15, 1)';
import './CompareTray.css';

export { toggleCompare, compareCell, type CompareToggleResult } from './compare';

export interface ComparableItem {
  /** Stable id: the selection holds ids, so a removed or reordered source never turns into another item. */
  id: string;
  /** Name of the item. */
  title: string;
  /** Thumbnail URL. */
  image?: string;
  /** Values by field key; null or undefined means “no data”, 0 stays 0. */
  values?: Record<string, unknown>;
}

export interface CompareField {
  /** Key in `ComparableItem.values`. */
  key: string;
  /** Row heading in the table. */
  label: string;
  /** Appended to plain values ("kg", "h"). Values with different units are not converted: that model is the app's. */
  unit?: string;
  /** Your own cell content; return null for “no data”. */
  format?: (value: unknown, item: ComparableItem) => ReactNode;
}

export interface CompareTrayLabels {
  /** Name of the tray. */
  region: string;
  /** Tray heading. */
  title: string;
  count: (selected: number, max: number) => string;
  remove: (title: string) => string;
  clear: string;
  compare: string;
  /** Shown while fewer than the minimum are picked. */
  needMore: (missing: number) => string;
  /** Shown at the limit. */
  limit: (max: number) => string;
  /** The selection from outside holds more than `maxItems`. */
  overLimit: (extra: number) => string;
  /** A picked id that is no longer in `items`. */
  missing: (id: string) => string;
  /** A field without a value. */
  noData: string;
  /** Heading of the built-in comparison. */
  dialogTitle: string;
  /** Header of the field column of the table. */
  field: string;
  close: string;
  /** Expands the collapsed tray on a narrow screen. */
  expand: string;
}

const DEFAULT_LABELS: CompareTrayLabels = {
  region: 'Compare',
  title: 'Compare',
  count: (selected, max) => `${selected} of ${max}`,
  remove: (title) => `Remove ${title} from comparison`,
  clear: 'Clear',
  compare: 'Compare',
  needMore: (missing) => `Add ${missing} more to compare`,
  limit: (max) => `Up to ${max} items: remove one to add another`,
  overLimit: (extra) => `${extra} more than the limit: remove some`,
  missing: (id) => `Unavailable item (${id})`,
  noData: 'No data',
  dialogTitle: 'Comparison',
  field: 'Field',
  close: 'Close',
  expand: 'Show picked items',
};

export interface CompareTrayProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Every item that can be compared (usually the catalog). */
  items: ComparableItem[];
  /** Rows of the built-in table, in order. */
  fields?: CompareField[];
  /** Picked ids, shared with the catalog's compare buttons (see `toggleCompare`). */
  selectedIds?: string[];
  defaultSelectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  /** Most items in the tray. Default 3. */
  maxItems?: number;
  /** Fewest items to open the comparison. Default 2. */
  minItems?: number;
  /** `inline` (default) in the page flow; `fixed-bottom` pinned to the viewport, with its height reserved in the flow. */
  placement?: 'inline' | 'fixed-bottom';
  /** Hands the comparison to the app (a page, a route). Not together with `renderComparison`. */
  onCompare?: (ids: string[]) => void;
  /** Your own comparison view inside the dialog, instead of the built-in table. */
  renderComparison?: (items: ComparableItem[], close: () => void) => ReactNode;
  labels?: Partial<CompareTrayLabels>;
}

/**
 * A shelf that collects items from a catalog for comparison: thumbnails with remove buttons, a count, Clear and
 * Compare. Compare opens a semantic table in a dialog (or your view, or your own page through `onCompare`). The
 * catalog buttons and the tray share one `selectedIds`; `toggleCompare` gives the buttons the same rules.
 */
export const CompareTray = withRef(function CompareTray({
  items,
  fields = [],
  selectedIds: selectedProp,
  defaultSelectedIds = [],
  onSelectedIdsChange,
  maxItems = 3,
  minItems = 2,
  placement = 'inline',
  onCompare,
  renderComparison,
  labels,
  className,
  style,
  ref,
  ...rest
}: CompareTrayProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const [raw, setSelected] = useControllableState<string[]>({ value: selectedProp, defaultValue: defaultSelectedIds, onChange: onSelectedIdsChange });
  const [comparing, setComparing] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLButtonElement>(null);
  const panelSize = useElementSize(panelRef);

  // Repeats fold to their first occurrence; an outside value over the limit is shown, not trimmed.
  const selected = [...new Set(raw)];
  const entries = selected.map((id) => ({ id, item: items.find((item) => item.id === id) }));
  const existing = entries.flatMap((entry) => (entry.item ? [entry.item] : []));
  const over = selected.length - maxItems;
  const ready = existing.length >= minItems;

  /* ── Soft arrivals and departures ── */
  // After the first commit: from then on the tray unfolds, slides in and folds away; on the server it just shows.
  const settled = useRef(false);
  const [, rerender] = useState(0);
  const open = selected.length > 0;
  // On the smooth spring: it unfolds from rest, without a hard start.
  const fold = useFold<HTMLDivElement>(open && placement === 'inline', settled, true);
  const pinned = usePresence(open && placement === 'fixed-bottom', 420);
  const shownPanel = placement === 'inline' ? fold.isMounted : pinned.isMounted;
  // While the tray leaves it keeps showing the last items, so it folds away whole rather than empty.
  const lastEntries = useRef(entries);
  if (open) lastEntries.current = entries;
  // A removed chip folds away where it was; the others close the gap as it shrinks.
  const leaving = useRef(new Map<string, ComparableItem | undefined>());
  const shownOrder = useRef<string[]>(selected);
  const chipRefs = useRef(new Map<string, HTMLLIElement>());
  if (open) {
    const next = new Set(selected);
    for (const id of shownOrder.current) {
      if (!next.has(id) && !leaving.current.has(id) && settled.current) leaving.current.set(id, items.find((item) => item.id === id));
    }
    for (const id of [...leaving.current.keys()]) if (next.has(id)) leaving.current.delete(id);
    shownOrder.current = mergeShown(shownOrder.current, selected, new Set(leaving.current.keys()));
  } else {
    leaving.current.clear();
    shownOrder.current = [];
  }
  const chips = open
    ? shownOrder.current.map((id) => ({ id, item: items.find((item) => item.id === id) ?? leaving.current.get(id), leaving: leaving.current.has(id) }))
    : lastEntries.current.map((entry) => ({ ...entry, leaving: false }));

  useEffect(() => {
    settled.current = true;
  }, []);
  // Each leaving chip: width, gap and opacity down to nothing on a soft curve, then it is gone.
  const leavingKey = [...leaving.current.keys()].join(' ');
  useLayoutEffect(() => {
    if (!leavingKey) return;
    const ids = leavingKey.split(' ');
    let finished = 0;
    const done = () => {
      finished++;
      if (finished < ids.length) return;
      for (const id of ids) leaving.current.delete(id);
      shownOrder.current = shownOrder.current.filter((id) => !ids.includes(id));
      rerender((n) => n + 1);
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of ids) {
      const el = chipRefs.current.get(id);
      if (!el || typeof el.animate !== 'function') {
        timers.push(setTimeout(done, 0));
        continue;
      }
      const calm = isMotionReduced(el);
      // Long enough to follow, eased in and out: a chip leaving its row neither jolts away nor stops dead.
      const duration = calm ? 150 : themeSlowMs(el) * 1.6;
      const gap = parseFloat(getComputedStyle(el.parentElement ?? el).columnGap) || 0;
      const keyframes = calm
        ? { opacity: [1, 0] }
        : { opacity: [1, 0], transform: ['scale(1)', 'scale(0.92)'], width: [`${el.offsetWidth}px`, '0px'], marginInlineEnd: ['0px', `${-gap}px`], paddingInline: [getComputedStyle(el).paddingInlineStart, '0px'] };
      const animation = el.animate(keyframes, { duration, easing: calm ? 'ease-out' : LEAVE_EASE, fill: 'forwards' });
      animation.finished.then(done, done);
    }
    return () => timers.forEach(clearTimeout);
  }, [leavingKey]);
  // A chip picked again while it was leaving comes back at its full size.
  const selectedKey = selected.join(' ');
  useLayoutEffect(() => {
    for (const id of selected) {
      if (leaving.current.has(id)) continue;
      // Only the leaving animation (Web Animations); the CSS entrance of a new chip keeps playing.
      chipRefs.current
        .get(id)
        ?.getAnimations?.()
        .forEach((animation) => !('animationName' in animation) && animation.cancel());
    }
  }, [selectedKey]);

  useEffect(() => {
    if (onCompare && renderComparison) warnOnce('CompareTray', 'onCompare and renderComparison are exclusive; onCompare is used.');
  }, [onCompare, renderComparison]);
  useEffect(() => {
    if (raw.length > maxItems) warnOnce('CompareTray', `selectedIds holds ${raw.length} ids, more than maxItems (${maxItems}).`);
  }, [raw.length, maxItems]);

  const remove = (id: string) => setSelected((prev) => [...new Set(prev)].filter((x) => x !== id));
  const close = () => setComparing(false);
  const compare = () => {
    if (!ready) return;
    if (onCompare) onCompare(existing.map((item) => item.id));
    else setComparing(true);
  };

  const cell = (field: CompareField, item: ComparableItem) => {
    const value = item.values?.[field.key];
    const content = field.format ? field.format(value, item) : compareCell(value, field);
    return content === null || content === undefined ? <span className="ui-compare-tray__nodata">{copy.noData}</span> : content;
  };

  const status =
    over > 0 ? copy.overLimit(over) : selected.length >= maxItems ? copy.limit(maxItems) : !ready ? copy.needMore(minItems - existing.length) : null;

  return (
    <div
      ref={ref}
      className={cx('ui-compare-tray', className)}
      data-placement={placement}
      data-empty={shownPanel ? undefined : true}
      style={style}
      {...rest}
    >
      {placement === 'fixed-bottom' && pinned.isMounted && (
        <div className="ui-compare-tray__spacer" style={{ blockSize: pinned.state === 'open' ? (panelSize?.height ?? 0) : 0 }} aria-hidden="true" />
      )}
      {shownPanel && (
        <div className="ui-compare-tray__fold-slot">
          {/* A block slot: a fold that is itself a flex item does not animate its height in Chromium. */}
          <div
            ref={placement === 'inline' ? fold.ref : undefined}
            className="ui-compare-tray__fold"
            data-state={placement === 'inline' ? fold.state : pinned.state}
            data-ui-fold={placement === 'inline' ? fold.cssFold : undefined}
            inert={inertAttr(!open)}
          >
            <div ref={panelRef} className="ui-compare-tray__panel" role="region" aria-label={copy.region} data-collapsed={collapsed || undefined}>
              <div className="ui-compare-tray__head">
                <span className="ui-compare-tray__title">{copy.title}</span>
                <span className="ui-compare-tray__count" data-full={selected.length >= maxItems || undefined}>
                  {copy.count(selected.length, maxItems)}
                </span>
                <button
                  type="button"
                  className="ui-compare-tray__toggle"
                  aria-expanded={!collapsed}
                  aria-controls={`${uid}-list`}
                  aria-label={copy.expand}
                  onClick={() => setCollapsed((value) => !value)}
                >
                  <ChevronUpIcon aria-hidden="true" />
                </button>
              </div>
              <div className="ui-compare-tray__list-fold">
              <ul className="ui-compare-tray__list" id={`${uid}-list`}>
                {chips.map(({ id, item, leaving: out }) => (
                  <li
                    key={id}
                    ref={(node) => {
                      if (node) chipRefs.current.set(id, node);
                      else chipRefs.current.delete(id);
                    }}
                    className="ui-compare-tray__item"
                    data-missing={item ? undefined : true}
                    data-leaving={out || undefined}
                    inert={inertAttr(out)}
                  >
                    <span className="ui-compare-tray__thumb" aria-hidden="true">
                      {item?.image ? <img src={item.image} alt="" /> : null}
                    </span>
                    <span className="ui-compare-tray__name">{item ? item.title : copy.missing(id)}</span>
                    <IconButton size="sm" variant="ghost" icon={<XIcon />} label={copy.remove(item?.title ?? id)} onClick={() => remove(id)} />
                  </li>
                ))}
              </ul>
              </div>
              <div className="ui-compare-tray__foot">
                <span className="ui-compare-tray__status" data-tone={over > 0 ? 'danger' : undefined}>
                  {status}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  {copy.clear}
                </Button>
                <Button ref={compareRef} size="sm" variant="primary" disabled={!ready} onClick={compare}>
                  {copy.compare}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="ui-sr-only" aria-live="polite">
        {selected.length ? `${copy.count(selected.length, maxItems)}${status ? `. ${status}` : ''}` : ''}
      </div>
      {!onCompare && (
        <Dialog open={comparing && ready} onOpenChange={(open) => !open && close()} title={copy.dialogTitle} closeLabel={copy.close} size="lg" returnFocusRef={compareRef}>
          {renderComparison ? (
            renderComparison(existing, close)
          ) : (
            <div className="ui-compare-tray__table-wrap">
              <table className="ui-compare-tray__table">
                <thead>
                  <tr>
                    <th scope="col">{copy.field}</th>
                    {existing.map((item) => (
                      <th key={item.id} scope="col">
                        {item.image && <img className="ui-compare-tray__table-image" src={item.image} alt="" />}
                        {item.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.key}>
                      <th scope="row">{field.label}</th>
                      {existing.map((item) => (
                        <td key={item.id}>{cell(field, item)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
});
