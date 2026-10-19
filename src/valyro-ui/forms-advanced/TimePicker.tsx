'use client';

import { useEffect, useMemo, useRef, type ComponentPropsWithRef, type KeyboardEvent } from 'react';
import { ClockIcon } from '../icons';
import {
  composeHandlers,
  cx,
  Floating,
  getHourCycle,
  isMotionReduced,
  mergeRefs,
  useControllableState,
  useFocusTrap,
  type DismissReason,
} from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { FormValue, toTimeValue, useMissingValue } from './form-value';
import { PickerTrigger, type FieldSize } from './PickerTrigger';
import { useFormReset } from '../forms/form-reset';
import './TimePicker.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export interface TimePickerLabels {
  /** Accessible name of the popover. */
  dialog: string;
  hours: string;
  minutes: string;
  /** Accessible name of the AM/PM column. */
  period: string;
  /** Day-period names; default to the `locale`'s own (AM/PM in English). */
  am?: string;
  pm?: string;
}

export const DEFAULT_TIME_PICKER_LABELS: TimePickerLabels = {
  dialog: 'Choose time',
  hours: 'Hours',
  minutes: 'Minutes',
  period: 'AM/PM',
};

export interface TimePickerProps extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'defaultValue' | 'onChange'> {
  /** 24-hour "HH:mm" string. */
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Display and pick in 12-hour (AM/PM) or 24-hour format; defaults to the locale's clock. The value is always 24-hour. */
  hourCycle?: 12 | 24;
  /** Minutes between options in the minute column. */
  minuteStep?: number;
  /** Text shown in the trigger while no time is picked. */
  placeholder?: string;
  /** Locale for digits and AM/PM names. Defaults to the `ThemeProvider` locale, then the browser's. */
  locale?: string;
  /** Trigger height and text size. */
  size?: FieldSize;
  /** Danger border on the trigger. Also shown after a submit attempt while a required time is missing. */
  invalid?: boolean;
  /** Submits the time with the surrounding form as 24-hour `HH:mm` (empty when unset). */
  name?: string;
  /** Blocks native form submission while no time is picked. */
  required?: boolean;
  /**
   * Keeps the columns open in the page flow under the field instead of in a popover (a settings page, a
   * showcase). `open`, `defaultOpen` and `onOpenChange` do not apply, and the columns never take focus by
   * themselves: the field moves focus into them on click or ArrowDown.
   */
  inline?: boolean;
  labels?: Partial<TimePickerLabels>;
}

interface Time {
  h: number;
  m: number;
}

