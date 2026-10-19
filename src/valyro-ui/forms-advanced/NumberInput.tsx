'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { MinusIcon, PlusIcon } from '../icons';
import { composeHandlers, cx, isComposingKey, mergeRefs, useControllableState, useLatest } from '../primitives';
import {
  formatNumber,
  normalizeNumber,
  parseNumber,
  repeatDelay,
  REPEAT_START_DELAY,
  stepNumber,
} from './number-input';
import { useLocale } from '../theme/ThemeProvider';
import { FormValue } from './form-value';
import type { FieldSize } from './PickerTrigger';
import './NumberInput.css';
import { withRef } from '../primitives/react-compat';

export interface NumberInputLabels {
  increment: string;
  decrement: string;
}

export const DEFAULT_NUMBER_INPUT_LABELS: NumberInputLabels = {
  increment: 'Increase',
  decrement: 'Decrease',
};

export interface NumberInputProps
  extends Omit<
    ComponentPropsWithRef<'input'>,
    'value' | 'defaultValue' | 'onChange' | 'size' | 'type' | 'min' | 'max' | 'step'
  > {
  value?: number | null;
  defaultValue?: number | null;
  onValueChange?: (value: number | null) => void;
  /** Lower bound: typed and stepped values are clamped to it, and Home jumps to it. */
  min?: number;
  /** Upper bound: typed and stepped values are clamped to it, and End jumps to it. */
  max?: number;
  /** Amount added by the stepper buttons and arrow keys; Shift and Page Up/Down step 10×. */
  step?: number;
  /** Decimal places committed values are rounded to. */
  precision?: number;
  locale?: string;
  /** Display format, e.g. `{ style: 'currency', currency: 'USD' }`. Percent values are fractions (0.5 = 50%). */
  formatOptions?: Intl.NumberFormatOptions;
  /** Step with the mouse wheel while the input is focused. Off by default to avoid accidental changes. */
  allowWheel?: boolean;
  /** Field height and text size. */
  size?: FieldSize;
  /** Danger border and `aria-invalid` on the input. */
  invalid?: boolean;
  /** Accessible names of the stepper buttons. */
  labels?: Partial<NumberInputLabels>;
  /** Submits the plain number ("1250.5", empty when unset) with the form, not the formatted text. */
  name?: string;
}

/** `className` and `style` go to the field wrapper; all other props go to the `<input>`. */
export const NumberInput = withRef(function NumberInput({
  value,
  defaultValue = null,
  onValueChange,
  min,
  max,
  step = 1,
  precision,
  locale: localeProp,
  formatOptions,
  allowWheel = false,
  size = 'md',
  invalid,
  labels: labelsProp,
  name,
  disabled,
  readOnly,
  className,
  style,
  ref,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: NumberInputProps) {
  const [num, setNum] = useControllableState({ value, defaultValue, onChange: onValueChange });
  // Text being typed; null while not editing so the field mirrors the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labels = { ...DEFAULT_NUMBER_INPUT_LABELS, ...labelsProp };
  const locale = useLocale(localeProp);

  const bounds = { min, max, precision };
  const format = (n: number | null) => formatNumber(n, locale, formatOptions);
  const text = draft ?? format(num);
  const interactive = !disabled && !readOnly;

  const commitText = (raw: string) => {
    let next: number | null = null;
    if (raw.trim() !== '') {
      const parsed = parseNumber(raw, locale, formatOptions);
      // Unparseable text reverts to the last valid value.
      next = parsed === null ? num : normalizeNumber(parsed, bounds);
    }
    setNum(next);
    return next;
  };

  const stepBy = (delta: number) => {
    if (!interactive) return;
    const base = draft === null ? num : (parseNumber(draft, locale, formatOptions) ?? num);
    const next = stepNumber(base, delta, bounds);
    setNum(next);
    if (draft !== null) setDraft(format(next));
  };

  const setTo = (next: number) => {
    setNum(next);
    if (draft !== null) setDraft(format(next));
  };

  const stepByRef = useLatest(stepBy);
  useEffect(() => {
    const input = inputRef.current;
    if (!allowWheel || !input) return;
    const onWheel = (event: WheelEvent) => {
      if (document.activeElement !== input || event.deltaY === 0) return;
      event.preventDefault();
      stepByRef.current((event.deltaY < 0 ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
    };
    // React wheel listeners are passive, so preventDefault needs a native one.
    input.addEventListener('wheel', onWheel, { passive: false });
    return () => input.removeEventListener('wheel', onWheel);
  }, [allowWheel, step, stepByRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Full-width digits typed through an IME: its Enter and arrows must not commit or step the value.
    if (isComposingKey(event)) return;
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
        if (draft !== null) setDraft(format(commitText(draft)));
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  const atMin = num !== null && min !== undefined && num <= min;
  const atMax = num !== null && max !== undefined && num >= max;

  return (
    <div
      className={cx('ui-field ui-number-input', className)}
      style={style}
      data-size={size}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
    >
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        role="spinbutton"
        aria-valuenow={num ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={num === null ? undefined : format(num)}
        aria-invalid={invalid || undefined}
        {...rest}
        ref={mergeRefs(inputRef, ref)}
        className="ui-field__input ui-number-input__input"
        value={text}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={onFocus}
        // Only typed text is committed: focusing and leaving the field never rewrites the value (a value changed by
        // the parent meanwhile stays, and the rounding of the formatted text does not leak into it).
        onBlur={composeHandlers(onBlur, () => {
          if (draft !== null) commitText(draft);
          setDraft(null);
        })}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={composeHandlers(onKeyDown, handleKeyDown)}
      />
      <FormValue name={name} values={[num === null ? '' : String(num)]} disabled={disabled} />
      <div className="ui-number-input__steppers">
        <StepButton
          label={labels.decrement}
          disabled={!interactive || atMin}
          onStep={(big) => stepBy(-(big ? step * 10 : step))}
        >
          <MinusIcon />
        </StepButton>
        <StepButton
          label={labels.increment}
          disabled={!interactive || atMax}
          onStep={(big) => stepBy(big ? step * 10 : step)}
        >
          <PlusIcon />
        </StepButton>
      </div>
    </div>
  );
});

interface StepButtonProps {
  label: string;
  disabled: boolean;
  /** `big` is true while Shift is held, matching Shift + arrow keys. */
  onStep: (big: boolean) => void;
  children: ReactNode;
}

/** Steps once on press, then repeats with acceleration while held. */
function StepButton({ label, disabled, onStep, children }: StepButtonProps) {
  const timer = useRef<number | undefined>(undefined);
  const onStepRef = useLatest(onStep);

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    window.removeEventListener('blur', stop);
  }, []);

  // Reaching min/max disables the button, which then never sees the pointerup.
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);
  useEffect(() => stop, [stop]);

  const start = (big: boolean) => {
    stop();
    onStepRef.current(big);
    let repeats = 0;
    const tick = () => {
      onStepRef.current(big);
      timer.current = window.setTimeout(tick, repeatDelay(++repeats));
    };
    timer.current = window.setTimeout(tick, REPEAT_START_DELAY);
    // Switching windows mid-press would otherwise leave it spinning.
    window.addEventListener('blur', stop);
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      className="ui-number-input__step"
      disabled={disabled}
      // Keep focus (and the typed draft) in the input.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button === 0) start(event.shiftKey);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      // Pointer presses step in pointerdown; this handles keyboard and assistive-tech activation (detail 0).
      onClick={(event) => {
        if (event.detail === 0) onStep(event.shiftKey);
      }}
    >
      {children}
    </button>
  );
}
