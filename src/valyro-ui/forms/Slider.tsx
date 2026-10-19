'use client';

import { useMemo, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clamp, cx, getDirection, inlineArrowStep, useControllableState, type Direction } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { useFormField } from '../forms-advanced/form-field-context';
import './Slider.css';
import { withRef, useId } from '../primitives/react-compat';

/* ── Pure value math (unit-tested in slider.test.ts) ── */

function decimalsOf(n: number) {
  const [, exponent] = String(n).split('e-');
  if (exponent) return Number(exponent);
  return (String(n).split('.')[1] ?? '').length;
}

export function valueToPercent(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** Rounds to the nearest step counted from `min`, clamps to the range and strips float noise (0.1 + 0.2). */
export function snapToStep(value: number, min: number, max: number, step: number) {
  if (step <= 0) return clamp(value, min, max);
  const snapped = min + Math.round((value - min) / step) * step;
  const decimals = Math.max(decimalsOf(step), decimalsOf(min));
  return clamp(Number(snapped.toFixed(decimals)), min, max);
}

export function percentToValue(percent: number, min: number, max: number, step: number) {
  return snapToStep(min + (clamp(percent, 0, 100) / 100) * (max - min), min, max, step);
}

/** Position of `clientX` along a track as a percent from its inline start (the right edge in RTL). */
export function pointerPercent(clientX: number, track: { left: number; width: number }, direction: Direction) {
  if (track.width <= 0) return 0;
  const fromLeft = ((clientX - track.left) / track.width) * 100;
  return direction === 'rtl' ? 100 - fromLeft : fromLeft;
}

/** Moves one thumb; in a range it cannot pass its neighbour. */
export function setThumbValue(values: readonly number[], index: number, next: number, min: number, max: number, step: number) {
  const lower = index > 0 ? values[index - 1] : min;
  const upper = index < values.length - 1 ? values[index + 1] : max;
  const result = [...values];
  result[index] = clamp(snapToStep(next, min, max, step), lower, upper);
  return result;
}

/** Thumb that a press at `value` should grab; stacked thumbs split by direction. */
export function closestThumb(values: readonly number[], value: number) {
  if (values.length < 2) return 0;
  const [low, high] = values;
  if (low === high) return value > high ? 1 : 0;
  return Math.abs(value - low) <= Math.abs(value - high) ? 0 : 1;
}

/* ── Component ── */

type SliderValue = number | [number, number];
type Widen<T> = T extends number ? number : [number, number];

export interface SliderMark {
  value: number;
  label?: ReactNode;
}

export interface SliderProps<T extends SliderValue = number>
  extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** A number for one thumb, a `[from, to]` tuple for a range. */
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: Widen<T>) => void;
  /** Lowest value, at the start of the track; steps are counted from it. */
  min?: number;
  /** Highest value, at the end of the track. */
  max?: number;
  /** Snapping interval; 0 = continuous. */
  step?: number;
  /** Ticks on the track, with optional labels below it. */
  marks?: SliderMark[];
  /** Value bubble over the thumb: `true` while hovered/focused/dragged, `'always'` permanently. */
  tooltip?: boolean | 'always';
  /** Text for the bubble and aria-valuetext. Default: the number formatted for `locale`. */
  formatValue?: (value: number) => string;
  /** Locale for the default `formatValue` (default: the ThemeProvider's, then the browser's). */
  locale?: string;
  /** Words appended to the accessible name of each range thumb, e.g. "Price minimum". */
  thumbLabels?: [string, string];
  /** Ignores pointer and keyboard input, takes the thumbs out of Tab order and leaves the value out of form data. */
  disabled?: boolean;
  /** Submits the value(s) with the surrounding form through hidden inputs. */
  name?: string;
  /** Error state, e.g. from a FormField: aria-invalid on the thumbs (an explicit `aria-invalid` wins). */
  invalid?: boolean;
}

const DEFAULT_THUMB_LABELS: [string, string] = ['minimum', 'maximum'];

