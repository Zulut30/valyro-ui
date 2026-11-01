/*
 * Lasso Select: the rectangle, the hit test and how a gesture combines with the selection it started from.
 */

export interface LassoRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type LassoHitMode = 'intersect' | 'contain';
export type LassoSelectionMode = 'replace' | 'add' | 'toggle';

/** The rectangle spanned by two points, whichever way it was dragged. */
export function lassoRect(x1: number, y1: number, x2: number, y2: number): LassoRect {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** `intersect`: any overlap counts; `contain`: the item must lie fully inside the lasso. */
export function lassoHits(lasso: LassoRect, item: LassoRect, mode: LassoHitMode): boolean {
  const right = lasso.left + lasso.width;
  const bottom = lasso.top + lasso.height;
  const itemRight = item.left + item.width;
  const itemBottom = item.top + item.height;
  if (mode === 'contain') return item.left >= lasso.left && item.top >= lasso.top && itemRight <= right && itemBottom <= bottom;
  return item.left < right && itemRight > lasso.left && item.top < bottom && itemBottom > lasso.top;
}

/** Ctrl / Cmd toggles and wins over Shift, which adds; without them, the component's mode. */
export function gestureMode(base: LassoSelectionMode, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): LassoSelectionMode {
  if (event.ctrlKey || event.metaKey) return 'toggle';
  if (event.shiftKey) return 'add';
  return base;
}

/**
 * The selection while (and after) a gesture: computed from the snapshot taken when the gesture started, so moving
 * back over an item undoes its change. Disabled and unknown ids never change; the result follows `itemIds` order.
 */
export function combineLasso(
  itemIds: readonly string[],
  snapshot: readonly string[],
  hits: readonly string[],
  mode: LassoSelectionMode,
  disabled: readonly string[] = [],
): string[] {
  const before = new Set(snapshot);
  const hit = new Set(hits.filter((id) => !disabled.includes(id)));
  return itemIds.filter((id) => {
    if (disabled.includes(id)) return before.has(id);
    if (mode === 'replace') return hit.has(id);
    if (mode === 'add') return before.has(id) || hit.has(id);
    return before.has(id) !== hit.has(id);
  });
}

/** Elements that keep their own pointer behaviour: a press on them never starts a lasso. */
export const LASSO_IGNORE = 'a[href], button, input, textarea, select, label, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [data-lasso-ignore]';
