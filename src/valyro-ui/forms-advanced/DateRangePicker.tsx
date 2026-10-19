'use client';

import { useCallback, useRef, useState, type ComponentPropsWithRef } from 'react';
import { CalendarIcon } from '../icons';
import {
  addDays,
  addMonths,
  composeHandlers,
  cx,
  Floating,
  formatDate,
  GREGORIAN,
  isSameDay,
  mergeRefs,
  startOfDay,
  startOfMonth,
  useControllableState,
  useFocusTrap,
  type DismissReason,
  type WeekStart,
} from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { Button } from '../basic/Button';
import { Calendar, DEFAULT_CALENDAR_LABELS, type CalendarLabels, type DateRange } from './Calendar';
import { FormValue, toISODate, useMissingValue } from './form-value';
import { PickerTrigger, type FieldSize } from './PickerTrigger';
import { useFormReset } from '../forms/form-reset';
import './DateRangePicker.css';
import { withRef, useId, useSyncExternalStore } from '../primitives/react-compat';

export interface DateRangePreset {
  label: string;
  value: DateRange;
}

export interface DateRangePickerLabels extends CalendarLabels {
  /** Accessible name of the popover. */
  dialog: string;
  /** Accessible name of the preset list. */
  presets: string;
  apply: string;
  cancel: string;
  /** Names of the default presets. */
  today: string;
  yesterday: string;
  last7Days: string;
  last30Days: string;
  thisMonth: string;
  lastMonth: string;
}

export const DEFAULT_DATE_RANGE_PICKER_LABELS: DateRangePickerLabels = {
  ...DEFAULT_CALENDAR_LABELS,
  dialog: 'Choose date range',
  presets: 'Presets',
  apply: 'Apply',
  cancel: 'Cancel',
  today: 'Today',
  yesterday: 'Yesterday',
  last7Days: 'Last 7 days',
  last30Days: 'Last 30 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
};

export interface DateRangePickerProps extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'defaultValue' | 'onChange'> {
  value?: DateRange;
  defaultValue?: DateRange;
  onValueChange?: (value: DateRange) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Text shown in the trigger (and the confirm footer) while no range is picked. */
  placeholder?: string;
  locale?: string;
  /** First day of the week in the calendar grids: 0 = Sunday, 1 = Monday (when omitted). */
  weekStartsOn?: WeekStart;
  /** Earliest selectable day (time of day ignored); earlier days and presets starting before it are disabled. */
  minDate?: Date;
  /** Latest selectable day (time of day ignored); later days and presets ending after it are disabled. */
  maxDate?: Date;
  /** Return true to disable a day, e.g. weekends or booked dates. Presets ignore it. */
  isDateDisabled?: (date: Date) => boolean;
  /** Shortcuts in the sidebar. Defaults to common ranges ending today; pass `[]` to hide. */
  presets?: DateRangePreset[];
  /** Keep the selection as a draft until Apply; Cancel discards it. */
  confirm?: boolean;
  /** Trigger height and text size. */
  size?: FieldSize;
  /** Danger border on the trigger. Also shown after a submit attempt while a required range is missing. */
  invalid?: boolean;
  /** Submits `name[start]` and `name[end]` as `YYYY-MM-DD` (empty when unset). */
  name?: string;
  /** Blocks native form submission while no range is picked. */
  required?: boolean;
  /**
   * Keeps the panel (presets, calendar, Apply / Cancel) open in the page flow under the field instead of in a
   * popover, e.g. in a report sidebar. `open`, `defaultOpen` and `onOpenChange` do not apply, and the panel
   * never takes focus by itself: the field moves focus into it on click or ArrowDown.
   */
  inline?: boolean;
  labels?: Partial<DateRangePickerLabels>;
}

const EMPTY: DateRange = { start: null, end: null };

