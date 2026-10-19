'use client';

import { useRef, type ComponentPropsWithRef } from 'react';
import { CalendarIcon } from '../icons';
import {
  composeHandlers,
  cx,
  Floating,
  formatDate,
  mergeRefs,
  useControllableState,
  useFocusTrap,
  type DismissReason,
  type WeekStart,
} from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { Calendar, DEFAULT_CALENDAR_LABELS, type CalendarLabels } from './Calendar';
import { FormValue, toISODate, useMissingValue } from './form-value';
import { PickerTrigger, type FieldSize } from './PickerTrigger';
import './DatePicker.css';
import { withRef, useId } from '../primitives/react-compat';

export interface DatePickerLabels extends CalendarLabels {
  /** Accessible name of the popover. */
  dialog: string;
}

export const DEFAULT_DATE_PICKER_LABELS: DatePickerLabels = {
  ...DEFAULT_CALENDAR_LABELS,
  dialog: 'Choose date',
};

export interface DatePickerProps extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'defaultValue' | 'onChange'> {
  value?: Date | null;
  defaultValue?: Date | null;
  onValueChange?: (value: Date | null) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Text shown in the trigger while no date is picked. */
  placeholder?: string;
  locale?: string;
  /** First day of the week in the calendar grid: 0 = Sunday, 1 = Monday (when omitted). */
  weekStartsOn?: WeekStart;
  /** Earliest selectable day (time of day ignored); earlier days are disabled. */
  minDate?: Date;
  /** Latest selectable day (time of day ignored); later days are disabled. */
  maxDate?: Date;
  /** Return true to disable a day, e.g. weekends or booked dates. */
  isDateDisabled?: (date: Date) => boolean;
  /** Trigger height and text size. */
  size?: FieldSize;
  /** Danger border on the trigger. Also shown after a submit attempt while a required date is missing. */
  invalid?: boolean;
  /** Submits the date with the surrounding form as `YYYY-MM-DD` (empty when unset). */
  name?: string;
  /** Blocks native form submission while no date is picked. */
  required?: boolean;
  labels?: Partial<DatePickerLabels>;
}

export const DatePicker = withRef(function DatePicker({
  value,
  defaultValue = null,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  placeholder = 'Pick a date',
  locale: localeProp,
  weekStartsOn,
  minDate,
  maxDate,
  isDateDisabled,
  size,
  invalid,
  name,
  required,
  disabled,
  labels: labelsProp,
  className,
  ref,
  onClick,
  onKeyDown,
  ...rest
}: DatePickerProps) {
  const labels = { ...DEFAULT_DATE_PICKER_LABELS, ...labelsProp };
  const locale = useLocale(localeProp);
  const [date, setDate] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  // Focus returns to the trigger only on Escape or a pick, never after a click elsewhere.
  useFocusTrap(popoverRef, open, { restoreFocus: false });
  const [missing, markMissing] = useMissingValue(!!date);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  return (
    <>
      <PickerTrigger
        {...rest}
        ref={mergeRefs(triggerRef, ref)}
        className={cx('ui-date-picker', className)}
        icon={<CalendarIcon />}
        placeholder={placeholder}
        hasValue={!!date}
        open={open}
        size={size}
        invalid={invalid || missing}
        disabled={disabled}
        aria-controls={open ? dialogId : undefined}
        onClick={composeHandlers(onClick, () => setOpen((o) => !o))}
        onKeyDown={composeHandlers(onKeyDown, (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        })}
      >
        {date && formatDate(date, locale)}
      </PickerTrigger>
      <FormValue
        name={name}
        values={[toISODate(date)]}
        disabled={disabled}
        required={required}
        onMissing={(focus) => {
          markMissing();
          if (focus) triggerRef.current?.focus();
        }}
      />
      <Floating
        ref={popoverRef}
        open={open}
        anchorRef={triggerRef}
        placement="bottom-start"
        onDismiss={(reason: DismissReason) => close(reason === 'escape')}
        id={dialogId}
        role="dialog"
        aria-label={labels.dialog}
        className="ui-date-picker__popover"
      >
        <Calendar
          value={date}
          onValueChange={(next) => {
            setDate(next);
            close(true);
          }}
          locale={locale}
          weekStartsOn={weekStartsOn}
          minDate={minDate}
          maxDate={maxDate}
          isDateDisabled={isDateDisabled}
          labels={labels}
          autoFocus
        />
      </Floating>
    </>
  );
});
