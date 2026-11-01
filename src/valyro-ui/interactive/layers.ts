/*
 * Layout of Exploded Layers: how far each prepared layer moves along the stack's axis for a separation 0…1, and how
 * the scene scales and tilts so the opened stack stays inside its box. At separation 0 every layer is at depth 0 and
 * the scene is flat, so the sources line up exactly.
 */

/** Distance between neighbouring layers at full separation, in percent of the scene width. */
export const LAYER_GAP = 16;

/** Separation from which the captions show next to the layers. */
export const CAPTIONS_FROM = 0.15;

export interface LayerAngle {
  /** Tilt back, degrees. */
  x: number;
  /** Turn around the stack's axis, degrees. */
  y: number;
}

export const DEFAULT_ANGLE: LayerAngle = { x: 55, y: -30 };

/**
 * Depth of a layer in percent of the scene width. `offset` is the layer's place on the axis in gaps; by default the
 * layers are spread evenly around the middle in array order (first = bottom).
 */
export function layerDepth(index: number, count: number, separation: number, offset?: number): number {
  if (!separation) return 0;
  const place = offset ?? index - (count - 1) / 2;
  return place * LAYER_GAP * separation;
}

/**
 * Scale of the whole scene: 1 when assembled, smaller as more layers open up and as the scene turns (a turned
 * plane's corners, where the captions sit, reach past the frame otherwise).
 */
export function sceneScale(count: number, separation: number): number {
  return 1 / (1 + separation * (0.1 * Math.max(0, count - 1) + 0.25));
}

/** Tilt of the scene: it grows with the separation, so the assembled object faces the reader. */
export function sceneTilt(angle: LayerAngle, separation: number): LayerAngle {
  return separation ? { x: angle.x * separation, y: angle.y * separation } : { x: 0, y: 0 };
}

export const clampSeparation = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
