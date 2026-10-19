'use client';

import { useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { CalendarIcon } from '../icons';
import { cx, mergeRefs } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { useFormReset } from '../forms/form-reset';
import { useFormField } from './form-field-context';
import { FormValue, toISODate, useMissingValue } from './form-value';
import { renderSegments } from './segments-view';
import { useDateField, type DateFieldLabels } from './useDateField';
import { withRef, useId } from '../primitives/react-compat';

export { DEFAULT_DATE_FIELD_LABELS, type DateFieldLabels } from './useDateField';

export interface DateFieldProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  value?: Date | null;
  defaultValue?: Date | null;
  /** Called with the date once every segment is filled, and with null when one is cleared. */
  onValueChange?: (value: Date | null) => void;
  /** Order of day, month and year, the separators and the digits. Defaults to the `ThemeProvider` locale, then the browser's. */
  locale?: string;
  /** Earliest valid day (time of day ignored): an earlier date marks the field invalid. */
  minDate?: Date;
  /** Latest valid day (time of day ignored): a later date marks the field invalid. */
  maxDate?: Date;
  /** Field height and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Takes the segments out of the Tab order and leaves the date out of form data. */
  disabled?: boolean;
  /** Focusable and readable, not editable. */
  readOnly?: boolean;
  /** Danger border and aria-invalid. Also shown after a submit attempt while a required date is missing. */
  invalid?: boolean;
  /** Submits the date with the surrounding form as `YYYY-MM-DD` (empty when incomplete). */
  name?: string;
  /** Blocks native form submission while the date is incomplete; aria-required on the segments. */
  required?: boolean;
  /** Icon before the segments; `null` for none. Default: a calendar. */
  icon?: ReactNode;
  labels?: Partial<DateFieldLabels>;
}

/**
 * A date typed in place, segment by segment, in the locale's own order: "дд.мм.гггг", "mm/dd/yyyy", "yyyy/mm/dd"
 * (React Aria's DateField). Digits fill a segment and move on; ArrowUp / ArrowDown step it; Backspace clears it.
 * Each segment is a spinbutton, so a screen reader reads and changes it like a number, and a phone shows its
 * number keyboard. Pair it with a Calendar for picking, or use DatePicker for a field that opens one.
 */
export const DateField = withRef(function DateField({
  value,
  defaultValue = null,
  onValueChange,
  locale: localeProp,
  minDate,
  maxDate,
  size = 'md',
  disabled = false,
  readOnly = false,
  invalid = false,
  name,
  required,
  icon = <CalendarIcon />,
  labels,
  className,
  ref,
  id: idProp,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: DateFieldProps) {
  const locale = useLocale(localeProp);
  const field = useFormField();
  const autoId = useId();
  const id = idProp ?? autoId;
  // The field's own name labels every segment ("Due date month"); without a label element, its aria-label does.
  const labelledBy = ariaLabelledBy ?? (ariaLabel ? id : field?.labelId);
  const rootRef = useRef<HTMLDivElement>(null);
  const state = useDateField({
    value,
    defaultValue,
    onValueChange,
    locale,
    minDate,
    maxDate,
    disabled,
    readOnly,
    invalid,
    required: required ?? field?.required,
    labels,
    'aria-labelledby': labelledBy,
    'aria-describedby': ariaDescribedBy,
  });
  const [missing, markMissing] = useMissingValue(!!state.value);
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(rootRef, () => state.setValue(defaultValue), value === undefined);
  const shownInvalid = invalid || missing || state.outOfRange;

  return (
    <div
      {...state.getGroupProps({ ...rest, ref: mergeRefs(rootRef, ref) })}
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId)}
      className={cx('ui-field ui-date-segments ui-date-field', className)}
      data-size={size}
      data-invalid={shownInvalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-readonly={readOnly || undefined}
    >
      {icon != null && <span className="ui-field__icon">{icon}</span>}
      {renderSegments(state.segments)}
      <FormValue
        name={name}
        values={[toISODate(state.value)]}
        disabled={disabled}
        required={required}
        onMissing={(focus) => {
          markMissing();
          if (focus) state.focusFirst();
        }}
      />
    </div>
  );
});
