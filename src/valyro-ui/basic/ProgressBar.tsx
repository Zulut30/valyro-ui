'use client';

import { useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { clamp, cx, useSpringValue } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import '../primitives/motion.css';
import './ProgressBar.css';
import { withRef, useId } from '../primitives/react-compat';

export interface ProgressBarProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Omit (or pass a non-finite number) for an indeterminate bar. */
  value?: number;
  /** Value of a full bar; `value` is clamped to 0…max. A non-positive or non-finite max falls back to 100. */
  max?: number;
  /** Fill color: the theme accent, a status color, or the foreground (`neutral`). */
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  /** Track thickness. */
  size?: 'sm' | 'md' | 'lg';
  /** Visible caption above the bar; also names the progressbar unless `aria-label` is given. */
  label?: ReactNode;
  /** Show the percentage next to the label. */
  showValue?: boolean;
  /** Locale for the percentage (default: the ThemeProvider's, then the browser's). */
  locale?: string;
  /** Custom value text (shown and announced), e.g. "3 of 8 files". */
  formatValue?: (value: number, max: number) => string;
  /**
   * `spring`: the fill springs to each new value (a transform, not a width change, and without overshoot)
   * and the shown number counts along with it. `default`: the theme's width transition.
   */
  animation?: 'default' | 'spring';
}

/** ARIA naming props (`aria-label`, `aria-labelledby`, `aria-describedby`) go to the progressbar element; the rest to the root. */
export const ProgressBar = withRef(function ProgressBar({
  value,
  max = 100,
  color = 'accent',
  size = 'md',
  label,
  showValue = false,
  locale: localeProp,
  formatValue,
  animation = 'default',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: ProgressBarProps) {
  const labelId = useId();
  const locale = useLocale(localeProp);
  // An empty or invalid range falls back to 100; an invalid value means "indeterminate".
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const current = typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, safeMax) : null;
  const indeterminate = current === null;
  const ratio = indeterminate ? 0 : current / safeMax;
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  );
  const valueText = indeterminate ? undefined : formatValue ? formatValue(current, safeMax) : percentFormat.format(ratio);
  const spring = animation === 'spring';

  // Spring: the shown number counts towards the value frame by frame, written straight to the DOM; React
  // keeps the first text, so it never overwrites a count in flight. The progressbar's aria-valuetext stays exact.
  const valueRef = useRef<HTMLSpanElement>(null);
  const [firstText] = useState(valueText);
  const format = (n: number) => (formatValue ? formatValue(Math.round(n), safeMax) : percentFormat.format(n / safeMax));
  useSpringValue(
    current ?? 0,
    (n) => {
      if (valueRef.current) valueRef.current.textContent = format(n);
    },
    { spring: 'smooth', tempoRef: valueRef, enabled: spring && !indeterminate },
  );

  const fillStyle: CSSProperties | undefined = indeterminate
    ? undefined
    : spring
      ? ({ '--_ratio': ratio } as CSSProperties)
      : { width: `${ratio * 100}%` };

  return (
    <div className={cx('ui-progress', className)} data-size={size} data-color={color} data-motion={spring ? 'spring' : undefined} {...rest}>
      {(label || (showValue && valueText)) && (
        <div className="ui-progress__header">
          {label && (
            <span id={labelId} className="ui-progress__label">
              {label}
            </span>
          )}
          {showValue && valueText && (
            <span ref={valueRef} className="ui-progress__value" aria-hidden="true">
              {spring ? firstText : valueText}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={current ?? undefined}
        aria-valuetext={valueText}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ?? (label && !ariaLabel ? labelId : undefined)}
        aria-describedby={ariaDescribedBy}
        className="ui-progress__track"
        data-indeterminate={indeterminate || undefined}
      >
        <div className="ui-progress__fill" style={fillStyle} />
      </div>
    </div>
  );
});
