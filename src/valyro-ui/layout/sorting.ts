/** Pure helpers behind Sortable. */

export type SortableLayout = 'vertical' | 'horizontal' | 'grid';

/**
 * Copy of `array` with the item at `from` moved to `to` (its final index). Negative indices
 * count from the end; `to` is clamped to the array. An out-of-range `from` returns an unchanged copy.
 */
export function arrayMove<T>(array: readonly T[], from: number, to: number): T[] {
  const next = array.slice();
  const length = next.length;
  const start = from < 0 ? length + from : from;
  if (!Number.isInteger(start) || start < 0 || start >= length) return next;
  const end = Math.min(Math.max(to < 0 ? length + to : to, 0), length - 1);
  const [item] = next.splice(start, 1);
  next.splice(end, 0, item);
  return next;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Index of the box whose center is closest to `point`: along the list's axis for vertical and
 * horizontal lists, in both dimensions for grids. -1 when there are no boxes.
 */
export function closestIndex(boxes: readonly Box[], point: { x: number; y: number }, layout: SortableLayout): number {
  let best = -1;
  let bestDistance = Infinity;
  boxes.forEach((box, index) => {
    const dx = box.left + box.width / 2 - point.x;
    const dy = box.top + box.height / 2 - point.y;
    const distance = layout === 'vertical' ? Math.abs(dy) : layout === 'horizontal' ? Math.abs(dx) : Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Number of items in the first row of a grid, from the items' top offsets. */
export function columnCount(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  const first = tops[0];
  let count = 0;
  while (count < tops.length && Math.abs(tops[count] - first) < 2) count++;
  return Math.max(1, count);
}

/**
 * Where a lifted item goes for a key press, or null when the key doesn't move it.
 * `inlineStep` is the item step of ArrowLeft / ArrowRight for the writing direction
 * (see `inlineArrowStep`); grids move a whole row with ArrowUp / ArrowDown.
 */
export function keyboardTarget(
  key: string,
  index: number,
  count: number,
  layout: SortableLayout,
  inlineStep: -1 | 0 | 1,
  columns = 1,
): number | null {
  let target: number;
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      if (layout === 'horizontal') return null;
      const step = layout === 'grid' ? columns : 1;
      target = index + (key === 'ArrowDown' ? step : -step);
      break;
    }
    case 'ArrowLeft':
    case 'ArrowRight':
      if (layout === 'vertical' || inlineStep === 0) return null;
      target = index + inlineStep;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = count - 1;
      break;
    default:
      return null;
  }
  return Math.min(Math.max(target, 0), count - 1);
}
