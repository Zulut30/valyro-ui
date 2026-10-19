'use client';

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { clamp, cx, getDirection, inlineArrowStep, type Direction } from '../primitives/utils';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { useId } from '../primitives/react-compat';
import { useFormReset } from './form-reset';

/*
 * The behaviour of Slider without its markup: one value or a `[from, to]` range (controlled or not), snapping to
 * `step`, thumbs that cannot pass each other, a press on the track that grabs the nearest thumb and drags it,
 * and the keys (arrows, mirrored under dir="rtl" along the track, PageUp / PageDown, Home / End). Each thumb is a
 * visually hidden native `<input type="range">`, as in React Aria: it takes the focus, so VoiceOver on iOS and
 * TalkBack change the value with their swipe gestures. A form reset brings an uncontrolled value back.
 * Slider renders with it.
 */

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

/* ── Hook ── */

export type SliderValue = number | [number, number];
export type SliderWiden<T> = T extends number ? number : [number, number];

export interface SliderOptions<T extends SliderValue = number> {
  /** A number for one thumb, a `[from, to]` tuple for a range. */
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: SliderWiden<T>) => void;
  /** Lowest value; steps are counted from it. Default 0. */
  min?: number;
  /** Highest value. Default 100. */
  max?: number;
  /** Snapping interval; 0 = continuous (the keys then move by 1% of the range). Default 1. */
  step?: number;
  /** Ignores pointer and keyboard input and disables the inputs. */
  disabled?: boolean;
  /** Text for aria-valuetext. Default: the number formatted for `locale`. */
  formatValue?: (value: number) => string;
  locale?: string;
  /** Names of the slider, given to each thumb. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  /** aria-invalid on the thumbs. */
  invalid?: boolean;
  /** Words appended to the name of each range thumb, e.g. "Price minimum". Default `['minimum', 'maximum']`. */
  thumbLabels?: [string, string];
  /** Name of the hidden inputs that submit the value(s) with a form (getHiddenInputProps). */
  name?: string;
}

export interface SliderState {
  value: SliderValue;
  /** The thumbs' values in order (one, or two for a range). */
  values: number[];
  isRange: boolean;
  /** Index of the thumb being dragged, or null. */
  dragging: number | null;
  /** Index of the thumb whose input has keyboard focus (`:focus-visible`), or null: draw its focus ring. */
  focusVisible: number | null;
  /** A value as text: `formatValue`, else the number for `locale` (aria-valuetext, a value bubble). */
  formatValue: (value: number) => string;
  /** Moves a thumb (snapped, clamped, not past its neighbour). */
  setThumbValue: (index: number, value: number) => void;
  /** Where a value sits on the track, 0–100 from its inline start. */
  getPercent: (value: number) => number;
  /** Whether a value lies within the filled part of the track (a mark's active look). */
  isInRange: (value: number) => boolean;
  /** Render the getThumbLabelProps elements: the range thumbs are named by `aria-labelledby` plus their own word. */
  labelThumbs: boolean;
  /** The element that takes presses: a press grabs the nearest thumb and drags it. */
  getRootProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { 'data-disabled'?: true; 'data-dragging'?: true };
  /** The track the pointer is measured against. */
  getTrackProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The filled part of the track (positioned with inset-inline). */
  getRangeProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { style: CSSProperties };
  /** A thumb, positioned along the track; it holds its input. */
  getThumbProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement> & { style: CSSProperties };
  /** The thumb's visually hidden `<input type="range">`: focus, keys, screen readers' gestures. */
  getInputProps: (index: number, props?: UserProps) => InputHTMLAttributes<HTMLInputElement> & { ref: (node: HTMLInputElement | null) => void };
  /** The hidden word that names a range thumb (only while labelThumbs). */
  getThumbLabelProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** A hidden input that submits a thumb's value with the form (needs `name`). */
  getHiddenInputProps: (index: number, props?: UserProps) => InputHTMLAttributes<HTMLInputElement>;
}

const DEFAULT_THUMB_LABELS: [string, string] = ['minimum', 'maximum'];

