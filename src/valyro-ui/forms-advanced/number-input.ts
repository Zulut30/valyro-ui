import { clamp } from '../primitives';

/** Pure number math for NumberInput: parsing, formatting, clamping and stepping. */

export interface NumberBounds {
  min?: number;
  max?: number;
  /** Decimal places committed values are rounded to. Omit to keep what the user typed. */
  precision?: number;
}

/** Number of decimal places in `n` (0.25 → 2, 1e-7 → 7). */
export function countDecimals(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const [mantissa, exponent] = n.toExponential().split('e');
  const fraction = mantissa.split('.')[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent));
}

export function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** Clamps to the bounds and applies `precision`. */
export function normalizeNumber(value: number, { min, max, precision }: NumberBounds = {}): number {
  const rounded = precision === undefined ? value : roundTo(value, precision);
  return clamp(rounded, min ?? -Infinity, max ?? Infinity);
}

/**
 * Value after one step of `delta` (already multiplied by step and modifiers).
 * An empty value starts at `min` when stepping up, `max` when stepping down, otherwise 0.
 */
export function stepNumber(value: number | null, delta: number, bounds: NumberBounds = {}): number {
  if (value === null) {
    const start = delta > 0 ? (bounds.min ?? 0) : (bounds.max ?? 0);
    return normalizeNumber(start, bounds);
  }
  // Round away binary noise (0.1 + 0.2) before clamping.
  const precision = bounds.precision ?? Math.max(countDecimals(value), countDecimals(delta));
  return normalizeNumber(roundTo(value + delta, precision), bounds);
}

export function formatNumber(value: number | null, locale?: string, options?: Intl.NumberFormatOptions): string {
  return value === null ? '' : new Intl.NumberFormat(locale, options).format(value);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lenient parser for text typed into a formatted field: accepts the locale's
 * grouping/decimal separators and the currency/percent/unit affixes of
 * `options`. Returns null for empty or invalid text. Percent text is divided
 * by 100 so "45%" round-trips to 0.45 like Intl formats it.
 */
export function parseNumber(text: string, locale?: string, options: Intl.NumberFormatOptions = {}): number | null {
  const parts = new Intl.NumberFormat(locale, options).formatToParts(-12345.6);
  const plain = new Intl.NumberFormat(locale).formatToParts(-12345.6);
  const pick = (type: Intl.NumberFormatPartTypes) =>
    [...parts, ...plain].filter((p) => p.type === type).map((p) => p.value);
  const affixes = pick('currency').concat(pick('percentSign'), pick('unit'), pick('literal'));
  const group = pick('group')[0];
  const decimal = pick('decimal')[0] ?? '.';

  let s = text;
  for (const affix of affixes) if (affix.trim()) s = s.split(affix).join('');
  s = s.replace(/[\s\u00a0\u202f]/g, '').replace(/[\u2212\u2012\u2013]/g, '-');
  if (group && group.trim()) s = s.split(group).join('');
  if (decimal !== '.') s = s.replace(new RegExp(escapeRe(decimal)), '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return options.style === 'percent' ? roundTo(n / 100, countDecimals(n) + 2) : n;
}

/** Hold time before a pressed stepper button starts repeating, in ms. */
export const REPEAT_START_DELAY = 400;

/** Pause before the next automatic step: repeats speed up from 150 ms down to 40 ms the longer the button is held. */
export function repeatDelay(repeats: number): number {
  return Math.max(40, Math.round(150 * 0.9 ** repeats));
}
