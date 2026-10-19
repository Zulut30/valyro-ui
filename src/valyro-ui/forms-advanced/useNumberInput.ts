'use client';

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { isComposingKey, useLatest } from '../primitives/utils';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { useFormReset } from '../forms/form-reset';
import { formatNumber, normalizeNumber, parseNumber, repeatDelay, REPEAT_START_DELAY, stepNumber } from './number-input';

/*
 * The behaviour of NumberInput without its markup (WAI-ARIA spinbutton, as React Aria's useNumberField): a number or
 * nothing (controlled or not) shown in the locale's format, typed text kept as a draft and committed on blur or
 * Enter (clamped to min / max, rounded to `precision`), ↑ / ↓ (Shift: ×10), PageUp / PageDown, Home / End, the
 * wheel while focused (`allowWheel`), and step buttons that step on press and repeat faster while held, without
 * taking focus from the field. A form reset brings an uncontrolled value back. NumberInput renders with it.
 */

export interface NumberInputLabels {
  increment: string;
  decrement: string;
}

export const DEFAULT_NUMBER_INPUT_LABELS: NumberInputLabels = {
  increment: 'Increase',
  decrement: 'Decrease',
};

export interface NumberInputOptions {
  value?: number | null;
  defaultValue?: number | null;
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Step of the arrows and buttons; Shift and PageUp / PageDown move 10 steps. Default 1. */
  step?: number;
  /** Decimal places a committed value is rounded to. */
  precision?: number;
  /** Locale of the shown and typed number. Default: the browser's. */
  locale?: string;
  formatOptions?: Intl.NumberFormatOptions;
  /** The wheel steps the value while the field has focus. */
  allowWheel?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  /** Names of the step buttons. */
  labels?: Partial<NumberInputLabels>;
  /** Name of the hidden input that submits the number (getHiddenInputProps). */
  name?: string;
}

export interface NumberInputState {
  value: number | null;
  /** The text in the field: the draft while typing, else the formatted value. */
  inputValue: string;
  setValue: (value: number | null) => void;
  /** Steps by `step` (×10 with `big`); ignored while disabled or read-only. */
  increment: (big?: boolean) => void;
  decrement: (big?: boolean) => void;
  canIncrement: boolean;
  canDecrement: boolean;
  /** The `<input>`: role spinbutton, its values, the keys, the draft and the wheel. */
  getInputProps: (props?: UserProps) => InputHTMLAttributes<HTMLInputElement> & { ref: (node: HTMLInputElement | null) => void };
  /** The step buttons: out of the Tab order, stepping on press and repeating while held. */
  getIncrementProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  getDecrementProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** A hidden input that submits the number with the form (needs `name`). */
  getHiddenInputProps: (props?: UserProps) => InputHTMLAttributes<HTMLInputElement>;
}

