'use client';

import type { ComponentPropsWithRef } from 'react';
import { cx } from '../primitives';
import './ButtonGroup.css';
import { withRef } from '../primitives/react-compat';

export interface ButtonGroupProps extends ComponentPropsWithRef<'div'> {
  /** Join buttons into one control (shared borders, outer radius only). */
  attached?: boolean;
  /** Lay buttons out in a row or a column. */
  orientation?: 'horizontal' | 'vertical';
  /** Accessible name for the group. */
  label?: string;
}

export const ButtonGroup = withRef(function ButtonGroup({
  attached = false,
  orientation = 'horizontal',
  label,
  className,
  ...rest
}: ButtonGroupProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('ui-button-group', className)}
      data-attached={attached || undefined}
      data-orientation={orientation}
      {...rest}
    />
  );
});
