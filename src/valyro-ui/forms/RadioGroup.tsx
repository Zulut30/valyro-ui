'use client';

import { useMemo, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { useFormField } from '../forms-advanced/form-field-context';
import '../primitives/motion.css';
import { useRadioGroup } from './useRadioGroup';
import './RadioGroup.css';
import { withRef, useId } from '../primitives/react-compat';

export interface RadioGroupOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** Radios in order, each with a label and an optional description. Or compose them as children: `RadioGroup.Item`. */
  options?: RadioGroupOption[];
  /** The compound form instead of `options`: `RadioGroup.Item` elements. */
  children?: ReactNode;
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
  /**
   * Visible name above the options, linked to the group. Outside a FormField a group needs a name (this, or an
   * `aria-label` / `aria-labelledby`), or a screen reader reads the options with no question.
   */
  label?: ReactNode;
}

export interface RadioGroupItemProps extends Omit<RadioGroupOption, 'label'> {
  /** The radio's label. */
  children?: ReactNode;
}

/** A radio of the compound form (`RadioGroup.Item`): the props of a RadioGroupOption, with the label as children. */
export const RadioGroupItem = collectionPart<RadioGroupItemProps>('RadioGroup.Item');

/** Native radios inside a `radiogroup`; arrow keys move the selection as in any browser radio group. */
export const RadioGroup = withRef(function RadioGroup({
  options: optionsProp,
  children,
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
  label,
  className,
  ref,
  ...rest
}: RadioGroupProps) {
  const options = useMemo(
    () =>
      optionsProp ?? partsOf<RadioGroupItemProps>(children, RadioGroupItem).map(({ props: { children: label, ...option } }) => ({ ...option, label })),
    [optionsProp, children],
  );
  const field = useFormField();
  // The behaviour is useRadioGroup's (valyro-ui/headless); the radios are native, so the browser moves them.
  const radio = useRadioGroup({
    items: options,
    value: valueProp,
    defaultValue: defaultValue ?? '',
    onValueChange,
    disabled,
    required,
    invalid,
    name,
  });
  const { value } = radio;
  const legendId = useId();

  return (
    <div
      {...radio.getGroupProps({
        // Its own label names the group; inside a FormField the field's (a `for` pointing at a div names nothing).
        'aria-labelledby': label != null ? legendId : rest['aria-label'] ? undefined : field?.labelId,
        // FormField's `required` only marks its label (aria-hidden); announce it on the group.
        'aria-required': (required ?? field?.required) || undefined,
        ...rest,
        ref,
        className: cx('ui-radio-group', className),
        'data-orientation': orientation,
        'data-variant': variant,
        'data-size': size,
        'data-motion': animation === 'spring' ? 'spring' : undefined,
      })}
    >
      {label != null && (
        <span id={legendId} className="ui-radio-group__legend">
          {label}
        </span>
      )}
      {options.map((option) => {
        const isDisabled = disabled || option.disabled;
        const checked = option.value === value;
        const descriptionId = radio.getDescriptionId(option.value);
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
                {...radio.getInputProps(option, {
                  className: 'ui-radio__input',
                  'aria-describedby': option.description != null ? descriptionId : undefined,
                })}
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
}, { Item: RadioGroupItem });
