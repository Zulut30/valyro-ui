'use client';

import { useState } from 'react';

/** Form plumbing for controls that have no native input of their own (pickers, rating, colour, tags). */

/** `YYYY-MM-DD` in local time (the `<input type="date">` format); empty for no date. */
export function toISODate(date: Date | null | undefined): string {
  if (!date) return '';
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:mm`, 24-hour; empty for no time. */
export function toTimeValue(time: { h: number; m: number } | null): string {
  return time ? `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}` : '';
}

export interface FormValueProps {
  name?: string;
  /** One hidden input per value. Single-value controls pass `['']` when empty, so the field is still submitted. */
  values: string[];
  disabled?: boolean;
  /** Blocks native form submission while every value is empty. */
  required?: boolean;
  /**
   * Runs instead of the browser's message when `required` blocks a submit. `focus` is true for the
   * form's first invalid field — only that control should take focus, like the browser does natively.
   */
  onMissing?: (focus: boolean) => void;
}

/** Hidden inputs that submit a custom control's value with the surrounding form. */
export function FormValue({ name, values, disabled, required, onMissing }: FormValueProps) {
  const filled = values.some((value) => value !== '');
  return (
    <>
      {name && values.map((value, i) => <input key={i} type="hidden" name={name} value={value} disabled={disabled} />)}
      {required && !disabled && (
        // Hidden and read-only inputs skip constraint validation, so `required` needs a real (visually hidden) one.
        <input
          className="ui-sr-only"
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          required
          value={filled ? 'filled' : ''}
          onChange={() => undefined}
          onInvalid={(event) => {
            event.preventDefault();
            const input = event.currentTarget;
            // Every listed form element (input, select, button, fieldset…) has willValidate and validity.
            const elements = (input.form ? [...input.form.elements] : [input]) as HTMLInputElement[];
            onMissing?.(elements.find((el) => el.willValidate && !el.validity.valid) === input);
          }}
        />
      )}
    </>
  );
}

/** Invalid styling after `required` blocked a submit, until a value is chosen. */
export function useMissingValue(hasValue: boolean): [boolean, () => void] {
  const [missing, setMissing] = useState(false);
  return [missing && !hasValue, () => setMissing(true)];
}
