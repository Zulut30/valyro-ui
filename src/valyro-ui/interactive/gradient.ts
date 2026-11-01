/*
 * The data model of Gradient Mixer and its one serializer: the preview and the exported CSS are built by the same
 * function, so the copied CSS reproduces the preview at the same box size.
 */

export interface GradientPoint {
  /** Stable id of the layer. */
  id: string;
  /** Centre as a share of the width, 0…1. */
  x: number;
  /** Centre as a share of the height, 0…1. */
  y: number;
  /** Horizontal radius in percent of the width, 1…200. */
  radiusX: number;
  /** Vertical radius in percent of the height, 1…200. */
  radiusY: number;
  /** `#RRGGBB`. The layer fades to the same colour at zero alpha. */
  color: string;
  /** 0…1. */
  opacity: number;
}

export interface GradientValue {
  /** Base colour under every layer, `#RRGGBBAA`. */
  background: string;
  /** Layers; the first one is the top CSS layer. */
  points: GradientPoint[];
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX8 = /^#[0-9a-f]{8}$/i;

export const isHex6 = (value: string) => HEX6.test(value);
export const isHex8 = (value: string) => HEX8.test(value);

const clampNumber = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** A number with at most two decimals and no trailing zeros. */
const fmt = (value: number) => String(Math.round(value * 100) / 100);

/** A colour from a colour field (`#rgb`, `#rrggbb`, `#rrggbbaa`) as `#rrggbb`, or null. */
export function toHex6(value: string): string | null {
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  if (HEX6.test(hex)) return hex;
  if (HEX8.test(hex)) return hex.slice(0, 7);
  return null;
}

/** A colour as `#rrggbbaa` (opaque when it has no alpha), or null. */
export function toHex8(value: string): string | null {
  const hex = value.trim().toLowerCase();
  if (HEX8.test(hex)) return hex;
  const six = toHex6(hex);
  return six ? `${six}ff` : null;
}

/** The point with every number in its range; an invalid colour becomes black. */
export function normalizePoint(point: GradientPoint): GradientPoint {
  return {
    id: point.id,
    x: clampNumber(point.x, 0, 1, 0.5),
    y: clampNumber(point.y, 0, 1, 0.5),
    radiusX: clampNumber(point.radiusX, 1, 200, 50),
    radiusY: clampNumber(point.radiusY, 1, 200, 50),
    color: toHex6(point.color) ?? '#000000',
    opacity: clampNumber(point.opacity, 0, 1, 1),
  };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');

/** One CSS layer: an ellipse with its two radii, fading from the colour to the same colour at zero alpha. */
export function gradientLayer(point: GradientPoint): string {
  const p = normalizePoint(point);
  const color = rgb(p.color);
  return `radial-gradient(${fmt(p.radiusX)}% ${fmt(p.radiusY)}% at ${fmt(p.x * 100)}% ${fmt(p.y * 100)}%, rgb(${color} / ${fmt(p.opacity)}) 0%, rgb(${color} / 0) 100%)`;
}

/** Background colour and image of the composition, for an element's style. */
export function gradientStyle(value: GradientValue): { backgroundColor: string; backgroundImage: string } {
  return {
    backgroundColor: toHex8(value.background) ?? '#00000000',
    backgroundImage: value.points.length ? value.points.map(gradientLayer).join(', ') : 'none',
  };
}

/** The composition as CSS declarations, ready to paste into a rule. */
export function gradientToCss(value: GradientValue): string {
  const style = gradientStyle(value);
  const layers = value.points.map(gradientLayer);
  const image = layers.length ? `\n  ${layers.join(',\n  ')}` : ' none';
  return `background-color: ${style.backgroundColor};\nbackground-image:${image};`;
}

/** Whether two compositions are equal field by field. */
export function sameGradient(a: GradientValue, b: GradientValue): boolean {
  if (a === b) return true;
  if (a.background !== b.background || a.points.length !== b.points.length) return false;
  return a.points.every((p, i) => {
    const q = b.points[i];
    return p.id === q.id && p.x === q.x && p.y === q.y && p.radiusX === q.radiusX && p.radiusY === q.radiusY && p.color === q.color && p.opacity === q.opacity;
  });
}

/** Where new layers appear, in turn: predictable, not random. */
const SPAWN: [number, number][] = [
  [0.5, 0.5],
  [0.25, 0.3],
  [0.75, 0.3],
  [0.3, 0.75],
  [0.7, 0.72],
  [0.5, 0.2],
  [0.15, 0.55],
  [0.85, 0.55],
];

/** A new layer with an id not used yet and the next spawn position. */
export function newPoint(points: readonly GradientPoint[], color: string): GradientPoint {
  const used = new Set(points.map((p) => p.id));
  let n = points.length + 1;
  while (used.has(`point-${n}`)) n++;
  const [x, y] = SPAWN[points.length % SPAWN.length];
  return { id: `point-${n}`, x, y, radiusX: 45, radiusY: 45, color: toHex6(color) ?? '#6366f1', opacity: 0.8 };
}

/** Moves the layer one place up (towards the top, index 0) or down; the same array when it cannot move. */
export function movePoint(points: GradientPoint[], id: string, direction: -1 | 1): GradientPoint[] {
  const from = points.findIndex((p) => p.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= points.length) return points;
  const next = [...points];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Removes the layer and says which one to select next: the one that took its place, else the one above. */
export function removePoint(points: GradientPoint[], id: string): { points: GradientPoint[]; selected: string | null } {
  const index = points.findIndex((p) => p.id === id);
  if (index < 0) return { points, selected: null };
  const next = points.filter((p) => p.id !== id);
  return { points: next, selected: next[Math.min(index, next.length - 1)]?.id ?? null };
}

export const DEFAULT_GRADIENT: GradientValue = {
  background: '#0f172aff',
  points: [
    { id: 'point-1', x: 0.2, y: 0.25, radiusX: 60, radiusY: 55, color: '#6366f1', opacity: 0.9 },
    { id: 'point-2', x: 0.8, y: 0.3, radiusX: 55, radiusY: 60, color: '#ec4899', opacity: 0.75 },
    { id: 'point-3', x: 0.5, y: 0.85, radiusX: 70, radiusY: 50, color: '#14b8a6', opacity: 0.8 },
  ],
};
