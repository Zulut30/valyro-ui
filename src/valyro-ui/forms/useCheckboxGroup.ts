import type { ChangeEvent, HTMLAttributes, InputHTMLAttributes } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { useId } from '../primitives/react-compat';
import { partId, useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';
import { useFormReset } from './form-reset';

/*
 * The behaviour of CheckboxGroup without its markup (React Aria's useCheckboxGroup): the checked values of a group
 * of native checkboxes, controlled or not, in a `role="group"`. `required` means at least one: while none is checked
 * every checkbox is `required`, so the form does not submit and the browser points at the group; once one is
 * checked none is. `invalid`, `disabled` and `readOnly` reach every checkbox. A form reset brings an uncontrolled
 * value back to its default. The group has no `aria-required`: name it, and describe "required" in its description.
 */

export interface CheckboxGroupOptions {
  /** The checkboxes in order: their values, and which are disabled. */
  items: CheckboxDescriptor[];
  /** Checked values, in the order they were checked. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Disables every checkbox. */
  disabled?: boolean;
  /** The values show but cannot change (`aria-readonly`). */
  readOnly?: boolean;
  /** At least one checkbox must be checked for the form to submit. */
  required?: boolean;
  /** aria-invalid on every checkbox. */
  invalid?: boolean;
  /** Name of the checkboxes: each checked one submits its value under it. */
  name?: string;
  /** An uncontrolled value goes back to `defaultValue` when the surrounding form resets. Default true. */
  formReset?: boolean;
}

/** A checkbox, as the getters see it. */
export interface CheckboxDescriptor {
  value: string;
  disabled?: boolean;
}

export interface CheckboxGroupState {
  value: string[];
  setValue: (value: string[]) => void;
  isChecked: (value: string) => boolean;
  /** Checks or unchecks one value (toggles it without `checked`). */
  toggle: (value: string, checked?: boolean) => void;
  /** The `role="group"` element; name it with `aria-labelledby` (its label) or `aria-label`. */
  getGroupProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** A native `<input type="checkbox">` of the group. */
  getInputProps: (item: CheckboxDescriptor, props?: UserProps) => InputHTMLAttributes<HTMLInputElement> & {
    'data-state': 'checked' | 'unchecked';
  };
  /** An id for the description of the checkbox with `value` (its `aria-describedby`). */
  getDescriptionId: (value: string) => string;
}

const NO_VALUE: string[] = [];

export function useCheckboxGroup({
  items,
  value: valueProp,
  defaultValue = NO_VALUE,
  onValueChange,
  disabled = false,
  readOnly = false,
  required = false,
  invalid = false,
  name,
  formReset = true,
}: CheckboxGroupOptions): CheckboxGroupState {
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const baseId = useId();
  const [groupRef, setGroupNode] = useNodeRef();
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(groupRef, () => setValue(defaultValue), formReset && valueProp === undefined);

  const toggle = (itemValue: string, checked = !value.includes(itemValue)) => {
    if (readOnly || disabled) return;
    setValue((prev) => (checked ? (prev.includes(itemValue) ? prev : [...prev, itemValue]) : prev.filter((v) => v !== itemValue)));
  };
  // `required` asks for one checked box: the browser blocks the submit on the first unchecked one while none is.
  const missing = required && !items.some((item) => value.includes(item.value));

  return {
    value,
    setValue,
    isChecked: (itemValue) => value.includes(itemValue),
    toggle,
    getGroupProps: (props) =>
      withUserProps({ ref: setGroupNode, role: 'group', 'aria-disabled': disabled || undefined }, props) as never,
    getInputProps: (item, props) => {
      const checked = value.includes(item.value);
      return withUserProps(
        {
          type: 'checkbox',
          name,
          value: item.value,
          checked,
          disabled: disabled || item.disabled,
          required: missing || undefined,
          'aria-invalid': invalid || undefined,
          'aria-readonly': readOnly || undefined,
          'data-state': checked ? 'checked' : 'unchecked',
          onChange: (event: ChangeEvent<HTMLInputElement>) => toggle(item.value, event.currentTarget.checked),
        },
        props,
      ) as never;
    },
    getDescriptionId: (itemValue) => partId(baseId, 'description', itemValue),
  };
}
