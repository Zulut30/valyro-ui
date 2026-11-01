import { clamp } from '../primitives';

/** Where a value sits relative to the optimum, as the HTML `<meter>` element decides it. */
export type MeterRegion = 'optimum' | 'suboptimum' | 'even-less-good';

export interface MeterRange {
  min: number;
  max: number;
  low: number;
  high: number;
  optimum: number;
}

export interface MeterRangeInput {
  min?: number;
  max?: number;
  low?: number;
  high?: number;
  optimum?: number;
}

const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The bounds of a meter after the HTML rules: min 0, max 100 (and never below min); low and high default to
 * the ends and are clamped into the range (high not below low); optimum defaults to the middle.
 */
export function meterRange({ min, max, low, high, optimum }: MeterRangeInput = {}): MeterRange {
  const lo = finite(min) ? min : 0;
  const hi = finite(max) ? Math.max(max, lo) : Math.max(100, lo);
  const l = finite(low) ? clamp(low, lo, hi) : lo;
  const h = finite(high) ? clamp(high, l, hi) : hi;
  const o = finite(optimum) ? clamp(optimum, lo, hi) : lo + (hi - lo) / 2;
  return { min: lo, max: hi, low: l, high: h, optimum: o };
}

/**
 * The region of `value` (clamped into the range) with the HTML `<meter>` algorithm: when the optimum lies
 * between low and high, that band is optimum and both ends suboptimum; when it lies below low, "less is
 * better" (value ≤ low optimum, up to high suboptimum, above high even less good); above high, the reverse.
 */
export function meterRegion(value: number, range: MeterRangeInput = {}): MeterRegion {
  const { min, max, low, high, optimum } = meterRange(range);
  const v = clamp(finite(value) ? value : min, min, max);
  if (optimum < low) {
    if (v <= low) return 'optimum';
    if (v <= high) return 'suboptimum';
    return 'even-less-good';
  }
  if (optimum > high) {
    if (v >= high) return 'optimum';
    if (v >= low) return 'suboptimum';
    return 'even-less-good';
  }
  return v >= low && v <= high ? 'optimum' : 'suboptimum';
}

/** The kit colour of each region. */
export const METER_TONES: Record<MeterRegion, 'success' | 'warning' | 'danger'> = {
  optimum: 'success',
  suboptimum: 'warning',
  'even-less-good': 'danger',
};