function getDefaultDateRangePresets(labels: DateRangePickerLabels, today = startOfDay(new Date())): DateRangePreset[] {
  const thisMonth = startOfMonth(today);
  return [
    { label: labels.today, value: { start: today, end: today } },
    { label: labels.yesterday, value: { start: addDays(today, -1), end: addDays(today, -1) } },
    { label: labels.last7Days, value: { start: addDays(today, -6), end: today } },
    { label: labels.last30Days, value: { start: addDays(today, -29), end: today } },
    { label: labels.thisMonth, value: { start: thisMonth, end: today } },
    { label: labels.lastMonth, value: { start: addMonths(thisMonth, -1), end: addDays(thisMonth, -1) } },
  ];
}

function formatDateRange({ start, end }: DateRange, locale?: string) {
  if (!start) return '';
  if (!end) return `${formatDate(start, locale)} – …`;
  return new Intl.DateTimeFormat(locale, { ...GREGORIAN, dateStyle: 'medium' }).formatRange(start, end);
}

// Below this width two months plus the preset column no longer fit beside each other (keep in sync with the CSS).
const NARROW_QUERY = '(max-width: 799px)';

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

/** First visible month: the range end sits in the last visible month; with no range, today's month leads. */
function monthFor({ start, end }: DateRange, count: number, max: Date | null) {
  const anchor = end ?? start;
  if (anchor) return startOfMonth(addMonths(anchor, -(count - 1)));
  const current = startOfMonth(new Date());
  // Don't open on months that lie entirely after maxDate.
  if (max && monthIndex(max) - monthIndex(current) < count - 1) return startOfMonth(addMonths(max, -(count - 1)));
  return current;
}

const sameRange = (a: DateRange, b: DateRange) => isSameDay(a.start, b.start) && isSameDay(a.end, b.end);

