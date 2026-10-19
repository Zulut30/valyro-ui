import type { HTMLAttributes, LabelHTMLAttributes } from 'react';
import { useId } from '../primitives/react-compat';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import type { FormFieldContextValue } from './form-field-context';

/*
 * The wiring of FormField without its markup: one id per part, the label that points at the control, and the
 * control's `aria-describedby` (the description, or the error that replaces it while invalid, and a counter),
 * `aria-invalid` and `aria-required`. FormField renders with it; `context` is what FormField hands the controls
 * inside it (useFormField), so a custom control reads the same wiring. (`useFormField` is that context reader, so
 * this hook is `useField`.)
 */

export interface FieldOptions {
  /** Id of the control; the label points at it. Default: generated. */
  id?: string;
  /** The field renders a label (getLabelProps). Default true. */
  label?: boolean;
  /** A description is shown (getDescriptionProps); while invalid, the error replaces it. */
  description?: boolean;
  /** The field is invalid and shows its error (getErrorProps). */
  invalid?: boolean;
  required?: boolean;
  /** A counter is shown (getCounterProps), e.g. "42/280". */
  counter?: boolean;
  /** Ids that describe the control besides the field's own (they come first). */
  describedBy?: string;
}

export interface FieldState {
  /** Id of the control. */
  id: string;
  labelId?: string;
  descriptionId: string;
  errorId: string;
  counterId: string;
  /** Present while `required`: id of a hidden "required" word for controls whose role has no `aria-required` (FormField renders it). */
  requiredId?: string;
  /** The ids that describe the control now: yours, the error or the description, the counter. */
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  /** The FormField context for the controls inside (useFormField reads it). */
  context: FormFieldContextValue;
  /** The `<label>`: it points at the control. */
  getLabelProps: (props?: UserProps) => LabelHTMLAttributes<HTMLLabelElement>;
  /** The control: id, aria-describedby (your own ids first), aria-invalid and aria-required. */
  getControlProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { id: string };
  getDescriptionProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** The error message: announced as it appears. */
  getErrorProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  getCounterProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
}

export function useField({
  id: idProp,
  label = true,
  description = false,
  invalid = false,
  required = false,
  counter = false,
  describedBy: extra,
}: FieldOptions = {}): FieldState {
  const baseId = useId();
  const id = idProp ?? `${baseId}-control`;
  const labelId = label ? `${baseId}-label` : undefined;
  const descriptionId = `${baseId}-description`;
  const errorId = `${baseId}-error`;
  const counterId = `${baseId}-counter`;
  const requiredId = required ? `${baseId}-required` : undefined;
  const message = invalid ? errorId : description ? descriptionId : undefined;
  const describedBy = [extra, message, counter ? counterId : undefined].filter(Boolean).join(' ') || undefined;
  const join = (...ids: unknown[]) => ids.filter(Boolean).join(' ') || undefined;

  return {
    id,
    labelId,
    descriptionId,
    errorId,
    counterId,
    requiredId,
    describedBy,
    invalid,
    required,
    context: { id, labelId, describedBy, invalid, required, requiredId },
    getLabelProps: (props) => withUserProps({ id: labelId, htmlFor: id }, props),
    getControlProps: (props) =>
      withUserProps(
        {
          id,
          'aria-invalid': invalid || undefined,
          'aria-required': required || undefined,
        },
        { ...props, 'aria-describedby': join(props?.['aria-describedby'], describedBy) },
      ) as never,
    getDescriptionProps: (props) => withUserProps({ id: descriptionId }, props),
    getErrorProps: (props) => withUserProps({ id: errorId, role: 'alert' }, props),
    getCounterProps: (props) => withUserProps({ id: counterId }, props),
  };
}
