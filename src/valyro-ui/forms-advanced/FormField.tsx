'use client';

import { cloneElement, isValidElement, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { AlertCircleIcon } from '../icons';
import { cx } from '../primitives';
import { collectionPart, hasPart, partsOf } from '../primitives/compound';
import { FormFieldContext } from './form-field-context';
import { useField } from './useField';
import './FormField.css';
import { withRef } from '../primitives/react-compat';

export { useFormField, type FormFieldContextValue } from './form-field-context';

export interface FormFieldLabels {
  /** Read with controls that cannot carry `aria-required` (pickers, sliders, groups) when the field is required. */
  required: string;
}

export const DEFAULT_FORM_FIELD_LABELS: FormFieldLabels = { required: 'required' };

export interface FormFieldProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Text of the `<label>` above the control, linked to it by `id`. Or `FormField.Label`. */
  label?: ReactNode;
  /** Helper text under the control, linked via `aria-describedby`. Hidden while `error` is set. Or `FormField.Description`. */
  hint?: ReactNode;
  /** Error message; any truthy value marks the field invalid and replaces the hint. Or `FormField.Error`. */
  error?: ReactNode;
  /**
   * Shows a required mark next to the label and tells screen readers: `aria-required` on the control, or the
   * `labels.required` word in its description where its role has no `aria-required`.
   */
  required?: boolean;
  /** Slot at the end of the footer, e.g. a character counter "42/280". */
  counter?: ReactNode;
  /**
   * A single control. It receives `id`, `aria-describedby`, `aria-invalid` and, for components, `invalid`. Or the
   * compound form: `FormField.Label`, `FormField.Control` (around the control), `FormField.Description`, `FormField.Error`.
   */
  children: ReactNode;
  labels?: Partial<FormFieldLabels>;
}

export interface FormFieldLabelProps {
  /** Text of the label (the `label` prop). */
  children?: ReactNode;
}

export interface FormFieldControlProps {
  /** The control: a single element. */
  children: ReactElement;
}

export interface FormFieldDescriptionProps {
  /** Helper text (the `hint` prop). */
  children?: ReactNode;
}

export interface FormFieldErrorProps {
  /** Error message (the `error` prop): any truthy content marks the field invalid. */
  children?: ReactNode;
}

/** The label of the compound form (`FormField.Label`). */
export const FormFieldLabel = collectionPart<FormFieldLabelProps>('FormField.Label');
/** The control of the compound form (`FormField.Control`): it receives the field's id and ARIA. */
export const FormFieldControl = collectionPart<FormFieldControlProps>('FormField.Control');
/** Helper text under the control (`FormField.Description`). */
export const FormFieldDescription = collectionPart<FormFieldDescriptionProps>('FormField.Description');
/** The error message (`FormField.Error`); it replaces the description while shown. */
export const FormFieldError = collectionPart<FormFieldErrorProps>('FormField.Error');

const PARTS = [FormFieldLabel, FormFieldControl, FormFieldDescription, FormFieldError];

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

export const FormField = withRef(function FormField({
  label: labelProp,
  hint: hintProp,
  error: errorProp,
  required = false,
  counter,
  className,
  children,
  labels: labelsProp,
  ...rest
}: FormFieldProps) {
  const compound = hasPart(children, PARTS);
  const part = <P,>(type: unknown) => (compound ? partsOf<P & { children?: ReactNode }>(children, type)[0]?.props.children : undefined);
  const label = labelProp ?? part<FormFieldLabelProps>(FormFieldLabel);
  const hint = hintProp ?? part<FormFieldDescriptionProps>(FormFieldDescription);
  const error = errorProp ?? part<FormFieldErrorProps>(FormFieldError);
  const controlElement = compound ? part<FormFieldControlProps>(FormFieldControl) : children;
  const child = isValidElement<ControlProps>(controlElement) ? controlElement : null;
  const labels = { ...DEFAULT_FORM_FIELD_LABELS, ...labelsProp };
  const invalid = !!error;
  const message = invalid ? error : hint;
  const hasCounter = counter != null && counter !== false;
  // The ids and ARIA are useField's (valyro-ui/headless).
  const field = useField({
    id: child?.props.id,
    label: !!label,
    description: !!hint,
    invalid,
    required,
    counter: hasCounter,
    describedBy: child?.props['aria-describedby'],
  });

  // Native elements would render an unknown `invalid` attribute; only components get it.
  const isComponent = child !== null && typeof child.type !== 'string';
  const { 'aria-required': ariaRequired, ...wiring } = field.getControlProps({ 'aria-invalid': child?.props['aria-invalid'] });
  const control =
    child &&
    cloneElement(child as ReactElement<Record<string, unknown>>, {
      ...wiring,
      ...(isComponent ? { invalid } : { 'aria-required': ariaRequired }),
    });

  return (
    <FormFieldContext.Provider value={field.context}>
      <div {...rest} className={cx('ui-form-field', className)} data-invalid={invalid || undefined}>
        {label && (
          <label {...field.getLabelProps({ className: 'ui-form-field__label' })}>
            {label}
            {required && (
              <span className="ui-form-field__required" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        {/* Referenced, never shown: `hidden` text still counts for aria-describedby. */}
        {field.requiredId && (
          <span id={field.requiredId} hidden>
            {labels.required}
          </span>
        )}
        {control}
        {(!!message || hasCounter) && (
          <div className="ui-form-field__footer">
            {!!message && (
              <p
                {...(invalid ? field.getErrorProps : field.getDescriptionProps)({
                  className: 'ui-form-field__message',
                  'data-tone': invalid ? 'error' : 'hint',
                })}
              >
                {invalid && <AlertCircleIcon size={14} className="ui-form-field__message-icon" />}
                <span>{message}</span>
              </p>
            )}
            {hasCounter && <span {...field.getCounterProps({ className: 'ui-form-field__counter' })}>{counter}</span>}
          </div>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}, { Label: FormFieldLabel, Control: FormFieldControl, Description: FormFieldDescription, Error: FormFieldError });
