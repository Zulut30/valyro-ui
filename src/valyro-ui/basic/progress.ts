import { clamp } from '../primitives';

/*
 * What ProgressCircle and Meter share (and ProgressBar will move onto): the value checks, the formatted
 * value, the CSS pattern that lets a spring count run in the locale's digits without a frame loop, and the
 * ring geometry. Pure functions, no DOM, so they run the same on the server.
 */

/** CSS counter styles for Intl's numbering systems, so a spring count can run in CSS in the locale's digits. */
const COUNTER_STYLES: Record<string, string> = {
  latn: 'decimal',
  arab: 'arabic-indic',
  arabext: 'persian',
  beng: 'bengali',
  deva: 'devanagari',
  gujr: 'gujarati',
  guru: 'gurmukhi',
  hanidec: 'cjk-decimal',
  khmr: 'khmer',
  knda: 'kannada',
  laoo: 'lao',
  mlym: 'malayalam',
  mong: 'mongolian',
  mymr: 'myanmar',
  orya: 'oriya',
  tamldec: 'tamil',
  telu: 'telugu',
  thai: 'thai',
  tibt: 'tibetan',
};

const cssString = (text: string) => `"${text.replace(/["\\]/g, '\\$&')}"`;

export interface NormalizedProgress {
  /** The usable maximum: a non-positive or non-finite max falls back to 100. */
  max: number;
  /** `value` clamped to 0…max, or null (indeterminate) when it is missing or not finite. */
  value: number | null;
  /** value / max, 0 while indeterminate. */
  ratio: number;
}

/** A progress value checked like ProgressBar does: max ≤ 0 or NaN → 100, a missing or NaN value → indeterminate. */
export function normalizeProgress(value: number | null | undefined, max: number | undefined = 100): NormalizedProgress {
  const safeMax = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 100;
  const current = typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, safeMax) : null;
  return { max: safeMax, value: current, ratio: current === null ? 0 : current / safeMax };
}

/** A whole-percent formatter for `locale` (the kit's default value text). */
export function percentFormat(locale: string | undefined) {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
}

/** The whole percent Intl shows for `ratio` (its rounding, not Math.round of a float). */
const wholePercentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0, useGrouping: false });
export const wholePercent = (ratio: number) => Number.parseInt(wholePercentFormat.format(ratio), 10);

/**
 * The text around a percentage's whole number and its digits as CSS (`content` strings, a counter style),
 * for a count that springs in CSS; null when CSS can't write the locale's format.
 */
export function percentPattern(format: Intl.NumberFormat): Record<string, string> | null {
  const digits = COUNTER_STYLES[format.resolvedOptions().numberingSystem];
  const parts = format.formatToParts(0.5);
  const at = parts.findIndex((part) => part.type === 'integer');
  if (!digits || at < 0 || parts.some((part, i) => i !== at && part.type !== 'percentSign' && part.type !== 'literal')) return null;
  const text = (from: number, to?: number) => cssString(parts.slice(from, to).map((part) => part.value).join(''));
  return { '--_progress-before': text(0, at), '--_progress-after': text(at + 1), '--_progress-digits': digits };
}

export interface RingGeometry {
  /** Stroke width in viewBox units (the viewBox is 0 0 100 100). */
  stroke: number;
  /** Circle radius in viewBox units, so the whole stroke stays inside the box. */
  radius: number;
}

/**
 * A ring of `thickness` px drawn in a `size` px box, in the 0…100 viewBox units the SVG uses. The thickness
 * is kept between a hairline and a filled disc.
 */
export function ringGeometry(size: number, thickness: number): RingGeometry {
  const box = Number.isFinite(size) && size > 0 ? size : 40;
  const width = Number.isFinite(thickness) && thickness > 0 ? thickness : box / 10;
  const stroke = clamp((width / box) * 100, 1, 50);
  return { stroke, radius: 50 - stroke / 2 };
}
