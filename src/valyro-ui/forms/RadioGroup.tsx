'use client';

import { type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx, useControllableState } from '../primitives';
import { useFormField } from '../forms-advanced/form-field-context';
import '../primitives/motion.css';
import './RadioGroup.css';
import { withRef, useId } from '../primitives/react-compat';

export interface RadioGroupOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** Radios in order, each with a label and an optional description. */
  options: RadioGroupOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Name of the native radios (generated when omitted). */
  name?: string;
  /** Stack options in a column or lay them out in a row. */
  orientation?: 'vertical' | 'horizontal';
  /** `cards` renders each option as a selectable bordered card. */
  variant?: 'default' | 'cards';
  /** Radio and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Disables every option. */
  disabled?: boolean;
  /** Error color on the radios and aria-invalid on the group. */
  invalid?: boolean;
  /** Marks the group aria-required and makes a choice mandatory for native form validation. */
  required?: boolean;
  /** `spring`: the chosen dot pops in with a bounce and the ring pulses. `default`: the theme's transition. */
  animation?: 'default' | 'spring';
}

/** Native radios inside a `radiogroup`; arrow keys move the selection as in any browser radio group. */
export const RadioGroup = withRef(function RadioGroup({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  name,
  orientation = 'vertical',
  variant = 'default',
  size = 'md',
  disabled = false,
  invalid = false,
  required,
  animation = 'default',
  className,
  ...rest
}: RadioGroupProps) {
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue: defaultValue ?? '', onChange: onValueChange });
  const id = useId();
  const field = useFormField();

  return (
    <div
      role="radiogroup"
      // Inside a FormField its label names the group (a `for` pointing at a div names nothing).
      aria-labelledby={rest['aria-label'] ? undefined : field?.labelId}
      aria-disabled={disabled || undefined}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      {...rest}
      className={cx('ui-radio-group', className)}
      data-orientation={orientation}
      data-variant={variant}
      data-size={size}
      data-motion={animation === 'spring' ? 'spring' : undefined}
    >
      {options.map((option, index) => {
        const isDisabled = disabled || option.disabled;
        const checked = option.value === value;
        const descriptionId = `${id}-description-${index}`;
        return (
          <label
            key={option.value}
            className="ui-radio"
            data-variant={variant === 'cards' ? 'card' : undefined}
            data-checked={checked || undefined}
            data-disabled={isDisabled || undefined}
            data-invalid={invalid || undefined}
          >
            <span className="ui-radio__control">
              <input
                type="radio"
                className="ui-radio__input"
                name={name ?? id}
                value={option.value}
                checked={checked}
                disabled={isDisabled}
                required={required}
                aria-describedby={option.description != null ? descriptionId : undefined}
                onChange={() => setValue(option.value)}
              />
              <span className="ui-radio__circle" aria-hidden="true" />
            </span>
            <span className="ui-radio__text">
              <span className="ui-radio__label">{option.label}</span>
              {option.description != null && (
                <span id={descriptionId} className="ui-radio__description">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
});
