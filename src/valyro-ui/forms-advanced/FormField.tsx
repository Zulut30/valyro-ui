'use client';

import { cloneElement, isValidElement, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { AlertCircleIcon } from '../icons';
import { cx } from '../primitives';
import { FormFieldContext } from './form-field-context';
import './FormField.css';
import { withRef, useId } from '../primitives/react-compat';

export { useFormField, type FormFieldContextValue } from './form-field-context';

export interface FormFieldProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Text of the `<label>` above the control, linked to it by `id`. */
  label?: ReactNode;
  /** Helper text under the control, linked via `aria-describedby`. Hidden while `error` is set. */
  hint?: ReactNode;
  /** Error message; any truthy value marks the field invalid and replaces the hint. */
  error?: ReactNode;
  /** Shows a required mark next to the label. */
  required?: boolean;
  /** Slot at the end of the footer, e.g. a character counter "42/280". */
  counter?: ReactNode;
  /** A single control. It receives `id`, `aria-describedby`, `aria-invalid` and, for components, `invalid`. */
  children: ReactElement;
}

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

export const FormField = withRef(function FormField({
  label,
  hint,
  error,
  required = false,
  counter,
  className,
  children,
  ...rest
}: FormFieldProps) {
  const baseId = useId();
  const child = isValidElement<ControlProps>(children) ? children : null;
  const invalid = !!error;
  const id = child?.props.id ?? `${baseId}-control`;
  const labelId = label ? `${baseId}-label` : undefined;
  const message = invalid ? error : hint;
  const messageId = message ? `${baseId}-message` : undefined;
  const counterId = counter != null && counter !== false ? `${baseId}-counter` : undefined;
  const describedBy =
    [child?.props['aria-describedby'], messageId, counterId].filter(Boolean).join(' ') || undefined;

  // Native elements would render an unknown `invalid` attribute; only components get it.
  const isComponent = child !== null && typeof child.type !== 'string';
  const control =
    child &&
    cloneElement(child as ReactElement<Record<string, unknown>>, {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': child.props['aria-invalid'] ?? (invalid || undefined),
      ...(isComponent ? { invalid } : { 'aria-required': required || undefined }),
    });

  return (
    <FormFieldContext.Provider value={{ id, labelId, describedBy, invalid, required }}>
      <div {...rest} className={cx('ui-form-field', className)} data-invalid={invalid || undefined}>
        {label && (
          <label id={labelId} htmlFor={id} className="ui-form-field__label">
            {label}
            {required && (
              <span className="ui-form-field__required" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        {control}
        {(messageId || counterId) && (
          <div className="ui-form-field__footer">
            {messageId && (
              <p
                id={messageId}
                className="ui-form-field__message"
                data-tone={invalid ? 'error' : 'hint'}
                role={invalid ? 'alert' : undefined}
              >
                {invalid && <AlertCircleIcon size={14} className="ui-form-field__message-icon" />}
                <span>{message}</span>
              </p>
            )}
            {counterId && (
              <span id={counterId} className="ui-form-field__counter">
                {counter}
              </span>
            )}
          </div>
        )}
      </div>
    </FormFieldContext.Provider>
  );
});
