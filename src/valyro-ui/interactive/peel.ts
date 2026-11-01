/*
 * Geometry of Peel Sticker. Points are shares of the sticker's width and height in the frame where the lifted corner is
 * C = (1, 1); the fold itself is computed in pixel proportions (`aspect` = height / width), so a wide sticker folds like
 * paper and not like a stretched square. Peeling
 * the corner to the tip T folds the paper along the perpendicular bisector of C and T, like real paper: the corner
 * lands exactly on T, so it stays under the finger in any direction. Everything is relative to the sticker's size,
 * so the same gesture does the same thing on any screen.
 */

export type PeelCorner = 'top-start' | 'bottom-end';

export interface Point {
  x: number;
  y: number;
}

/** The lifted corner in the frame. */
const CORNER: Point = { x: 1, y: 1 };

/** The physical corner: bottom-end is bottom right in left-to-right pages and bottom left in right-to-left ones. */
export function physicalCorner(corner: PeelCorner, rtl: boolean): { right: boolean; bottom: boolean } {
  const end = corner === 'bottom-end';
  return { right: end !== rtl, bottom: end };
}

/** The tip of a corner lifted `p` (share of the diagonal) straight toward the opposite corner. */
export const tipAt = (p: number): Point => ({ x: 1 - p, y: 1 - p });

/** How far the corner is peeled: the tip's distance from the corner, over the diagonal (0 flat, 1 to the far corner). */
export const peelAmount = (tip: Point, aspect = 1): number => Math.hypot(CORNER.x - tip.x, (CORNER.y - tip.y) * aspect) / Math.hypot(1, aspect);

/**
 * The tip after a drag from `start` to `point` (client px) on a sticker of `size`, starting from `base`: the finger's
 * movement, mirrored into the frame, moves the tip one to one. The tip stays on the sticker.
 */
export function dragTip(base: Point, start: Point, point: Point, size: { width: number; height: number }, corner: PeelCorner, rtl: boolean): Point {
  const { right, bottom } = physicalCorner(corner, rtl);
  const dx = size.width ? (point.x - start.x) / size.width : 0;
  const dy = size.height ? (point.y - start.y) / size.height : 0;
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  return { x: clamp01(base.x + (right ? dx : -dx)), y: clamp01(base.y + (bottom ? dy : -dy)) };
}

/**
 * Where an opening peel carries the tip: on, along the direction it was peeled, until the fold line has passed the
 * whole sticker and nothing lies flat any more.
 */
export function peeledOffTip(tip: Point, aspect = 1, amount = 2.2): Point {
  const diagonal = Math.hypot(1, aspect);
  const dx = tip.x - CORNER.x;
  const dy = (tip.y - CORNER.y) * aspect;
  const length = Math.hypot(dx, dy);
  const ux = length > 1e-3 ? dx / length : -1 / diagonal;
  const uy = length > 1e-3 ? dy / length : -aspect / diagonal;
  // Past the far corner whatever the direction (amount > 2): the fold line ends up beyond every point of the sticker.
  const reach = amount * diagonal;
  return { x: CORNER.x + ux * reach, y: CORNER.y + (uy * reach) / aspect };
}

/** Clips a convex polygon to the half-plane a·x + b·y <= c (Sutherland–Hodgman with one edge). */
function clip(polygon: Point[], a: number, b: number, c: number): Point[] {
  const inside = (p: Point) => a * p.x + b * p.y <= c + 1e-9;
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) {
      const t = (c - a * p.x - b * p.y) / (a * (q.x - p.x) + b * (q.y - p.y));
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export interface PeelShape {
  /** What still lies flat, as a CSS polygon(); EMPTY_POLYGON once nothing does. */
  cover: string;
  /** The folded-back corner (the sticker's reverse) over the sticker, as a CSS polygon(); EMPTY_POLYGON when nothing shows. */
  flap: string;
  /** Direction (CSS gradient degrees) from the fold line toward the tip, for the curl's shading. */
  angle: number;
  /** Peeled share, 0…1+ (see peelAmount). */
  amount: number;
}

const round = (n: number) => Math.round(n * 1000) / 10;

/** Nothing of the element shows (unlike `none`, which shows all of it). */
export const EMPTY_POLYGON = 'polygon(0% 0%, 0% 0%, 0% 0%)';

/** Shoelace area: a corner that is not lifted at all is a degenerate polygon. */
function area(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * The cover and the flap with the corner peeled to `tip`, mirrored to the physical corner. The fold line is the set
 * of points as far from the corner as from the tip; what is nearer the corner is lifted and, reflected across the
 * line, lies over the sticker as its reverse side.
 */
export function peelShapeAt(tip: Point, corner: PeelCorner, rtl: boolean, aspect = 1): PeelShape {
  const { right, bottom } = physicalCorner(corner, rtl);
  // Work in pixel proportions: width 1, height `aspect`.
  const a = aspect > 0 ? aspect : 1;
  const rect: Point[] = SQUARE.map((pt) => ({ x: pt.x, y: pt.y * a }));
  const toRect = (polygon: Point[]) => clip(clip(clip(clip(polygon, -1, 0, 0), 0, -1, 0), 1, 0, 1), 0, 1, a);
  const map = (pt: Point): Point => ({ x: right ? pt.x : 1 - pt.x, y: bottom ? pt.y / a : 1 - pt.y / a });
  const css = (points: Point[]) =>
    points.length < 3 || area(points) < 1e-6 * a ? EMPTY_POLYGON : `polygon(${points.map((pt) => `${round(map(pt).x)}% ${round(map(pt).y)}%`).join(', ')})`;
  const cy = CORNER.y * a;
  const ty = tip.y * a;
  const nx = CORNER.x - tip.x;
  const ny = cy - ty;
  const nn = nx * nx + ny * ny;
  const amount = Math.sqrt(nn) / Math.hypot(1, a);
  if (nn < 1e-8) return { cover: css(rect), flap: EMPTY_POLYGON, angle: 315, amount: 0 };
  const c = (CORNER.x * CORNER.x + cy * cy - (tip.x * tip.x + ty * ty)) / 2;
  const flat = clip(rect, nx, ny, c);
  const lifted = clip(rect, -nx, -ny, -c);
  const reflect = (pt: Point): Point => {
    const k = (2 * (nx * pt.x + ny * pt.y - c)) / nn;
    return { x: pt.x - k * nx, y: pt.y - k * ny };
  };
  const reflected = toRect(lifted.map(reflect));
  // From the fold toward the tip, in the physical frame: CSS angles run clockwise from "to top".
  const ux = right ? -nx : nx;
  const uy = bottom ? -ny : ny;
  const angle = Math.round(((Math.atan2(ux, -uy) * 180) / Math.PI + 360) % 360);
  return { cover: css(flat), flap: css(reflected), angle, amount };
}

/**
 * Released past the threshold, or flicked toward the far corner fast enough (sticker sizes per second) from a fifth
 * of the way: open; otherwise back to the corner.
 */
export function peelOpens(amount: number, threshold: number, speed = 0): boolean {
  return amount >= threshold || (amount >= 0.2 && speed >= 1.4);
}
