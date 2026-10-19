/** Slides per view: a number, or minimum container widths (px) mapped to counts, e.g. `{ 0: 1, 640: 2, 1024: 3 }`. */
export type SlidesPerView = number | Record<number, number>;

/** Slides visible at `width` px of carousel width (the entry with the largest minimum width that fits). */
export function resolveSlidesPerView(perView: SlidesPerView, width: number): number {
  if (typeof perView === 'number') return Math.max(1, perView);
  let result = 1;
  let best = -Infinity;
  for (const [min, count] of Object.entries(perView)) {
    const m = Number(min);
    if (m <= width && m > best) {
      best = m;
      result = count;
    }
  }
  return Math.max(1, result);
}

/** Snap positions ("pages") a carousel of `count` slides has when `perView` fit at once. */
export function pageCount(count: number, perView: number) {
  if (count <= 0) return 0;
  return Math.max(1, Math.ceil(count - perView - 1e-6) + 1);
}

/**
 * Page shown at a scroll offset (px from the start edge). The last page is wherever the scroll
 * ends, which can be short of a full slide when `perView` is fractional.
 */
export function pageFromScroll(scroll: number, slideStep: number, maxScroll: number, pages: number) {
  if (pages <= 1 || slideStep <= 0) return 0;
  if (scroll >= maxScroll - 2) return pages - 1;
  return Math.min(pages - 1, Math.max(0, Math.round(scroll / slideStep)));
}

/** Page after moving `delta` from `page`; wraps around when `loop`, otherwise stops at the ends. */
export function stepPage(page: number, delta: number, pages: number, loop: boolean) {
  if (pages <= 0) return 0;
  const next = page + delta;
  if (loop) return ((next % pages) + pages) % pages;
  return Math.min(pages - 1, Math.max(0, next));
}
