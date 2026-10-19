'use client';

import {
  Fragment,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentPropsWithRef,
  type KeyboardEvent,
} from 'react';
import { clamp, cx, useControllableState } from '../primitives';
import { useFormField } from './form-field-context';
import { FormValue } from './form-value';
import './OTPInput.css';
import { withRef } from '../primitives/react-compat';

export interface OTPInputLabels {
  /** Name of the group when no label is wired up. */
  group: string;
  /** Name of each box. */
  character: (index: number, length: number) => string;
}

export const DEFAULT_OTP_INPUT_LABELS: OTPInputLabels = {
  group: 'Verification code',
  character: (index, length) => `Character ${index} of ${length}`,
};

export interface OTPInputProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange'> {
  /** Number of boxes. */
  length?: number;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Called once every box is filled. */
  onComplete?: (value: string) => void;
  /** Characters kept from typing and paste: digits only (numeric keypad on phones), or Latin letters and digits. */
  type?: 'numeric' | 'alphanumeric';
  /** Draw a dash between the two halves. */
  separator?: boolean;
  /** Danger borders and a shake on every box; sets `aria-invalid` on the inputs. */
  invalid?: boolean;
  /** Disables every box; the code is not submitted with the form. */
  disabled?: boolean;
  /** Focus the first box on mount. */
  autoFocus?: boolean;
  /** Submits the code with the surrounding form as one string (possibly partial). */
  name?: string;
  /** Every box must be filled for the form to submit; the browser points at the first empty one. */
  required?: boolean;
  labels?: Partial<OTPInputLabels>;
}

/**
 * The code is one string with no gaps: a box can only be filled after the ones
 * before it, so focus is redirected to the first empty box. `id`,
 * `aria-describedby` and `aria-invalid` go to the inputs (id to the first).
 */
export const OTPInput = withRef(function OTPInput({
  length = 6,
  value,
  defaultValue = '',
  onValueChange,
  onComplete,
  type = 'numeric',
  separator = false,
  invalid = false,
  disabled = false,
  autoFocus,
  name,
  required,
  labels: labelsProp,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  className,
  ...rest
}: OTPInputProps) {
  const [code, setCode] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // Focus moves inside the same event that changed the code, before the re-render;
  // the focus handler reads this to see the new length.
  const latest = useRef(code);
  latest.current = code;
  const field = useFormField();
  const labels = { ...DEFAULT_OTP_INPUT_LABELS, ...labelsProp };

  const sanitize = (text: string) => (type === 'numeric' ? text.replace(/\D/g, '') : text.replace(/[^a-z0-9]/gi, ''));
  const focusBox = (index: number) => inputs.current[clamp(index, 0, length - 1)]?.focus();

  const update = (next: string) => {
    const trimmed = next.slice(0, length);
    latest.current = trimmed;
    setCode(trimmed);
    if (trimmed.length === length && trimmed !== code) onComplete?.(trimmed);
  };

  /** Writes `text` starting at box `index`, overwriting what is there. */
  const write = (index: number, text: string) => {
    const chars = sanitize(text);
    if (!chars) return;
    const start = Math.min(index, code.length);
    update(code.slice(0, start) + chars + code.slice(start + chars.length));
    focusBox(start + chars.length);
  };

  const removeAt = (index: number) => update(code.slice(0, index) + code.slice(index + 1));

  const onBoxChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    if (text === '') {
      removeAt(index);
      return;
    }
    // Typing next to an existing character leaves two; anything longer is autofill or paste.
    const typed = text.length === 2 && code[index] ? text[(event.target.selectionStart ?? 2) - 1] : text;
    write(index, typed);
  };

  const onBoxKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'Backspace':
        event.preventDefault();
        if (code[index]) removeAt(index);
        else if (index > 0) {
          removeAt(index - 1);
          focusBox(index - 1);
        }
        return;
      case 'Delete':
        event.preventDefault();
        removeAt(index);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusBox(index - 1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusBox(Math.min(index + 1, code.length));
        return;
      case 'Home':
        event.preventDefault();
        focusBox(0);
        return;
      case 'End':
        event.preventDefault();
        focusBox(code.length);
        return;
    }
    // Handle printable keys here so typing over a filled box replaces it.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      write(index, event.key);
    }
  };

  const onBoxPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = sanitize(event.clipboardData.getData('text'));
    // A full code replaces everything, wherever the caret is.
    write(pasted.length >= length ? 0 : index, pasted);
  };

  const half = Math.floor(length / 2);
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true';

  return (
    <div
      {...rest}
      role="group"
      aria-label={ariaLabel ?? (labelledBy || field?.labelId ? undefined : labels.group)}
      aria-labelledby={labelledBy ?? field?.labelId}
      className={cx('ui-otp-input', className)}
      data-invalid={isInvalid || undefined}
      data-disabled={disabled || undefined}
    >
      {Array.from({ length }, (_, index) => (
        <Fragment key={index}>
          {separator && index === half && index > 0 && <span className="ui-otp-input__separator" aria-hidden="true" />}
          <input
            ref={(el) => {
              inputs.current[index] = el;
            }}
            id={index === 0 ? id : undefined}
            className="ui-otp-input__box"
            value={code[index] ?? ''}
            inputMode={type === 'numeric' ? 'numeric' : 'text'}
            pattern={type === 'numeric' ? '[0-9]*' : undefined}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={autoFocus && index === 0}
            disabled={disabled}
            required={required}
            aria-label={labels.character(index + 1, length)}
            aria-describedby={describedBy}
            aria-invalid={isInvalid || undefined}
            data-filled={!!code[index] || undefined}
            // Boxes past the first empty one would send focus back to it, trapping Tab inside the group:
            // they are left out of the tab order (a click still lands on them and is redirected).
            tabIndex={index > code.length ? -1 : undefined}
            onFocus={(event) => {
              if (index > latest.current.length) focusBox(latest.current.length);
              else event.target.select();
            }}
            onChange={(event) => onBoxChange(index, event)}
            onKeyDown={(event) => onBoxKeyDown(index, event)}
            onPaste={(event) => onBoxPaste(index, event)}
          />
        </Fragment>
      ))}
      <FormValue name={name} values={[code]} disabled={disabled} />
    </div>
  );
});
