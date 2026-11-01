'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { cx, mergeRefs, useEventCallback, useSpringValue } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { normalizeProgress, percentFormat, percentPattern, ringGeometry, wholePercent } from './progress';
import './ProgressCircle.css';
import { withRef, useId } from '../primitives/react-compat';

const SIZES = { sm: 24, md: 40, lg: 64 } as const;

export interface ProgressCircleProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'color'> {
  /** Omit (or pass a non-finite number) for an indeterminate ring. */
  value?: number;
  /** Value of a full ring; `value` is clamped to 0…max. A non-positive or non-finite max falls back to 100. */
  max?: number;
  /** Diameter: `sm` 24px, `md` 40px, `lg` 64px, or a number of pixels. */
  size?: 'sm' | 'md' | 'lg' | number;
  /** Ring width in pixels. Default: the theme's share of the diameter (`--ui-progress-circle-thickness`, 10 %). */
  thickness?: number;
  /** Ring colour: the theme accent, a status colour, or the foreground (`neutral`). */
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  /** Caption under the ring; also names the progressbar unless `aria-label` is given. */
  label?: ReactNode;
  /** Keep `label` as the accessible name only, without showing it. */
  hideLabel?: boolean;
  /**
   * Text in the centre: `true` shows the formatted value, a node shows itself (e.g. "3/5"), `false` nothing.
   * Default: the value on `md` and larger rings, nothing on `sm`.
   */
  showValue?: boolean | ReactNode;
  /** Custom value text (shown and announced), e.g. "3 of 8 files". */
  formatValue?: (value: number, max: number) => string;
  /** Locale for the percentage (default: the ThemeProvider's, then the browser's). */
  locale?: string;
  /**
   * `spring`: the arc springs to each new value and the shown number counts along with it.
   * `default`: the theme's ease.
   */
  animation?: 'default' | 'spring';
}

/**
 * A circular progress indicator with ProgressBar's API: a determinate arc that glides to each value, or an
 * indeterminate spinning arc. Rest props, `ref` and ARIA go to the root, which is the progressbar.
 */
export const ProgressCircle = withRef(function ProgressCircle({
  value,
  max = 100,
  size = 'md',
  thickness,
  color = 'accent',
  label,
  hideLabel = false,
  showValue,
  formatValue,
  locale: localeProp,
  animation = 'default',
  className,
  style,
  ref,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...rest
}: ProgressCircleProps) {
  const labelId = useId();
  const locale = useLocale(localeProp);
  const { max: safeMax, value: current, ratio } = normalizeProgress(value, max);
  const indeterminate = current === null;
  const px = typeof size === 'number' ? (Number.isFinite(size) && size > 0 ? size : SIZES.md) : SIZES[size] ?? SIZES.md;
  const format = useMemo(() => percentFormat(locale), [locale]);
  const valueText = indeterminate ? undefined : formatValue ? formatValue(current, safeMax) : format.format(ratio);
  const spring = animation === 'spring';

  // While indeterminate the arc and the number keep the last value (faded out), so a value that comes back
  // glides from there instead of restarting at 0.
  const last = useRef(current ?? 0);
  if (current !== null) last.current = current;
  const shownValue = current ?? last.current;
  const arcRatio = shownValue / safeMax;
  const shownText = formatValue ? formatValue(shownValue, safeMax) : format.format(arcRatio);

  const showsValue = showValue === undefined ? px >= SIZES.md : showValue !== false;
  const customValue = showValue !== undefined && typeof showValue !== 'boolean' ? showValue : null;
  // Spring with the percentage: the count is a CSS transition of a registered integer, written by a counter
  // in the locale's digits (ProgressCircle.css), so no frame loop runs. A custom formatValue counts in JS.
  const pattern = useMemo(() => (spring && !formatValue ? percentPattern(format) : null), [spring, formatValue, format]);

  const valueRef = useRef<HTMLSpanElement | null>(null);
  const [firstText] = useState(shownText);
  const writeCount = (n: number) => (formatValue ? formatValue(Math.round(n), safeMax) : format.format(n / safeMax));
  const shown = useRef(shownValue);
  useSpringValue(
    shownValue,
    (n) => {
      shown.current = n;
      if (valueRef.current) valueRef.current.textContent = writeCount(n);
    },
    { spring: 'smooth', tempoRef: valueRef, enabled: spring && !pattern },
  );
  const attachValue = useEventCallback((node: HTMLSpanElement | null) => {
    valueRef.current = node;
    if (node && spring && !pattern) node.textContent = writeCount(shown.current);
  });

  // The endless spin pauses while the ring is off screen.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!indeterminate || !node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) delete node.dataset.offscreen;
      else node.dataset.offscreen = '';
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      delete node.dataset.offscreen;
    };
  }, [indeterminate]);

  const geometry = thickness !== undefined ? ringGeometry(px, thickness) : null;
  const rootStyle = {
    '--_size': `${px}px`,
    ...(geometry ? { '--_stroke': geometry.stroke } : null),
    ...style,
  } as CSSProperties;
  // The fallback radius for browsers without the CSS `r` property: the default 10 % ring.
  const radius = geometry ? geometry.radius : 45;

  let centre: ReactNode = null;
  if (showsValue) {
    if (customValue !== null) centre = <span className="ui-progress-circle__value">{customValue}</span>;
    else if (pattern)
      centre = (
        <span
          className="ui-progress-circle__value"
          data-count=""
          style={{ ...pattern, '--_progress-circle-count': wholePercent(arcRatio) } as CSSProperties}
        />
      );
    else
      centre = (
        <span ref={attachValue} className="ui-progress-circle__value">
          {spring ? firstText : shownText}
        </span>
      );
  }

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={current ?? undefined}
      aria-valuetext={valueText}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (label && !ariaLabel ? labelId : undefined)}
      {...rest}
      ref={mergeRefs(rootRef, ref)}
      className={cx('ui-progress-circle', className)}
      style={rootStyle}
      data-color={color}
      data-size={typeof size === 'number' ? undefined : size}
      data-motion={spring ? 'spring' : undefined}
      data-indeterminate={indeterminate || undefined}
      data-empty={!indeterminate && ratio === 0 ? '' : undefined}
    >
      <span className="ui-progress-circle__ring">
        <svg className="ui-progress-circle__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle className="ui-progress-circle__track" cx="50" cy="50" r={radius} />
          <circle
            className="ui-progress-circle__range"
            cx="50"
            cy="50"
            r={radius}
            pathLength={1}
            style={{ '--_ratio': arcRatio } as CSSProperties}
          />
          <circle className="ui-progress-circle__spinner" cx="50" cy="50" r={radius} pathLength={1} />
        </svg>
        {centre && (
          <span className="ui-progress-circle__centre" aria-hidden="true">
            {centre}
          </span>
        )}
      </span>
      {label && (
        <span id={labelId} className={cx('ui-progress-circle__label', hideLabel && 'ui-sr-only')}>
          {label}
        </span>
      )}
    </div>
  );
});
