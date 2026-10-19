'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../primitives';
import { useFormField } from './form-field-context';
import './PickerTrigger.css';
import { withRef, useId } from '../primitives/react-compat';

export type FieldSize = 'sm' | 'md' | 'lg';

// `placeholder` is omitted: @types/react 17 types it as a string on every element.
interface PickerTriggerProps extends Omit<ComponentPropsWithRef<'button'>, 'placeholder'> {
  icon: ReactNode;
  placeholder?: ReactNode;
  hasValue: boolean;
  open: boolean;
  size?: FieldSize;
  invalid?: boolean;
}

/**
 * `.ui-field`-styled button that opens a picker popover (date, range, time, colour).
 *
 * Inside a FormField the label names the button through `<label for>`, which would replace the picked value as the
 * name; the button is named by the label and the value together instead ("Due date, 12 Oct 2026"). A button cannot
 * be `aria-required`, so a required field's "required" word joins its description.
 */
export const PickerTrigger = withRef(function PickerTrigger({
  icon,
  placeholder,
  hasValue,
  open,
  size = 'md',
  invalid,
  disabled,
  className,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: PickerTriggerProps) {
  const field = useFormField();
  const valueId = useId();
  const labelledBy = ariaLabelledBy ?? (!ariaLabel && field?.labelId ? `${field.labelId} ${valueId}` : undefined);
  const describedBy = [ariaDescribedBy, field?.required ? field.requiredId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      // Announced too, not only drawn (an explicit aria-invalid, e.g. from a FormField, wins).
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      {...rest}
      disabled={disabled}
      className={cx('ui-field ui-picker-trigger', className)}
      data-size={size}
      data-state={open ? 'open' : 'closed'}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
    >
      <span className="ui-field__icon">{icon}</span>
      <span id={valueId} className="ui-picker-trigger__value" data-placeholder={!hasValue || undefined}>
        {/* <bdi>: a value formatted for another script's locale keeps its own order under dir="rtl". */}
        {hasValue ? <bdi>{children}</bdi> : placeholder}
      </span>
    </button>
  );
});