/** Whether focus arrived the way `:focus-visible` matches (keyboard, screen reader), not by a press. */
function isFocusVisible(element: Element) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function useSlider<T extends SliderValue = number>({
  value: valueProp,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  formatValue: formatValueProp,
  locale,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  invalid = false,
  thumbLabels = DEFAULT_THUMB_LABELS,
  name,
}: SliderOptions<T>): SliderState {
  const [value, setValue] = useControllableState<SliderValue>({
    value: valueProp,
    defaultValue: defaultValue ?? min,
    onChange: onValueChange as ((value: SliderValue) => void) | undefined,
  });
  const isRange = Array.isArray(value);
  const values: number[] = isRange ? value : [value];
  const trackRef = useRef<HTMLElement | null>(null);
  const [setTrack] = useState(() => (node: HTMLElement | null) => {
    trackRef.current = node;
  });
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(trackRef, () => setValue(defaultValue ?? min), valueProp === undefined);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // One ref callback per thumb, so an input's ref does not change on every render.
  const inputRefs = useRef<((node: HTMLInputElement | null) => void)[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [focusVisible, setFocusVisible] = useState<number | null>(null);
  const id = useId();
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }), [locale]);
  const formatValue = formatValueProp ?? numberFormat.format;

  const commit = (index: number, next: number) => {
    const nextValues = setThumbValue(values, index, next, min, max, step);
    if (nextValues.every((v, i) => v === values[i])) return;
    setValue(isRange ? [nextValues[0], nextValues[1]] : nextValues[0]);
  };

  const valueAt = (clientX: number) => {
    const track = trackRef.current;
    const rect = track?.getBoundingClientRect();
    if (!track || !rect || rect.width === 0) return min;
    return percentToValue(pointerPercent(clientX, rect, getDirection(track)), min, max, step);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (disabled || event.defaultPrevented || event.button !== 0) return;
    // Stops text selection and the browser's own focus handling; the grabbed thumb is focused below.
    event.preventDefault();
    const next = valueAt(event.clientX);
    const index = closestThumb(values, next);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(index);
    inputs.current[index]?.focus();
    commit(index, next);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (dragging !== null) commit(dragging, valueAt(event.clientX));
  };
  const endDrag = () => setDragging(null);

  // step 0 means continuous; keys then move by 1% of the range.
  const keyStep = step > 0 ? step : (max - min) / 100;
  const pageStep = keyStep * Math.max(1, Math.round((max - min) / keyStep / 10));

  const onThumbKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
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

  const inputRef = (index: number) => {
    inputRefs.current[index] ??= (node) => {
      inputs.current[index] = node;
    };
    return inputRefs.current[index];
  };
  const thumbLabelId = (index: number) => `${id}-thumb-${index}`;
  const labelThumbs = isRange && !!ariaLabelledBy;
  const start = isRange ? valueToPercent(values[0], min, max) : 0;
  const end = valueToPercent(values[values.length - 1], min, max);

  return {
    value,
    values,
    isRange,
    dragging,
    focusVisible,
    formatValue,
    setThumbValue: commit,
    getPercent: (v) => valueToPercent(v, min, max),
    isInRange: (v) => (isRange ? v >= values[0] && v <= values[1] : v <= values[0]),
    labelThumbs,
    getRootProps: (props) =>
      withUserProps(
        {
          'data-disabled': disabled || undefined,
          'data-dragging': dragging !== null || undefined,
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onLostPointerCapture: endDrag,
        },
        props,
      ) as never,
    getTrackProps: (props) => withUserProps({ ref: setTrack }, props),
    getRangeProps: (props) => withUserProps({ style: { insetInlineStart: `${start}%`, insetInlineEnd: `${100 - end}%` } }, props) as never,
    getThumbProps: (index, props) =>
      withUserProps(
        {
          'data-dragging': dragging === index || undefined,
          'data-focus-visible': focusVisible === index || undefined,
          style: { insetInlineStart: `${valueToPercent(values[index], min, max)}%` },
        },
        props,
      ) as never,
    getInputProps: (index, props) =>
      withUserProps(
        {
          ref: inputRef(index),
          type: 'range',
          min: isRange && index === 1 ? values[0] : min,
          max: isRange && index === 0 ? values[1] : max,
          step: step > 0 ? step : 'any',
          value: values[index],
          disabled,
          'aria-valuetext': formatValue(values[index]),
          'aria-label': ariaLabelledBy ? undefined : isRange ? cx(ariaLabel, thumbLabels[index]) : ariaLabel,
          'aria-labelledby': ariaLabelledBy && (isRange ? `${ariaLabelledBy} ${thumbLabelId(index)}` : ariaLabelledBy),
          'aria-describedby': ariaDescribedBy,
          'aria-invalid': invalid || undefined,
          onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => onThumbKeyDown(index, event),
          // A screen reader's swipe (or any other native adjustment) changes the hidden input directly.
          onChange: (event: ChangeEvent<HTMLInputElement>) => {
            const next = event.currentTarget.valueAsNumber;
            if (!disabled && Number.isFinite(next)) commit(index, next);
          },
          onFocus: (event: FocusEvent<HTMLInputElement>) => setFocusVisible(isFocusVisible(event.currentTarget) ? index : null),
          onBlur: () => setFocusVisible(null),
        },
        props,
      ) as never,
    getThumbLabelProps: (index, props) => withUserProps({ id: thumbLabelId(index), hidden: true, children: thumbLabels[index] }, props),
    getHiddenInputProps: (index, props) => withUserProps({ type: 'hidden', name, value: values[index], disabled }, props),
  };
}
