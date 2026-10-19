/** A sheet height: px as a number or `'240px'`, or a share of the available height as `'50%'`. */
export type SnapPoint = number | `${number}px` | `${number}%`;

/**
 * Visible heights in px for `points` (ascending), clamped to `available`. A point lower than
 * the one before it is raised to it, so indexes stay stable and the list stays sorted.
 */
export function resolveSnapPoints(points: readonly SnapPoint[], available: number): number[] {
  const max = Math.max(0, available);
  let previous = 0;
  return points.map((point) => {
    let px: number;
    if (typeof point === 'number') px = point;
    else if (point.endsWith('%')) px = (parseFloat(point) / 100) * max;
    else px = parseFloat(point);
    if (!Number.isFinite(px)) throw new Error(`BottomSheet: invalid snap point "${point}"`);
    previous = Math.min(max, Math.max(previous, px));
    return Math.round(previous);
  });
}

/** How far a release is projected along its velocity (ms), like UIKit's deceleration projection. */
const PROJECTION_MS = 200;

export interface ReleaseOptions {
  /** Release below the lowest snap point may close the sheet. */
  dismissible: boolean;
  /** px/ms; faster releases always move at least one snap point in their direction. */
  flickVelocity?: number;
}

/**
 * Snap index a drag released at `height` (px visible) with `velocity` (px/ms, positive = growing)
 * settles on, or -1 to close. The release is projected forward and the nearest stop wins; a flick
 * always moves at least one stop from where it was let go.
 */
export function releaseSnapIndex(
  heights: readonly number[],
  height: number,
  velocity: number,
  { dismissible, flickVelocity = 0.4 }: ReleaseOptions,
): number {
  if (heights.length === 0) return -1;
  // Closed is a stop at height 0 below the first snap point.
  const stops = dismissible ? [0, ...heights] : [...heights];
  const offset = dismissible ? 1 : 0;
  const projected = height + velocity * PROJECTION_MS;
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - projected) < Math.abs(stops[best] - projected)) best = i;
  }
  if (Math.abs(velocity) >= flickVelocity) {
    if (velocity > 0 && stops[best] <= height) {
      const up = stops.findIndex((stop) => stop > height + 1);
      if (up !== -1) best = up;
    } else if (velocity < 0 && stops[best] >= height) {
      for (let i = stops.length - 1; i >= 0; i--) {
        if (stops[i] < height - 1) {
          best = i;
          break;
        }
      }
    }
  }
  return best - offset;
}

/** Diminishing overshoot past a limit, like iOS rubber-banding: never exceeds `dimension`. */
export function rubberband(overshoot: number, dimension: number) {
  if (overshoot <= 0 || dimension <= 0) return 0;
  return (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;
}

/**
 * Backdrop opacity 0–1 for a sheet showing `height` px: it fades in between the snap point before
 * `dimFrom` (or fully closed) and `dimFrom`, and is fully dimmed above.
 */
export function backdropOpacity(heights: readonly number[], height: number, dimFrom: number) {
  if (heights.length === 0) return 0;
  const index = Math.min(Math.max(0, dimFrom), heights.length - 1);
  const full = heights[index];
  const start = index > 0 ? heights[index - 1] : 0;
  if (full <= start) return height >= full ? 1 : 0;
  return Math.min(1, Math.max(0, (height - start) / (full - start)));
}
