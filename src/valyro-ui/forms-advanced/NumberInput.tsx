'use client';

import { type ComponentPropsWithRef } from 'react';
import { MinusIcon, PlusIcon } from '../icons';
import { cx } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { FormValue } from './form-value';
import type { FieldSize } from './PickerTrigger';
import { useFormField } from './form-field-context';
import { useNumberInput, type NumberInputLabels } from './useNumberInput';
import './NumberInput.css';
import { withRef } from '../primitives/react-compat';

export { DEFAULT_NUMBER_INPUT_LABELS, type NumberInputLabels } from './useNumberInput';

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
  labels,
  name,
  disabled,
  readOnly,
  className,
  style,
  ref,
  ...rest
}: NumberInputProps) {
  // FormField's `required` only marks its label (aria-hidden); announce it on the control.
  const field = useFormField();
  const locale = useLocale(localeProp);
  // The value and the draft, the keys, the wheel and the repeating step buttons come from the headless hook.
  const number = useNumberInput({
    value,
    defaultValue,
    onValueChange,
    min,
    max,
    step,
    precision,
    locale,
    formatOptions,
    allowWheel,
    disabled,
    readOnly,
    invalid,
    labels,
  });

  return (
    <div
      className={cx('ui-field ui-number-input', className)}
      style={style}
      data-size={size}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
    >
      <input
        className="ui-field__input ui-number-input__input"
        {...number.getInputProps({ 'aria-required': field?.required || undefined, ...rest, ref })}
      />
      <FormValue name={name} values={[number.value === null ? '' : String(number.value)]} disabled={disabled} />
      <div className="ui-number-input__steppers">
        <button className="ui-number-input__step" {...number.getDecrementProps()}>
          <MinusIcon />
        </button>
        <button className="ui-number-input__step" {...number.getIncrementProps()}>
          <PlusIcon />
        </button>
      </div>
    </div>
  );
});
