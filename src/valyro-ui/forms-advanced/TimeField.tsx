'use client';

import { useMemo, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { ClockIcon } from '../icons';
import { cx, getHourCycle, mergeRefs } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { useFormReset } from '../forms/form-reset';
import { useFormField } from './form-field-context';
import { FormValue, useMissingValue } from './form-value';
import { renderSegments } from './segments-view';
import { useTimeField, type TimeFieldLabels } from './useDateField';
import { withRef, useId } from '../primitives/react-compat';

export { DEFAULT_TIME_FIELD_LABELS, type TimeFieldLabels } from './useDateField';

export interface TimeFieldProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** 24-hour "HH:mm". */
  value?: string | null;
  defaultValue?: string | null;
  /** Called with "HH:mm" once every segment is filled, and with null when one is cleared. */
  onValueChange?: (value: string | null) => void;
  /** 12 (with an AM/PM segment) or 24. Defaults to the locale's clock: 12 in en-US, 24 in most of Europe. */
  hourCycle?: 12 | 24;
  /** Order of the segments, the digits and the AM/PM names. Defaults to the `ThemeProvider` locale, then the browser's. */
  locale?: string;
  /** Field height and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Takes the segments out of the Tab order and leaves the time out of form data. */
  disabled?: boolean;
  /** Focusable and readable, not editable. */
  readOnly?: boolean;
  /** Danger border and aria-invalid. Also shown after a submit attempt while a required time is missing. */
  invalid?: boolean;
  /** Submits the time with the surrounding form as 24-hour `HH:mm` (empty when incomplete). */
  name?: string;
  /** Blocks native form submission while the time is incomplete; aria-required on the segments. */
  required?: boolean;
  /** Icon before the segments; `null` for none. Default: a clock. */
  icon?: ReactNode;
  labels?: Partial<TimeFieldLabels>;
}

/**
 * A time typed in place, segment by segment: hour, minute and, on a 12-hour clock, AM/PM, in the locale's order
 * (React Aria's TimeField). Digits fill a segment and move on; ArrowUp / ArrowDown step it; "a" / "p" set the
 * period. Each segment is a spinbutton for screen readers and opens the number keyboard on a phone.
 */
export const TimeField = withRef(function TimeField({
  value,
  defaultValue = null,
  onValueChange,
  hourCycle: hourCycleProp,
  locale: localeProp,
  size = 'md',
  disabled = false,
  readOnly = false,
  invalid = false,
  name,
  required,
  icon = <ClockIcon />,
  labels,
  className,
  ref,
  id: idProp,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: TimeFieldProps) {
  const locale = useLocale(localeProp);
  const hourCycle = useMemo(() => hourCycleProp ?? getHourCycle(locale), [hourCycleProp, locale]);
  const field = useFormField();
  const autoId = useId();
  const id = idProp ?? autoId;
  const labelledBy = ariaLabelledBy ?? (ariaLabel ? id : field?.labelId);
  const rootRef = useRef<HTMLDivElement>(null);
  const state = useTimeField({
    value,
    defaultValue,
    onValueChange,
    hourCycle,
    locale,
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

  return (
    <div
      {...state.getGroupProps({ ...rest, ref: mergeRefs(rootRef, ref) })}
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId)}
      className={cx('ui-field ui-date-segments ui-time-field', className)}
      data-size={size}
      data-invalid={invalid || missing ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-readonly={readOnly || undefined}
    >
      {icon != null && <span className="ui-field__icon">{icon}</span>}
      {renderSegments(state.segments)}
      <FormValue
        name={name}
        values={[state.value ?? '']}
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
