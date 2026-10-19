'use client';

import { useMemo, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { withRef } from '../primitives/react-compat';
import { FormFieldContext, useFormField } from '../forms-advanced/form-field-context';
import { useField } from '../forms-advanced/useField';
import { Checkbox } from './Checkbox';
import { useCheckboxGroup } from './useCheckboxGroup';
import './CheckboxGroup.css';

export interface CheckboxGroupLabels {
  /** Read with the group's description while `required` (a group has no `aria-required`). */
  required: string;
}

export const DEFAULT_CHECKBOX_GROUP_LABELS: CheckboxGroupLabels = { required: 'required' };

export interface CheckboxGroupOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface CheckboxGroupProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** Checkboxes in order, each with a label and an optional description. Or compose them as children: `CheckboxGroup.Item`. */
  options?: CheckboxGroupOption[];
  /** The compound form instead of `options`: `CheckboxGroup.Item` elements. */
  children?: ReactNode;
  /** Checked values, in the order they were checked. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Name of the checkboxes: each checked one submits its value under it. */
  name?: string;
  /**
   * Visible name above the checkboxes, linked to the group. Outside a FormField a group needs a name (this, or an
   * `aria-label` / `aria-labelledby`), or a screen reader reads the checkboxes with no question.
   */
  label?: ReactNode;
  /** Helper text under the checkboxes, read with the group. Hidden while `error` is set. */
  description?: ReactNode;
  /** Error message; any truthy value marks the group invalid and replaces the description. */
  error?: ReactNode;
  /** At least one box must be checked: a required mark, the `labels.required` word, and the form does not submit without one. */
  required?: boolean;
  /** Error colour and `aria-invalid` on every checkbox (set by `error` or a FormField too). */
  invalid?: boolean;
  /** Disables every checkbox. */
  disabled?: boolean;
  /** The checks show but cannot change. */
  readOnly?: boolean;
  /** Stack the checkboxes in a column or lay them out in a row. */
  orientation?: 'vertical' | 'horizontal';
  /** Checkbox and text size. */
  size?: 'sm' | 'md' | 'lg';
  labels?: Partial<CheckboxGroupLabels>;
}

export interface CheckboxGroupItemProps extends Omit<CheckboxGroupOption, 'label'> {
  /** The checkbox's label. */
  children?: ReactNode;
}

/** A checkbox of the compound form (`CheckboxGroup.Item`): the props of a CheckboxGroupOption, with the label as children. */
export const CheckboxGroupItem = collectionPart<CheckboxGroupItemProps>('CheckboxGroup.Item');

/**
 * Native checkboxes in a named `group` with one label, description, error and "at least one" requirement, as React
 * Aria's CheckboxGroup. Inside a FormField the field's label, description and error describe the group instead.
 */
export const CheckboxGroup = withRef(function CheckboxGroup({
  options: optionsProp,
  children,
  value,
  defaultValue,
  onValueChange,
  name,
  label,
  description,
  error,
  required: requiredProp,
  invalid: invalidProp = false,
  disabled = false,
  readOnly = false,
  orientation = 'vertical',
  size = 'md',
  labels: labelsProp,
  className,
  ref,
  'aria-describedby': describedByProp,
  ...rest
}: CheckboxGroupProps) {
  const options = useMemo(
    () =>
      optionsProp ??
      partsOf<CheckboxGroupItemProps>(children, CheckboxGroupItem).map(({ props: { children: itemLabel, ...option } }) => ({ ...option, label: itemLabel })),
    [optionsProp, children],
  );
  const labels = { ...DEFAULT_CHECKBOX_GROUP_LABELS, ...labelsProp };
  const outer = useFormField();
  const invalid = invalidProp || !!error;
  const required = requiredProp ?? outer?.required ?? false;
  // Its own label, description and error get ids like a FormField's (useField, valyro-ui/headless).
  const field = useField({
    label: label != null,
    description: description != null,
    invalid: !!error,
    required: required && !outer?.requiredId,
    describedBy: describedByProp,
  });
  // The behaviour is useCheckboxGroup's (valyro-ui/headless); the checkboxes are native.
  const group = useCheckboxGroup({ items: options, value, defaultValue, onValueChange, disabled, readOnly, required, invalid, name });
  const message = error || description;

  return (
    <div
      {...group.getGroupProps({
        // Its own label names the group; inside a FormField the field's (a `for` pointing at a div names nothing).
        'aria-labelledby': label != null ? field.labelId : rest['aria-label'] ? undefined : outer?.labelId,
        // A group has no aria-required: the word "required" is read with its description.
        'aria-describedby': cx(field.describedBy, field.requiredId, required && outer?.requiredId) || undefined,
        ...rest,
        ref,
        className: cx('ui-checkbox-group', className),
        'data-orientation': orientation,
        'data-invalid': invalid || undefined,
      })}
    >
      {label != null && (
        <span id={field.labelId} className="ui-checkbox-group__label">
          {label}
          {required && (
            <span className="ui-checkbox-group__required" aria-hidden="true">
              *
            </span>
          )}
        </span>
      )}
      {field.requiredId && (
        <span id={field.requiredId} hidden>
          {labels.required}
        </span>
      )}
      <div className="ui-checkbox-group__items">
        {/* The checkboxes are the group's: a surrounding FormField's required and ids describe the group, not each box. */}
        <FormFieldContext.Provider value={null}>
          {options.map((option) => {
            const { type: _type, ...input } = group.getInputProps(option);
            return (
              <Checkbox
                key={option.value}
                {...input}
                size={size}
                invalid={invalid}
                label={option.label}
                description={option.description}
              />
            );
          })}
        </FormFieldContext.Provider>
      </div>
      {!!message && (
        <p
          {...(error ? field.getErrorProps : field.getDescriptionProps)({
            className: 'ui-checkbox-group__message',
            'data-tone': error ? 'error' : 'hint',
          })}
        >
          {message}
        </p>
      )}
    </div>
  );
}, { Item: CheckboxGroupItem });
