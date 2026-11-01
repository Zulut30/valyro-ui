/*
 * Geometry of Feature Hotspots: where a point given as a share of the source image lands in a box that shows the
 * image with object-fit contain or cover, centred.
 */

export type HotspotFit = 'contain' | 'cover';

export interface HotspotSize {
  width: number;
  height: number;
}

export interface HotspotPlacement {
  /** Position in percent of the box. */
  left: number;
  top: number;
  /** False when `cover` crops the point away. */
  visible: boolean;
}

/** A coordinate is a finite share of the image, 0…1. Others are skipped, not clamped to the edge. */
export const validShare = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Scale `min(W/w, H/h)` for contain and `max(…)` for cover, centring offsets `(W − w·scale) / 2`; the point is the
 * offset plus the share times the scaled size. Without a box (server, first render) the box has the image's
 * proportions, so the point is the share itself.
 */
export function placeHotspot(image: HotspotSize, box: HotspotSize | null, fit: HotspotFit, x: number, y: number): HotspotPlacement {
  if (!box || box.width <= 0 || box.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { left: x * 100, top: y * 100, visible: true };
  }
  const sx = box.width / image.width;
  const sy = box.height / image.height;
  const scale = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
  const offsetX = (box.width - image.width * scale) / 2;
  const offsetY = (box.height - image.height * scale) / 2;
  const px = offsetX + x * image.width * scale;
  const py = offsetY + y * image.height * scale;
  // Half a pixel of slack keeps points on the very edge of a contained image.
  const visible = px >= -0.5 && px <= box.width + 0.5 && py >= -0.5 && py <= box.height + 0.5;
  return { left: (px / box.width) * 100, top: (py / box.height) * 100, visible };
}
