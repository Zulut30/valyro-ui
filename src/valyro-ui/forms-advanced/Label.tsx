'use client';

import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import { InfoIcon } from '../icons';
import { composeHandlers, cx } from '../primitives';
import { withRef } from '../primitives/react-compat';
import { IconButton } from '../basic/IconButton';
import { Tooltip } from '../basic/Tooltip';
import { useFormField } from './form-field-context';
import './Label.css';

export interface LabelLabels {
  /** Read by screen readers instead of the "*" mark. */
  required: string;
  /** Shown after the text of an optional field. */
  optional: string;
  /** Accessible name of the `info` button. */
  info: string;
}

export const defaultLabelLabels: LabelLabels = { required: 'required', optional: '(optional)', info: 'More information' };

export interface LabelProps extends ComponentPropsWithRef<'label'> {
  /** Shows the "*" mark; screen readers hear the `labels.required` word instead. Inside a FormField: the field's `required`. */
  required?: boolean;
  /** Shows `labels.optional` after the text, for forms where most fields are required. */
  optional?: boolean;
  /** Dims the label to match a disabled control. */
  disabled?: boolean;
  /** Extra help behind an info button next to the label, shown in a Tooltip on hover and focus. */
  info?: ReactNode;
  /** Text size. */
  size?: 'sm' | 'md';
  labels?: Partial<LabelLabels>;
}

const noTextSelection = (event: MouseEvent<HTMLLabelElement>) => {
  // A double click on a label selects its text in every browser; it is a click target, not prose.
  if (event.detail > 1) event.preventDefault();
};

/**
 * The text that names a form control. Outside a FormField it is a plain `<label htmlFor>`; inside one it finds the
 * control on its own. A required mark that screen readers hear as a word, an "(optional)" note, and an info button
 * with a tooltip that stays out of the control's accessible name.
 */
export const Label = withRef(function Label({
  required,
  optional = false,
  disabled = false,
  info,
  size = 'md',
  labels,
  htmlFor,
  id,
  className,
  children,
  onMouseDown,
  ...rest
}: LabelProps) {
  const field = useFormField();
  const t = { ...defaultLabelLabels, ...labels };
  const isRequired = required ?? field?.required ?? false;
  const label = (
    <label
      {...rest}
      id={id ?? field?.labelId}
      htmlFor={htmlFor ?? field?.id}
      className={cx('ui-label', className)}
      data-size={size}
      data-disabled={disabled || undefined}
      onMouseDown={composeHandlers(onMouseDown, noTextSelection)}
    >
      {children}
      {isRequired && (
        <>
          <span className="ui-label__required" aria-hidden="true">
            *
          </span>
          <span className="ui-sr-only">{t.required}</span>
        </>
      )}
      {optional && !isRequired && <span className="ui-label__optional">{t.optional}</span>}
    </label>
  );
  if (info == null || info === false) return label;
  // The info button sits beside the label, not inside it: its name would otherwise join the control's name.
  return (
    <span className="ui-label__row" data-size={size}>
      {label}
      <Tooltip content={info}>
        <IconButton className="ui-label__info" size="sm" round icon={<InfoIcon size={14} />} label={t.info} disabled={disabled} />
      </Tooltip>
    </span>
  );
});
