/*
 * The document of Pixel Painter and the operations on it. Cells hold palette indexes; palette entry 0 is always
 * transparent. Everything here is pure and works on plain arrays, so it is tested without a canvas.
 */

/** A colour as `[r, g, b, a]`, each channel 0…255. */
export type PixelColor = [number, number, number, number];

export interface PixelDocument {
  width: number;
  height: number;
  /** Up to 256 colours; entry 0 is `[0, 0, 0, 0]`, transparent. */
  palette: PixelColor[];
  /** `width × height` palette indexes, row by row. */
  cells: number[];
}

export type PixelTool = 'pencil' | 'eraser' | 'fill' | 'picker';

export const MIN_GRID = 8;
export const MAX_GRID = 32;

/** Why a document cannot be edited, or null when it is valid. */
export type PixelProblem = 'size' | 'palette' | 'cells' | 'index';

const isChannel = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255;

export function validateDocument(doc: PixelDocument): PixelProblem | null {
  const { width, height, palette, cells } = doc;
  if (![width, height].every((n) => Number.isInteger(n) && n >= MIN_GRID && n <= MAX_GRID)) return 'size';
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > 256) return 'palette';
  if (!palette.every((c) => Array.isArray(c) && c.length === 4 && c.every(isChannel))) return 'palette';
  if (palette[0].some((channel) => channel !== 0)) return 'palette';
  if (!Array.isArray(cells) || cells.length !== width * height) return 'cells';
  if (!cells.every((i) => Number.isInteger(i) && i >= 0 && i < palette.length)) return 'index';
  return null;
}

export const DEFAULT_PALETTE: PixelColor[] = [
  [0, 0, 0, 0],
  [17, 17, 17, 255],
  [255, 255, 255, 255],
  [229, 57, 53, 255],
  [251, 140, 0, 255],
  [253, 216, 53, 255],
  [67, 160, 71, 255],
  [30, 136, 229, 255],
  [142, 36, 170, 255],
  [121, 85, 72, 255],
];

/** A transparent grid. */
export function createDocument(width = 16, height = 16, palette: PixelColor[] = DEFAULT_PALETTE): PixelDocument {
  return { width, height, palette, cells: new Array<number>(width * height).fill(0) };
}

/** The first opaque palette entry, or 0 when there is none. */
export function firstOpaque(palette: readonly PixelColor[]): number {
  const index = palette.findIndex((c, i) => i > 0 && c[3] > 0);
  return index < 0 ? 0 : index;
}

/** Cells on the straight line from one cell to another, both ends included (Bresenham). */
export function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Cells with `index` painted at the given points; points outside the grid are ignored. A new array. */
export function paintCells(doc: PixelDocument, cells: readonly number[], points: readonly [number, number][], index: number): number[] {
  const next = [...cells];
  for (const [x, y] of points) {
    if (x >= 0 && y >= 0 && x < doc.width && y < doc.height) next[y * doc.width + x] = index;
  }
  return next;
}

/**
 * Flood fill from a cell over its four neighbours with the same palette index (diagonals do not connect). Null when
 * nothing changes: the area already has that index, or the start is outside the grid.
 */
export function floodFill(doc: PixelDocument, x: number, y: number, index: number): number[] | null {
  const { width, height } = doc;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const target = doc.cells[y * width + x];
  if (target === index) return null;
  const cells = [...doc.cells];
  const stack = [y * width + x];
  while (stack.length) {
    const at = stack.pop()!;
    if (cells[at] !== target) continue;
    cells[at] = index;
    const cx = at % width;
    const cy = (at - cx) / width;
    if (cx > 0) stack.push(at - 1);
    if (cx < width - 1) stack.push(at + 1);
    if (cy > 0) stack.push(at - width);
    if (cy < height - 1) stack.push(at + width);
  }
  return cells;
}

/**
 * RGBA bytes of the picture scaled by a whole factor, nearest neighbour: every cell becomes a `scale × scale` block
 * of one colour, so no in-between colours appear. Transparent cells stay at alpha 0.
 */
export function pixelBytes(doc: PixelDocument, scale = 1): Uint8ClampedArray {
  const s = clampScale(scale);
  const w = doc.width * s;
  const bytes = new Uint8ClampedArray(w * doc.height * s * 4);
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      const color = doc.palette[doc.cells[y * doc.width + x]] ?? doc.palette[0];
      for (let by = 0; by < s; by++) {
        let at = ((y * s + by) * w + x * s) * 4;
        for (let bx = 0; bx < s; bx++, at += 4) bytes.set(color, at);
      }
    }
  }
  return bytes;
}

/** The export scale as a whole number 1…64. */
export const clampScale = (scale: number) => (Number.isFinite(scale) ? Math.min(64, Math.max(1, Math.round(scale))) : 1);

export const sameDocument = (a: PixelDocument, b: PixelDocument) =>
  a === b ||
  (a.width === b.width &&
    a.height === b.height &&
    a.palette.length === b.palette.length &&
    a.palette.every((c, i) => c.every((v, j) => v === b.palette[i][j])) &&
    a.cells.length === b.cells.length &&
    a.cells.every((v, i) => v === b.cells[i]));

/** `#rrggbb` (with `aa` when not opaque) of a palette colour. */
export function colorHex([r, g, b, a]: PixelColor): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? '' : hex(a)}`;
}
