/*
 * Geometry of Sticker Board, in canvas units: an item's x/y is its centre, so rotating keeps it in place. Pure.
 */

export interface BoardItemGeometry {
  id: string;
  /** Centre, in canvas units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Stacking order: higher is in front. */
  z: number;
}

export interface BoardSize {
  width: number;
  height: number;
}

export type BoardBounds = 'contain' | 'partial';

/** Half the width and height of the box around an item turned by `rotation` degrees. */
export function rotatedHalfExtents(width: number, height: number, rotation: number): { halfWidth: number; halfHeight: number } {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { halfWidth: (width * cos + height * sin) / 2, halfHeight: (width * sin + height * cos) / 2 };
}

/** Rounds to the grid step; a step of 0 leaves the value alone. */
export const snapTo = (value: number, step: number) => (step > 0 ? Math.round(value / step) * step : value);

const fit = (value: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value)));

/**
 * The centre an item may take: `contain` keeps the whole turned item on the canvas (centred when it is larger than
 * the canvas), `partial` lets edges hang over but keeps the centre on the canvas.
 */
export function constrainCenter(item: BoardItemGeometry, x: number, y: number, canvas: BoardSize, bounds: BoardBounds): { x: number; y: number } {
  if (bounds === 'partial') return { x: fit(x, 0, canvas.width), y: fit(y, 0, canvas.height) };
  const { halfWidth, halfHeight } = rotatedHalfExtents(item.width, item.height, item.rotation);
  return { x: fit(x, halfWidth, canvas.width - halfWidth), y: fit(y, halfHeight, canvas.height - halfHeight) };
}

/** Moves an item to a snapped centre inside the bounds. */
export function placeItem<T extends BoardItemGeometry>(item: T, x: number, y: number, canvas: BoardSize, bounds: BoardBounds, snap: number): T {
  const snapped = constrainCenter(item, snapTo(x, snap), snapTo(y, snap), canvas, bounds);
  // Snap first, then keep inside the bounds: the edge wins over the grid.
  return { ...item, ...snapped };
}

/** Turns an item by `delta` degrees, normalised to (−180, 180], and pulls it back inside the bounds. */
export function rotateItem<T extends BoardItemGeometry>(item: T, delta: number, canvas: BoardSize, bounds: BoardBounds): T {
  let rotation = (((item.rotation + delta) % 360) + 360) % 360;
  if (rotation > 180) rotation -= 360;
  const turned = { ...item, rotation };
  return { ...turned, ...constrainCenter(turned, item.x, item.y, canvas, bounds) };
}

/** Item ids from back to front: by z, ties in array order. */
export function stackOrder(items: readonly BoardItemGeometry[]): string[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.z - b.item.z || a.index - b.index)
    .map(({ item }) => item.id);
}

/**
 * Moves an item one step forward (+1) or back (−1) in the stack. The array keeps its order; z values are renumbered
 * 0…n−1 by stack position. The same array when the item cannot move.
 */
export function restack<T extends BoardItemGeometry>(items: T[], id: string, direction: 1 | -1): T[] {
  const order = stackOrder(items);
  const from = order.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return items;
  [order[from], order[to]] = [order[to], order[from]];
  const z = new Map(order.map((itemId, index) => [itemId, index]));
  return items.map((item) => (item.z === z.get(item.id) ? item : { ...item, z: z.get(item.id)! }));
}

/** The same items with one replaced (by id). */
export const replaceItem = <T extends { id: string }>(items: T[], next: T): T[] => items.map((item) => (item.id === next.id ? next : item));

/** Angle in degrees of a point seen from a centre, 0 pointing up, clockwise. */
export function angleFrom(cx: number, cy: number, px: number, py: number): number {
  return (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;
}