export function useNumberInput({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  min,
  max,
  step = 1,
  precision,
  locale,
  formatOptions,
  allowWheel = false,
  disabled = false,
  readOnly = false,
  invalid,
  labels: labelsProp,
  name,
}: NumberInputOptions): NumberInputState {
  const [num, setNum] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  // Text being typed; null shows the formatted value.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [setInput] = useState(() => (node: HTMLInputElement | null) => {
    inputRef.current = node;
  });
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(
    inputRef,
    () => {
      setNum(defaultValue);
      setDraft(null);
    },
    valueProp === undefined,
  );
  const labels = { ...DEFAULT_NUMBER_INPUT_LABELS, ...labelsProp };
  const bounds = { min, max, precision };
  const format = (n: number | null) => formatNumber(n, locale, formatOptions);
  const text = draft ?? format(num);
  const interactive = !disabled && !readOnly;

  /** Parses typed text into the value: empty clears it, unparsable keeps the last value. */
  const commitText = (raw: string) => {
    let next: number | null = null;
    if (raw.trim() !== '') {
      const parsed = parseNumber(raw, locale, formatOptions);
      next = parsed === null ? num : normalizeNumber(parsed, bounds);
    }
    setNum(next);
    return next;
  };

  const stepBy = (delta: number) => {
    if (!interactive) return;
    // Step from what is typed, so "12" + ↑ gives 13 before the field is left.
    const base = draft === null ? num : (parseNumber(draft, locale, formatOptions) ?? num);
    const next = stepNumber(base, delta, bounds);
    setNum(next);
    if (draft !== null) setDraft(format(next));
  };

  const setTo = (next: number) => {
    setNum(next);
    if (draft !== null) setDraft(format(next));
  };

  // A native listener: React's wheel listener is passive and could not keep the page from scrolling.
  const stepByRef = useLatest(stepBy);
  useEffect(() => {
    const input = inputRef.current;
    if (!allowWheel || !input) return;
    const onWheel = (event: WheelEvent) => {
      if (document.activeElement !== input || event.deltaY === 0) return;
      event.preventDefault();
      stepByRef.current((event.deltaY < 0 ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
    };
    input.addEventListener('wheel', onWheel, { passive: false });
    return () => input.removeEventListener('wheel', onWheel);
  }, [allowWheel, step, stepByRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.defaultPrevented || isComposingKey(event)) return;
    const big = step * 10;
    switch (event.key) {
      case 'ArrowUp':
        stepBy(event.shiftKey ? big : step);
        break;
      case 'ArrowDown':
        stepBy(-(event.shiftKey ? big : step));
        break;
      case 'PageUp':
        stepBy(big);
        break;
      case 'PageDown':
        stepBy(-big);
        break;
      case 'Home':
        if (min === undefined || !interactive) return;
        setTo(min);
        break;
      case 'End':
        if (max === undefined || !interactive) return;
        setTo(max);
        break;
      case 'Enter':
        // Commits the draft without leaving the field (and lets a surrounding form submit).
        if (draft !== null) setDraft(format(commitText(draft)));
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  const atMin = num !== null && min !== undefined && num <= min;
  const atMax = num !== null && max !== undefined && num >= max;
  const canIncrement = interactive && !atMax;
  const canDecrement = interactive && !atMin;

  /* ── Step buttons: one step on press, then repeats with acceleration while held ── */
  const timer = useRef<number | undefined>(undefined);
  const repeating = useRef<1 | -1 | null>(null);
  const [stop] = useState(() => {
    const stopRepeat = () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      repeating.current = null;
      window.removeEventListener('blur', stopRepeat);
    };
    return stopRepeat;
  });
  // Reaching min / max disables the button, which then never sees the pointerup.
  useEffect(() => {
    if ((repeating.current === 1 && !canIncrement) || (repeating.current === -1 && !canDecrement)) stop();
  }, [canIncrement, canDecrement, stop]);
  useEffect(() => stop, [stop]);

  const start = (direction: 1 | -1, big: boolean) => {
    stop();
    const once = () => stepByRef.current(direction * (big ? step * 10 : step));
    once();
    repeating.current = direction;
    let repeats = 0;
    const tick = () => {
      once();
      timer.current = window.setTimeout(tick, repeatDelay(++repeats));
    };
    timer.current = window.setTimeout(tick, REPEAT_START_DELAY);
    // Switching windows mid-press would otherwise leave it spinning.
    window.addEventListener('blur', stop);
  };

  const stepperProps = (direction: 1 | -1, props?: UserProps) =>
    withUserProps(
      {
        type: 'button',
        tabIndex: -1,
        'aria-label': direction === 1 ? labels.increment : labels.decrement,
        disabled: direction === 1 ? !canIncrement : !canDecrement,
        // Keep focus (and the typed draft) in the input.
        onMouseDown: (event: MouseEvent) => event.preventDefault(),
        onPointerDown: (event: PointerEvent) => {
          if (event.button === 0) start(direction, event.shiftKey);
        },
        onPointerUp: stop,
        onPointerLeave: stop,
        onPointerCancel: stop,
        onContextMenu: (event: MouseEvent) => event.preventDefault(),
        // Pointer presses step in pointerdown; this is keyboard and assistive-tech activation (detail 0).
        onClick: (event: MouseEvent) => {
          if (event.detail === 0) stepBy(direction * (event.shiftKey ? step * 10 : step));
        },
      },
      props,
    ) as never;

  return {
    value: num,
    inputValue: text,
    setValue: (next) => {
      setNum(next);
      setDraft(null);
    },
    increment: (big = false) => stepBy(big ? step * 10 : step),
    decrement: (big = false) => stepBy(-(big ? step * 10 : step)),
    canIncrement,
    canDecrement,
    getInputProps: (props) =>
      withUserProps(
        {
          ref: setInput,
          type: 'text',
          inputMode: 'decimal',
          autoComplete: 'off',
          role: 'spinbutton',
          'aria-valuenow': num ?? undefined,
          'aria-valuemin': min,
          'aria-valuemax': max,
          'aria-valuetext': num === null ? undefined : format(num),
          'aria-invalid': invalid || undefined,
          value: text,
          disabled,
          readOnly,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
          onBlur: () => {
            if (draft !== null) commitText(draft);
            setDraft(null);
          },
          onKeyDown,
        },
        props,
      ) as never,
    getIncrementProps: (props) => stepperProps(1, props),
    getDecrementProps: (props) => stepperProps(-1, props),
    getHiddenInputProps: (props) => withUserProps({ type: 'hidden', name, value: num === null ? '' : String(num), disabled }, props),
  };
}
