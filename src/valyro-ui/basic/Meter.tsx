'use client';

import { useMemo, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { clamp, cx } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { METER_TONES, meterRange, meterRegion, type MeterRegion } from './meter-region';
import { percentFormat } from './progress';
import './Meter.css';
import { withRef, useId } from '../primitives/react-compat';

export interface MeterLabels {
  /** Status read after the value while it is in the optimum region. */
  optimum: string;
  /** Status in the suboptimum region. */
  suboptimum: string;
  /** Status in the region farthest from the optimum. */
  critical: string;
}

export const defaultMeterLabels: MeterLabels = {
  optimum: 'normal',
  suboptimum: 'warning',
  critical: 'critical',
};

export interface MeterProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'color'> {
  /** The measured value, clamped to min…max. */
  value: number;
  /** Lower end of the scale (default 0). */
  min?: number;
  /** Upper end of the scale (default 100; never below `min`). */
  max?: number;
  /** Upper bound of the low region, as on the HTML `<meter>`. */
  low?: number;
  /** Lower bound of the high region, as on the HTML `<meter>`. */
  high?: number;
  /**
   * The best value. With `low` / `high` it decides the colour: an optimum below `low` means "less is better"
   * (storage, quotas), above `high` "more is better" (battery, password strength).
   */
  optimum?: number;
  /** `auto` follows the region of the value when thresholds are set (else the accent); any other value fixes the colour. */
  color?: 'auto' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  /** Visible caption above the bar; also names the meter unless `aria-label` is given. */
  label?: ReactNode;
  /** Show the value next to the label. */
  showValue?: boolean;
  /** Custom value text (shown and announced), e.g. "7.4 of 10 GB". */
  formatValue?: (value: number, min: number, max: number) => string;
  /** Locale for the percentage (default: the ThemeProvider's, then the browser's). */
  locale?: string;
  /** Bar thickness. */
  size?: 'sm' | 'md' | 'lg';
  /** Tick marks at `low` and `high` on the track. */
  showThresholds?: boolean;
  /** Status words added to the announced value when thresholds are set. */
  labels?: Partial<MeterLabels>;
}

const STATUS_KEY: Record<MeterRegion, keyof MeterLabels> = {
  optimum: 'optimum',
  suboptimum: 'suboptimum',
  'even-less-good': 'critical',
};

/**
 * A measurement on a known scale (storage used, battery, password strength): `role="meter"`, not a progress
 * bar. With `low` / `high` / `optimum` it colours itself like the HTML `<meter>` and announces the status.
 */
export const Meter = withRef(function Meter({
  value,
  min,
  max,
  low,
  high,
  optimum,
  color = 'auto',
  label,
  showValue = false,
  formatValue,
  locale: localeProp,
  size = 'md',
  showThresholds = false,
  labels: labelsProp,
  className,
  style,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...rest
}: MeterProps) {
  const labelId = useId();
  const locale = useLocale(localeProp);
  const labels = { ...defaultMeterLabels, ...labelsProp };
  const range = meterRange({ min, max, low, high, optimum });
  const current = clamp(Number.isFinite(value) ? value : range.min, range.min, range.max);
  const span = range.max - range.min;
  const ratio = span > 0 ? (current - range.min) / span : 0;
  const share = (n: number) => (span > 0 ? (n - range.min) / span : 0);
  const thresholds = low !== undefined || high !== undefined || optimum !== undefined;
  const region = thresholds ? meterRegion(current, range) : null;
  const tone = color === 'auto' ? (region ? METER_TONES[region] : 'accent') : color;

  const format = useMemo(() => percentFormat(locale), [locale]);
  const text = formatValue ? formatValue(current, range.min, range.max) : format.format(ratio);
  const valueText = region ? `${text}, ${labels[STATUS_KEY[region]]}` : text;

  const ticks = showThresholds
    ? [low !== undefined ? range.low : null, high !== undefined ? range.high : null].filter(
        (n, i, all): n is number => n !== null && n > range.min && n < range.max && all.indexOf(n) === i,
      )
    : [];

  return (
    <div
      role="meter"
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={current}
      aria-valuetext={valueText}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (label && !ariaLabel ? labelId : undefined)}
      {...rest}
      className={cx('ui-meter', className)}
      style={{ '--_ratio': ratio, ...style } as CSSProperties}
      data-size={size}
      data-color={tone}
      data-region={region ?? undefined}
    >
      {(label || showValue) && (
        <div className="ui-meter__header">
          {label && (
            <span id={labelId} className="ui-meter__label">
              {label}
            </span>
          )}
          {showValue && (
            <span className="ui-meter__value" aria-hidden="true">
              {text}
            </span>
          )}
        </div>
      )}
      <div className="ui-meter__bar">
        <div className="ui-meter__track">
          <div className="ui-meter__indicator" />
        </div>
        {ticks.map((n) => (
          <span key={n} className="ui-meter__threshold" style={{ '--_at': share(n) } as CSSProperties} />
        ))}
      </div>
    </div>
  );
});
