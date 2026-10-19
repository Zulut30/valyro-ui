'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../primitives';
import './PickerTrigger.css';
import { withRef } from '../primitives/react-compat';

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

/** `.ui-field`-styled button that opens a picker popover (date, range, time, colour). */
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
  ...rest
}: PickerTriggerProps) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      {...rest}
      disabled={disabled}
      className={cx('ui-field ui-picker-trigger', className)}
      data-size={size}
      data-state={open ? 'open' : 'closed'}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
    >
      <span className="ui-field__icon">{icon}</span>
      <span className="ui-picker-trigger__value" data-placeholder={!hasValue || undefined}>
        {/* <bdi>: a value formatted for another script's locale keeps its own order under dir="rtl". */}
        {hasValue ? <bdi>{children}</bdi> : placeholder}
      </span>
    </button>
  );
});
