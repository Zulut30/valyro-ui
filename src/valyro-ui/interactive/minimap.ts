/*
 * Geometry of Page Minimap: the page (or a scroll container) drawn to scale, its sections as blocks and the visible
 * area as a frame. All positions are in px of the scrolled content; the map scales them by mapHeight / scrollHeight.
 */

export interface MinimapSectionBox {
  id: string;
  /** Top of the section from the top of the scrolled content, px. */
  top: number;
  height: number;
}

export interface MinimapMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export interface MinimapLayout {
  scale: number;
  sections: { id: string; top: number; height: number }[];
  frame: { top: number; height: number };
}

/** Blocks and frame in map px. The frame never leaves the map, even when overscroll reports a larger scrollTop. */
export function minimapLayout(metrics: MinimapMetrics, boxes: readonly MinimapSectionBox[], mapHeight: number, minBlock = 3): MinimapLayout {
  const total = Math.max(1, metrics.scrollHeight);
  const scale = mapHeight / total;
  const height = Math.min(mapHeight, Math.max(minBlock * 2, metrics.clientHeight * scale));
  const top = Math.min(mapHeight - height, Math.max(0, metrics.scrollTop * scale));
  return {
    scale,
    sections: boxes.map((box) => {
      const start = Math.min(mapHeight, Math.max(0, box.top * scale));
      return { id: box.id, top: start, height: Math.min(mapHeight - start, Math.max(minBlock, box.height * scale)) };
    }),
    frame: { top, height },
  };
}

/** The content needs no scrolling: the map has nothing to show. */
export const contentFits = (metrics: MinimapMetrics) => metrics.scrollHeight <= metrics.clientHeight + 1;

/** Largest scrollTop. */
export const maxScroll = (metrics: MinimapMetrics) => Math.max(0, metrics.scrollHeight - metrics.clientHeight);

/**
 * The section the reader is in: the last one whose top has passed the line just under the fixed header. At the very
 * bottom of the page, the last section that starts in view (a short final section can never reach the line).
 */
export function activeSection(metrics: MinimapMetrics, boxes: readonly MinimapSectionBox[], headerOffset = 0): string | null {
  if (boxes.length === 0) return null;
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const atBottom = metrics.scrollTop >= maxScroll(metrics) - 2 && maxScroll(metrics) > 0;
  const line = atBottom ? metrics.scrollTop + metrics.clientHeight - 1 : metrics.scrollTop + headerOffset + 8;
  let found: string | null = null;
  for (const box of sorted) if (box.top <= line) found = box.id;
  return found;
}

/** scrollTop that puts a section's top just under the fixed header. */
export const scrollTopForSection = (top: number, metrics: MinimapMetrics, headerOffset = 0) =>
  Math.min(maxScroll(metrics), Math.max(0, top - headerOffset));

/** scrollTop for a frame dragged to `frameTop` map px. */
export const scrollTopForFrame = (frameTop: number, scale: number, metrics: MinimapMetrics) =>
  scale > 0 ? Math.min(maxScroll(metrics), Math.max(0, frameTop / scale)) : 0;