/** Single-value or range slider. aria-label / aria-labelledby / aria-describedby are applied to the thumbs. */
export const Slider = withRef(function Slider<T extends SliderValue = number>({
  value: valueProp,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  marks,
  tooltip = false,
  formatValue: formatValueProp,
  locale,
  thumbLabels = DEFAULT_THUMB_LABELS,
  disabled = false,
  name,
  invalid = false,
  className,
  onPointerDown,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledByProp,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: SliderProps<T>) {
  // Inside a FormField the label names the thumbs: its `for` points at this div, which is not labelable.
  const field = useFormField();
  const ariaLabelledBy = ariaLabelledByProp ?? (ariaLabel ? undefined : field?.labelId);
  const [value, setValue] = useControllableState<SliderValue>({
    value: valueProp,
    defaultValue: defaultValue ?? min,
    onChange: onValueChange as ((value: SliderValue) => void) | undefined,
  });
  const isRange = Array.isArray(value);
  const values: number[] = isRange ? value : [value];
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const id = useId();
  const resolvedLocale = useLocale(locale);
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(resolvedLocale, { maximumFractionDigits: 20 }),
    [resolvedLocale],
  );
  const formatValue = formatValueProp ?? numberFormat.format;

  const commit = (index: number, next: number) => {
    const nextValues = setThumbValue(values, index, next, min, max, step);
    if (nextValues.every((v, i) => v === values[i])) return;
    setValue(isRange ? [nextValues[0], nextValues[1]] : nextValues[0]);
  };

  const valueAt = (clientX: number) => {
    const track = trackRef.current;
    const rect = track?.getBoundingClientRect();
    if (!rect || rect.width === 0) return min;
    return percentToValue(pointerPercent(clientX, rect, getDirection(track)), min, max, step);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event);
    if (disabled || event.defaultPrevented || event.button !== 0) return;
    // Stops text selection and the browser's own focus handling; the grabbed thumb is focused below.
    event.preventDefault();
    const next = valueAt(event.clientX);
    const index = closestThumb(values, next);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(index);
    thumbRefs.current[index]?.focus();
    commit(index, next);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging !== null) commit(dragging, valueAt(event.clientX));
  };

  const endDrag = () => setDragging(null);

  // step 0 means continuous; keys then move by 1% of the range.
  const keyStep = step > 0 ? step : (max - min) / 100;
  const pageStep = keyStep * Math.max(1, Math.round((max - min) / keyStep / 10));

  const handleThumbKeyDown = (index: number) => (event: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    const current = values[index];
    // Left/Right follow the track, which runs right-to-left under dir="rtl"; Up/Down always increase/decrease.
    const inline = inlineArrowStep(event.key, getDirection(event.currentTarget));
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        next = current + inline * keyStep;
        break;
      case 'ArrowUp':
        next = current + keyStep;
        break;
      case 'ArrowDown':
        next = current - keyStep;
        break;
      case 'PageUp':
        next = current + pageStep;
        break;
      case 'PageDown':
        next = current - pageStep;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    commit(index, next);
  };

  const start = isRange ? valueToPercent(values[0], min, max) : 0;
  const end = valueToPercent(values[values.length - 1], min, max);
  const inFill = (v: number) => (isRange ? v >= values[0] && v <= values[1] : v <= values[0]);
  const labelledMarks = marks?.filter((mark) => mark.label != null) ?? [];

  return (
    <div
      {...rest}
      className={cx('ui-slider', className)}
      data-disabled={disabled || undefined}
      data-dragging={dragging !== null || undefined}
      data-tooltip={tooltip === 'always' ? 'always' : tooltip ? 'auto' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <div className="ui-slider__control">
        <div ref={trackRef} className="ui-slider__track">
          {/* A single value fills from the start of the drawn bar, which runs half a thumb past the rail. */}
          <div
            className="ui-slider__range"
            style={{ insetInlineStart: isRange ? `${start}%` : 'calc(var(--_thumb-w) / -2)', insetInlineEnd: `${100 - end}%` }}
          />
          {/* The rounded track ends already mark min and max; dots there would poke out of the capsule. */}
          {marks?.filter((mark) => mark.value > min && mark.value < max).map((mark) => (
            <span
              key={mark.value}
              className="ui-slider__tick"
              data-active={inFill(mark.value) || undefined}
              style={{ insetInlineStart: `${valueToPercent(mark.value, min, max)}%` }}
            />
          ))}
          {values.map((v, index) => {
            const thumbLabelId = `${id}-thumb-${index}`;
            return (
              <span
                key={index}
                ref={(el) => {
                  thumbRefs.current[index] = el;
                }}
                role="slider"
                tabIndex={disabled ? undefined : 0}
                aria-valuemin={isRange && index === 1 ? values[0] : min}
                aria-valuemax={isRange && index === 0 ? values[1] : max}
                aria-valuenow={v}
                aria-valuetext={formatValue(v)}
                aria-orientation="horizontal"
                aria-disabled={disabled || undefined}
                aria-label={ariaLabelledBy ? undefined : isRange ? cx(ariaLabel, thumbLabels[index]) : ariaLabel}
                aria-labelledby={ariaLabelledBy && (isRange ? `${ariaLabelledBy} ${thumbLabelId}` : ariaLabelledBy)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid ?? (invalid || undefined)}
                className="ui-slider__thumb"
                data-dragging={dragging === index || undefined}
                style={{ insetInlineStart: `${valueToPercent(v, min, max)}%` }}
                onKeyDown={handleThumbKeyDown(index)}
              >
                {tooltip && (
                  <span className="ui-slider__value" aria-hidden="true">
                    {formatValue(v)}
                  </span>
                )}
                {isRange && ariaLabelledBy && (
                  <span id={thumbLabelId} hidden>
                    {thumbLabels[index]}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
      {labelledMarks.length > 0 && (
        <div className="ui-slider__labels" aria-hidden="true">
          {labelledMarks.map((mark) => (
            <span
              key={mark.value}
              className="ui-slider__label"
              data-active={inFill(mark.value) || undefined}
              data-edge={mark.value <= min ? 'start' : mark.value >= max ? 'end' : undefined}
              style={{ insetInlineStart: `${valueToPercent(mark.value, min, max)}%` }}
            >
              {mark.label}
            </span>
          ))}
        </div>
      )}
      {name && values.map((v, index) => <input key={index} type="hidden" name={name} value={v} disabled={disabled} />)}
    </div>
  );
});