function parseTime(value: string | null | undefined): Time | null {
  const match = value ? /^(\d{1,2}):(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

const timeFormat = (locale: string | undefined, hourCycle: 12 | 24) =>
  new Intl.DateTimeFormat(locale, {
    hour: hourCycle === 24 ? '2-digit' : 'numeric',
    minute: '2-digit',
    hourCycle: hourCycle === 24 ? 'h23' : 'h12',
  });

const at = ({ h, m }: Time) => new Date(2000, 0, 1, h, m);

/** The locale's own AM and PM names, and whether the locale writes the period before the hour ("午前9:00"). */
export function dayPeriods(locale: string | undefined): { names: [string, string]; leading: boolean } {
  const format = timeFormat(locale, 12);
  const parts = (h: number) => format.formatToParts(at({ h, m: 0 }));
  const period = (h: number) => parts(h).find((p) => p.type === 'dayPeriod')?.value;
  const types = parts(9).map((p) => p.type);
  return {
    names: [period(9) ?? 'AM', period(21) ?? 'PM'],
    leading: types.includes('dayPeriod') && types.indexOf('dayPeriod') < types.indexOf('hour'),
  };
}

function formatTime(time: Time, hourCycle: 12 | 24, locale: string | undefined, periods: [string, string]) {
  return timeFormat(locale, hourCycle)
    .formatToParts(at(time))
    .map((part) => (part.type === 'dayPeriod' ? periods[time.h < 12 ? 0 : 1] : part.value))
    .join('');
}

export const TimePicker = withRef(function TimePicker({
  value,
  defaultValue = null,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  hourCycle: hourCycleProp,
  minuteStep = 5,
  placeholder = 'Pick a time',
  locale: localeProp,
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
}: TimePickerProps) {
  const labels = { ...DEFAULT_TIME_PICKER_LABELS, ...labelsProp };
  const locale = useLocale(localeProp);
  // The locale's own clock when not set: 12-hour in en-US, 24-hour in most of Europe.
  const hourCycle = useMemo(() => hourCycleProp ?? getHourCycle(locale), [hourCycleProp, locale]);
  const [raw, setRaw] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(triggerRef, () => setRaw(defaultValue), value === undefined);
  const dialogId = useId();
  const time = parseTime(raw);
  const popoverOpen = open && !inline;
  // Focus returns to the trigger only on Escape or Enter, never after a click elsewhere.
  useFocusTrap(panelRef, popoverOpen, { restoreFocus: false });
  const [missing, markMissing] = useMissingValue(!!time);

  const localePeriods = useMemo(() => dayPeriods(locale), [locale]);
  const periods: [string, string] = [labels.am ?? localePeriods.names[0], labels.pm ?? localePeriods.names[1]];
  const twoDigits = useMemo(() => new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }), [locale]);
  // A 12-hour clock writes "9:30 AM", not "09:30 AM": its hour column has no leading zero either.
  const plainDigits = useMemo(() => new Intl.NumberFormat(locale, { useGrouping: false }), [locale]);

  const close = (returnFocus: boolean) => {
    if (inline) return;
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const focusColumns = () => panelRef.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true });

  const commit = (next: Time) => setRaw(toTimeValue(next));

  useEffect(() => {
    if (!popoverOpen) return;
    // Wait a frame: the popover stays hidden until its first position is computed.
    const frame = requestAnimationFrame(focusColumns);
    return () => cancelAnimationFrame(frame);
    // focusColumns only reads refs.
  }, [popoverOpen]);

  const step = Math.max(1, Math.round(minuteStep));
  const minuteValues = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  // A value off the step grid (e.g. 10:07 with step 5) is still shown and selectable.
  if (time && !minuteValues.includes(time.m)) minuteValues.push(time.m);
  minuteValues.sort((a, b) => a - b);

  const isPm = !!time && time.h >= 12;
  const hourOptions =
    hourCycle === 24
      ? Array.from({ length: 24 }, (_, h) => ({ value: h, label: twoDigits.format(h) }))
      : Array.from({ length: 12 }, (_, i) => ({ value: i || 12, label: plainDigits.format(i || 12) }));
  const selectedHour = time ? (hourCycle === 24 ? time.h : time.h % 12 || 12) : null;

  const setHour = (hour: number) => {
    const h = hourCycle === 24 ? hour : (hour % 12) + (isPm ? 12 : 0);
    commit({ h, m: time?.m ?? 0 });
  };
  const setMinute = (m: number) => commit({ h: time?.h ?? 0, m });
  const setPeriod = (pm: boolean) => commit({ h: ((time?.h ?? 0) % 12) + (pm ? 12 : 0), m: time?.m ?? 0 });

  const periodColumn = hourCycle === 12 && (
    <TimeColumn
      label={labels.period}
      options={[
        { value: 0, label: periods[0] },
        { value: 1, label: periods[1] },
      ]}
      selected={time ? Number(isPm) : null}
      onSelect={(v) => setPeriod(v === 1)}
    />
  );

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const columns = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="listbox"]')];
    const index = columns.indexOf(event.target as HTMLElement);
    const next = columns[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const panel = (
    <div ref={panelRef} className="ui-time-picker__columns" onKeyDown={onPanelKeyDown}>
      {periodColumn && localePeriods.leading && periodColumn}
      <TimeColumn label={labels.hours} options={hourOptions} selected={selectedHour} onSelect={setHour} />
      <TimeColumn
        label={labels.minutes}
        options={minuteValues.map((m) => ({ value: m, label: twoDigits.format(m) }))}
        selected={time?.m ?? null}
        onSelect={setMinute}
      />
      {periodColumn && !localePeriods.leading && periodColumn}
    </div>
  );

  return (
    <>
      <PickerTrigger
        {...rest}
        ref={mergeRefs(triggerRef, ref)}
        className={cx('ui-time-picker', className)}
        icon={<ClockIcon />}
        placeholder={placeholder}
        hasValue={!!time}
        open={open || inline}
        size={size}
        invalid={invalid || missing}
        disabled={disabled}
        // Inline, the field opens nothing: it labels the columns under it and hands them the focus.
        {...(inline ? { 'aria-haspopup': undefined, 'aria-expanded': undefined } : {})}
        aria-controls={popoverOpen || inline ? dialogId : undefined}
        onClick={composeHandlers(onClick, () => (inline ? focusColumns() : setOpen((o) => !o)))}
        onKeyDown={composeHandlers(onKeyDown, (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (inline) focusColumns();
            else setOpen(true);
          }
        })}
      >
        {time && formatTime(time, hourCycle, locale, periods)}
      </PickerTrigger>
      <FormValue
        name={name}
        values={[toTimeValue(time)]}
        disabled={disabled}
        required={required}
        onMissing={(focus) => {
          markMissing();
          if (focus) triggerRef.current?.focus();
        }}
      />
      {inline ? (
        <div id={dialogId} role="group" aria-label={labels.dialog} className="ui-floating ui-time-picker__popover" data-inline="">
          {panel}
        </div>
      ) : (
        <Floating
          open={open}
          anchorRef={triggerRef}
          placement="bottom-start"
          onDismiss={(reason: DismissReason) => close(reason === 'escape')}
          id={dialogId}
          role="dialog"
          aria-label={labels.dialog}
          className="ui-time-picker__popover"
        >
          {panel}
        </Floating>
      )}
    </>
  );
});

interface TimeColumnProps {
  label: string;
  options: { value: number; label: string }[];
  selected: number | null;
  onSelect: (value: number) => void;
}

/** One scrollable listbox. Selection follows the keyboard, like a spinning wheel. */
function TimeColumn({ label, options, selected, onSelect }: TimeColumnProps) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const index = options.findIndex((o) => o.value === selected);

  // The selected option scrolls to the middle row, so hours, minutes and period line up across columns.
  useLayoutEffect(() => {
    const list = listRef.current;
    const first = list?.firstElementChild;
    const option = index >= 0 ? list?.children[index] : null;
    if (!list || !(first instanceof HTMLElement) || !(option instanceof HTMLElement)) return;
    // Jump on open, glide afterwards (unless motion is reduced).
    list.scrollTo({ top: option.offsetTop - first.offsetTop, behavior: scrolled.current && !isMotionReduced(list) ? 'smooth' : 'auto' });
    scrolled.current = true;
  }, [index]);

  const onKeyDown = (event: KeyboardEvent) => {
    const last = options.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = index < 0 ? 0 : index === last ? 0 : index + 1;
        break;
      case 'ArrowUp':
        next = index <= 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    onSelect(options[next].value);
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={index >= 0 ? `${id}-${index}` : undefined}
      className="ui-time-picker__column"
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => (
        <div
          key={option.value}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === index}
          data-selected={i === index || undefined}
          className="ui-time-picker__option"
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </div>
      ))}
    </div>
  );
}