export const DateRangePicker = withRef(function DateRangePicker({
  value,
  defaultValue = EMPTY,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  placeholder = 'Pick a date range',
  locale: localeProp,
  weekStartsOn,
  minDate,
  maxDate,
  isDateDisabled,
  presets: presetsProp,
  confirm = false,
  size,
  invalid,
  name,
  required,
  disabled,
  inline = false,
  labels: labelsProp,
  className,
  ref,
  onClick,
  onKeyDown,
  ...rest
}: DateRangePickerProps) {
  const labels = { ...DEFAULT_DATE_RANGE_PICKER_LABELS, ...labelsProp };
  const locale = useLocale(localeProp);
  const [range, setRange] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const months = useMediaQuery(NARROW_QUERY) ? 1 : 2;
  const [draft, setDraft] = useState(range);
  const min = minDate ? startOfDay(minDate) : null;
  const max = maxDate ? startOfDay(maxDate) : null;
  const [month, setMonth] = useState(() => monthFor(range, months, max));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(
    triggerRef,
    () => {
      setRange(defaultValue);
      setDraft(defaultValue);
    },
    value === undefined,
  );
  const dialogId = useId();
  const popoverOpen = open && !inline;
  // Focus returns to the trigger only on Escape or a pick, never after a click elsewhere.
  useFocusTrap(popoverRef, popoverOpen, { restoreFocus: false });
  const [missing, markMissing] = useMissingValue(!!range.start);

  // Each opening starts from the committed value, also when `open` is controlled.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(range);
      setMonth(monthFor(range, months, max));
    }
  }
  // Inline, the panel never reopens: it follows the committed value whenever that changes.
  const [syncedRange, setSyncedRange] = useState(range);
  if (inline && !sameRange(range, syncedRange)) {
    setSyncedRange(range);
    setDraft(range);
  }

  const presets = presetsProp ?? getDefaultDateRangePresets(labels);
  const presetDisabled = ({ start, end }: DateRange) =>
    (min !== null && !!start && start < min) || (max !== null && !!end && end > max);

  const close = (returnFocus: boolean) => {
    if (inline) return;
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  /** Cancel: drop the draft. The popover closes (and redrafts on the next opening); inline, it resets in place. */
  const cancel = () => {
    if (!inline) return close(true);
    setDraft(range);
    setMonth(monthFor(range, months, max));
  };

  const focusPanel = () =>
    popoverRef.current?.querySelector<HTMLElement>('.ui-calendar__day[tabindex="0"]')?.focus({ preventScroll: true });

  const commit = (next: DateRange) => {
    setRange(next.start && !next.end ? { start: next.start, end: next.start } : next);
    close(true);
  };

  const choose = (next: DateRange, fromPreset: boolean) => {
    setDraft(next);
    if (fromPreset) setMonth(monthFor(next, months, max));
    if (!confirm && next.start && next.end) commit(next);
  };

  const panel = (
    <>
      <div className="ui-date-range-picker__body">
        {presets.length > 0 && (
          <div className="ui-date-range-picker__presets" role="group" aria-label={labels.presets}>
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="ui-date-range-picker__preset"
                aria-pressed={sameRange(preset.value, draft)}
                disabled={presetDisabled(preset.value)}
                onClick={() => choose(preset.value, true)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
        <Calendar
          mode="range"
          className="ui-date-range-picker__calendar"
          value={draft}
          onValueChange={(next) => choose(next, false)}
          month={month}
          onMonthChange={setMonth}
          numberOfMonths={months}
          locale={locale}
          weekStartsOn={weekStartsOn}
          minDate={minDate}
          maxDate={maxDate}
          isDateDisabled={isDateDisabled}
          labels={labels}
          // A popover hands the focus to the active day; inline, the page keeps it.
          autoFocus={!inline}
        />
      </div>
      {confirm && (
        <div className="ui-date-range-picker__footer">
          <span className="ui-date-range-picker__summary">
            {draft.start ? <bdi>{formatDateRange(draft, locale)}</bdi> : placeholder}
          </span>
          <Button size="sm" variant="ghost" onClick={cancel}>
            {labels.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!draft.start} onClick={() => commit(draft)}>
            {labels.apply}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <>
      <PickerTrigger
        {...rest}
        ref={mergeRefs(triggerRef, ref)}
        className={cx('ui-date-range-picker', className)}
        icon={<CalendarIcon />}
        placeholder={placeholder}
        hasValue={!!range.start}
        open={open || inline}
        size={size}
        invalid={invalid || missing}
        disabled={disabled}
        // Inline, the field opens nothing: it labels the panel under it and hands it the focus.
        {...(inline ? { 'aria-haspopup': undefined, 'aria-expanded': undefined } : {})}
        aria-controls={popoverOpen || inline ? dialogId : undefined}
        onClick={composeHandlers(onClick, () => (inline ? focusPanel() : setOpen((o) => !o)))}
        onKeyDown={composeHandlers(onKeyDown, (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (inline) focusPanel();
            else setOpen(true);
          }
        })}
      >
        {formatDateRange(range, locale)}
      </PickerTrigger>
      {name && (
        <>
          <FormValue name={`${name}[start]`} values={[toISODate(range.start)]} disabled={disabled} />
          <FormValue name={`${name}[end]`} values={[toISODate(range.end)]} disabled={disabled} />
        </>
      )}
      <FormValue
        values={[toISODate(range.start)]}
        disabled={disabled}
        required={required}
        onMissing={(focus) => {
          markMissing();
          if (focus) triggerRef.current?.focus();
        }}
      />
      {inline ? (
        <div
          ref={popoverRef}
          id={dialogId}
          role="group"
          aria-label={labels.dialog}
          className="ui-floating ui-date-range-picker__popover"
          data-inline=""
        >
          {panel}
        </div>
      ) : (
        <Floating
          ref={popoverRef}
          open={open}
          anchorRef={triggerRef}
          placement="bottom-start"
          onDismiss={(reason: DismissReason) => close(reason === 'escape')}
          id={dialogId}
          role="dialog"
          aria-label={labels.dialog}
          className="ui-date-range-picker__popover"
        >
          {panel}
        </Floating>
      )}
    </>
  );
});
