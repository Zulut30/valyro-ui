'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../primitives';
import './Separator.css';
import { withRef } from '../primitives/react-compat';

export interface SeparatorProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Horizontal rule across the container, or a vertical line stretched to the row height. */
  orientation?: 'horizontal' | 'vertical';
  /** Text in the middle, e.g. "OR". Horizontal only. */
  label?: ReactNode;
  /** Purely visual (default) — hidden from assistive tech. */
  decorative?: boolean;
}

export const Separator = withRef(function Separator({
  orientation = 'horizontal',
  label,
  decorative = true,
  className,
  ...rest
}: SeparatorProps) {
  const a11y = decorative
    ? { role: 'none' as const }
    : { role: 'separator' as const, 'aria-orientation': orientation };
  // Labels are horizontal-only; a vertical separator ignores them and stays a plain line.
  const labelled = orientation === 'horizontal' && label != null && label !== false && label !== '';
  return (
    <div
      {...a11y}
      className={cx('ui-separator', className)}
      data-orientation={orientation}
      data-labelled={labelled || undefined}
      {...rest}
    >
      {labelled && <span className="ui-separator__label">{label}</span>}
    </div>
  );
});
