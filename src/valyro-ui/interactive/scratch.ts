/*
 * Scratch Reveal bookkeeping, apart from drawing. Strokes are kept in coordinates normalised to the card's width
 * (x 0…1, y 0…height/width), so a resized card redraws the same cleared areas. Progress is the share of a fixed grid
 * of sample points under the brush: scrubbing the same place twice adds nothing, and no pixels are read back.
 */

export interface ScratchPoint {
  x: number;
  y: number;
}

export interface ScratchGrid {
  cols: number;
  rows: number;
  /** Height over width of the card. */
  aspect: number;
  cleared: Uint8Array;
  count: number;
}

/** A sample grid of about `target` points with square-ish cells for a card of the given proportions. */
export function createGrid(aspect: number, target = 1200): ScratchGrid {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const cols = Math.max(8, Math.round(Math.sqrt(target / a)));
  const rows = Math.max(4, Math.round(cols * a));
  return { cols, rows, aspect: a, cleared: new Uint8Array(cols * rows), count: 0 };
}

export const gridProgress = (grid: ScratchGrid) => (grid.cleared.length ? grid.count / grid.cleared.length : 0);

/** Marks the sample points within `radius` (normalised to the width) of `point`. Returns how many were new. */
export function stamp(grid: ScratchGrid, point: ScratchPoint, radius: number): number {
  const { cols, rows, aspect } = grid;
  const cellW = 1 / cols;
  const cellH = aspect / rows;
  const c0 = Math.max(0, Math.floor((point.x - radius) / cellW));
  const c1 = Math.min(cols - 1, Math.floor((point.x + radius) / cellW));
  const r0 = Math.max(0, Math.floor((point.y - radius) / cellH));
  const r1 = Math.min(rows - 1, Math.floor((point.y + radius) / cellH));
  let added = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      if (grid.cleared[i]) continue;
      const dx = (c + 0.5) * cellW - point.x;
      const dy = (r + 0.5) * cellH - point.y;
      if (dx * dx + dy * dy <= radius * radius) {
        grid.cleared[i] = 1;
        added++;
      }
    }
  }
  grid.count += added;
  return added;
}

/**
 * Points from `from` to `to` (excluded) no further apart than `spacing`, so a fast flick between sparse pointer
 * events leaves an unbroken trail.
 */
export function interpolate(from: ScratchPoint, to: ScratchPoint, spacing: number): ScratchPoint[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = spacing > 0 ? Math.ceil(distance / spacing) : 1;
  const out: ScratchPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return out;
}

/** Stamps a whole segment (brush every third of its radius). Returns how many sample points were new. */
export function stampSegment(grid: ScratchGrid, from: ScratchPoint, to: ScratchPoint, radius: number): number {
  let added = 0;
  for (const point of interpolate(from, to, radius / 3)) added += stamp(grid, point, radius);
  return added;
}

/** Most pixels the mask canvas may have, whatever the screen: about a 1280×1280 area. */
export const MAX_MASK_PIXELS = 1_600_000;

/** Backing size of the mask canvas: the device pixel ratio (at most 2), scaled down to stay under the pixel budget. */
export function maskResolution(width: number, height: number, ratio: number): { width: number; height: number; scale: number } {
  let scale = Math.min(2, Math.max(1, ratio || 1));
  const pixels = width * height * scale * scale;
  if (pixels > MAX_MASK_PIXELS) scale *= Math.sqrt(MAX_MASK_PIXELS / pixels);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** A small deterministic pseudo-random sequence (mulberry32) for the paper speckle, the same on every render. */
export function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Calls `fn` at most once per `interval` ms, always with the latest value; `flush` sends a pending value now. */
export function throttle<T>(fn: (value: T) => void, interval: number, now: () => number = () => Date.now()) {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    timer = undefined;
    if (!pending) return;
    last = now();
    const { value } = pending;
    pending = null;
    fn(value);
  };
  return {
    call(value: T) {
      pending = { value };
      const wait = last + interval - now();
      if (wait <= 0) send();
      else if (timer === undefined) timer = setTimeout(send, wait);
    },
    flush() {
      clearTimeout(timer);
      send();
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}
