'use client';

import { type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { useFormField } from '../forms-advanced/form-field-context';
import { useSlider, type SliderValue, type SliderWiden } from './useSlider';
import './Slider.css';
import { withRef } from '../primitives/react-compat';

export { valueToPercent, snapToStep, percentToValue, pointerPercent, setThumbValue, closestThumb } from './useSlider';

export interface SliderMark {
  value: number;
  label?: ReactNode;
}

export interface SliderProps<T extends SliderValue = number>
  extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** A number for one thumb, a `[from, to]` tuple for a range. */
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: SliderWiden<T>) => void;
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

/**
 * Single-value or range slider. aria-label / aria-labelledby / aria-describedby are applied to the thumbs.
 *
 * Each thumb holds a visually hidden native `<input type="range">`, as React Aria's does: it is what takes focus,
 * so VoiceOver on iOS and TalkBack can change the value with their swipe gestures (they do not adjust an ARIA
 * slider), and the keys below keep the behaviour the same on every platform.
 */
export const Slider = withRef(function Slider<T extends SliderValue = number>({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  marks,
  tooltip = false,
  formatValue: formatValueProp,
  locale,
  thumbLabels,
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
  const resolvedLocale = useLocale(locale);
  // The value, the drag, the keys and the hidden range inputs come from the headless hook.
  const slider = useSlider<T>({
    value,
    defaultValue,
    onValueChange,
    min,
    max,
    step,
    disabled,
    formatValue: formatValueProp,
    locale: resolvedLocale,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledByProp ?? (ariaLabel ? undefined : field?.labelId),
    'aria-describedby': cx(ariaDescribedBy, field?.required && field.requiredId) || undefined,
    invalid,
    thumbLabels,
    name,
  });
  const { values, isRange, formatValue } = slider;
  const labelledMarks = marks?.filter((mark) => mark.label != null) ?? [];

  return (
    <div
      {...slider.getRootProps({ ...rest, onPointerDown })}
      className={cx('ui-slider', className)}
      data-invalid={invalid || undefined}
      data-tooltip={tooltip === 'always' ? 'always' : tooltip ? 'auto' : undefined}
    >
      <div className="ui-slider__control">
        <div className="ui-slider__track" {...slider.getTrackProps()}>
          {/* A single value fills from the start of the drawn bar, which runs half a thumb past the rail. */}
          <div className="ui-slider__range" {...slider.getRangeProps(isRange ? undefined : { style: { insetInlineStart: 'calc(var(--_thumb-w) / -2)' } })} />
          {/* The rounded track ends already mark min and max; dots there would poke out of the capsule. */}
          {marks?.filter((mark) => mark.value > min && mark.value < max).map((mark) => (
            <span
              key={mark.value}
              className="ui-slider__tick"
              data-active={slider.isInRange(mark.value) || undefined}
              style={{ insetInlineStart: `${slider.getPercent(mark.value)}%` }}
            />
          ))}
          {values.map((v, index) => (
            <span key={index} className="ui-slider__thumb" {...slider.getThumbProps(index)}>
              <input className="ui-slider__input ui-sr-only" {...slider.getInputProps(index, { 'aria-invalid': ariaInvalid })} />
              {tooltip && (
                <span className="ui-slider__value" aria-hidden="true">
                  {formatValue(v)}
                </span>
              )}
              {slider.labelThumbs && <span {...slider.getThumbLabelProps(index)} />}
            </span>
          ))}
        </div>
      </div>
      {labelledMarks.length > 0 && (
        <div className="ui-slider__labels" aria-hidden="true">
          {labelledMarks.map((mark) => (
            <span
              key={mark.value}
              className="ui-slider__label"
              data-active={slider.isInRange(mark.value) || undefined}
              data-edge={mark.value <= min ? 'start' : mark.value >= max ? 'end' : undefined}
              style={{ insetInlineStart: `${slider.getPercent(mark.value)}%` }}
            >
              {mark.label}
            </span>
          ))}
        </div>
      )}
      {name && values.map((_, index) => <input key={index} {...slider.getHiddenInputProps(index)} />)}
    </div>
  );
});
