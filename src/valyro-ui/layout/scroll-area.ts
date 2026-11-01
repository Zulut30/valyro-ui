/*
 * The geometry of ScrollArea, without the DOM: thumb size and position from the scroll position, the scroll
 * position from a dragged thumb, a page step for a click on the track, the depth of the edge hints, and where a
 * follow spring starts after a long jump. Pure: runs in tests and on the server.
 */

export interface ThumbGeometry {
  /** Thumb length along its track, px. */
  size: number;
  /** How far the thumb can travel (track minus thumb), px. */
  travel: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Thumb length in proportion to the visible part of the content, never shorter than `minThumb` (so it stays
 * grabbable on a long list) nor longer than the track.
 */
export function thumbGeometry(viewport: number, content: number, track: number, minThumb = 20): ThumbGeometry {
  if (track <= 0) return { size: 0, travel: 0 };
  if (content <= viewport || viewport <= 0) return { size: track, travel: 0 };
  const size = clamp((track * viewport) / content, Math.min(minThumb, track), track);
  return { size, travel: track - size };
}

/** Thumb offset from the track start for a scroll offset (a magnitude: RTL passes `Math.abs(scrollLeft)`). */
export function thumbOffset(scroll: number, viewport: number, content: number, travel: number): number {
  const range = content - viewport;
  if (range <= 0 || travel <= 0) return 0;
  return clamp(scroll / range, 0, 1) * travel;
}

/** The scroll offset that puts the thumb at `offset` from the track start (inverse of thumbOffset). */
export function scrollFromThumb(offset: number, viewport: number, content: number, travel: number): number {
  const range = content - viewport;
  if (range <= 0 || travel <= 0) return 0;
  return clamp(offset / travel, 0, 1) * range;
}

/** Share of the viewport one click on the track pages by — the browsers' own Page Down step. */
export const PAGE_SHARE = 0.875;

/**
 * Where a click on the track scrolls: one page towards the click (before the thumb: back; after it: forward),
 * clamped to the scroll range. `click` and `thumbStart` are offsets from the track start.
 */
export function trackPageTarget(scroll: number, viewport: number, content: number, click: number, thumbStart: number, thumbSize: number): number {
  const range = Math.max(0, content - viewport);
  const page = viewport * PAGE_SHARE;
  if (click < thumbStart) return clamp(scroll - page, 0, range);
  if (click > thumbStart + thumbSize) return clamp(scroll + page, 0, range);
  return scroll;
}

/** Distance from an edge over which its hint grows from nothing to full depth, px. */
export const EDGE_REVEAL = 48;

/**
 * Depth of an edge hint (fade or shadow) for `distance` px of hidden content: grows with the distance up to
 * `reveal`, so it follows the scroll instead of switching on. `size` scales the result (1: a share of the depth).
 */
export function edgeDepth(distance: number, reveal = EDGE_REVEAL, size = 1): number {
  if (!(distance > 0) || reveal <= 0) return 0;
  return clamp(distance / reveal, 0, 1) * size;
}

/** A follow spring further than this many viewports from the end first jumps to one viewport from it. */
export const FOLLOW_MAX_SCREENS = 3;

/**
 * Where a follow spring starts: where it is, unless the end ran far ahead (a pasted log, a long answer at once) —
 * then one viewport before the end, so it glides the last screen instead of racing through many.
 */
export function followStart(current: number, target: number, viewport: number): number {
  if (viewport > 0 && target - current > FOLLOW_MAX_SCREENS * viewport) return target - viewport;
  return current;
}
