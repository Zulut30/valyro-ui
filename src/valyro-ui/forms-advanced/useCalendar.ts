'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import {
  addDays,
  addMonths,
  getMonthGrid,
  getWeekStart,
  getWeekdayNames,
  GREGORIAN,
  isSameDay,
  isSameMonth,
  isWithinRange,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type WeekStart,
} from '../primitives/date';
import { announce } from '../primitives/liveAnnouncer';
import { useControllableState } from '../primitives/useControllableState';
import { getDirection, inlineArrowStep } from '../primitives/utils';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { useId, useLayoutEffect } from '../primitives/react-compat';

/*
 * The behaviour of Calendar without its markup: one date or a range (controlled or not), the shown months
 * (controlled or not, side by side with `numberOfMonths`), the week starting on the locale's first day (Monday in
 * most of Europe, Sunday in the US, Saturday in much of the Middle East), min / max / disabled days, and the grid
 * keys of the WAI-ARIA date picker: arrows (mirrored under dir="rtl"), PageUp / PageDown (+ Shift: a year), Home /
 * End of the week, with a roving tab stop that turns the month when it leaves it. In a range the hovered or
 * focused day previews the end, and both picks are read out, as in React Aria. A new month sets `data-turn`
 * ("next" / "previous", restarted by `data-turn-again`) on the root, for a CSS page turn. Calendar renders with it.
 */

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface CalendarLabels {
  previousMonth: string;
  nextMonth: string;
  /** Read to screen readers when the first day of a range is picked (`date` is formatted for the locale). */
  rangeStarted?: (date: string) => string;
  /** Read to screen readers when a range is complete, e.g. "Selected range: 3 – 9 October 2026". */
  rangeSelected?: (range: string) => string;
}

export const DEFAULT_CALENDAR_LABELS: CalendarLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  rangeStarted: (date) => `${date} selected. Choose the last day of the range.`,
  rangeSelected: (range) => `Selected range: ${range}`,
};

interface CalendarCommonOptions {
  /** Locale of the names, the digits and the first weekday. Default: the browser's. */
  locale?: string;
  /** First day of the week, 0 = Sunday. Default: the locale's. */
  weekStartsOn?: WeekStart;
  minDate?: Date;
  maxDate?: Date;
  isDateDisabled?: (date: Date) => boolean;
  /** First visible month. */
  month?: Date;
  defaultMonth?: Date;
  onMonthChange?: (month: Date) => void;
  /** Months shown side by side. Default 1. */
  numberOfMonths?: number;
  /** Focus the tab-stop day after mount (a frame later: a popover is still hidden while it is first placed). */
  autoFocus?: boolean;
  /** The month buttons' names and, in a range, what is read out. */
  labels?: Partial<CalendarLabels>;
}

export interface CalendarSingleOptions extends CalendarCommonOptions {
  mode?: 'single';
  value?: Date | null;
  defaultValue?: Date | null;
  onValueChange?: (value: Date | null) => void;
}

export interface CalendarRangeOptions extends CalendarCommonOptions {
  mode: 'range';
  value?: DateRange;
  defaultValue?: DateRange;
  onValueChange?: (value: DateRange) => void;
}

export type CalendarOptions = CalendarSingleOptions | CalendarRangeOptions;

/** What a day is, for its look: getDayProps puts the same on the button as data attributes. */
export interface CalendarDayState {
  selected: boolean;
  /** Inside the range (its ends included). */
  inRange: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
  /** The range end is not chosen yet: the band follows the pointer or the focus. */
  preview: boolean;
  disabled: boolean;
  today: boolean;
  /** A day of the month before or after the one it is shown in. */
  outside: boolean;
  /** The tab stop of the grid. */
  focused: boolean;
}

export interface CalendarState {
  mode: 'single' | 'range';
  /** The selected date (single), or the range. */
  value: Date | null | DateRange;
  /** The visible months, first to last (each the 1st of its month). */
  months: Date[];
  /** The day that holds the tab stop. */
  focusedDate: Date;
  weekStartsOn: WeekStart;
  /** Weekday names in the grid's column order. */
  weekdays: { short: string; long: string }[];
  /** Shows the month of `date` first. */
  setMonth: (date: Date) => void;
  /** Turns `delta` months, moving the tab stop along. */
  shiftMonth: (delta: number) => void;
  /** Picks a day: the date, or a range's start and then its end. Ignored on a disabled day. */
  select: (date: Date) => void;
  /** Moves the tab stop (and, with `focus`, DOM focus) to a day, turning the month when needed. */
  focusDate: (date: Date, focus?: boolean) => void;
  isDisabled: (date: Date) => boolean;
  getDayState: (date: Date, month: Date) => CalendarDayState;
  /** The weeks of a month's grid (6 by default; fewer drop the trailing weeks), each 7 days from weekStartsOn. */
  getWeeks: (month: Date, count?: number) => Date[][];
  /** How many weeks hold a day of the month. */
  getWeekCount: (month: Date) => number;
  /** Month and year, e.g. "October 2026". */
  formatCaption: (month: Date) => string;
  /** The day number in the locale's digits. */
  formatDay: (date: Date) => string;
  /** The calendar's root: the page turn and, in a range, clearing the preview when the pointer leaves. */
  getRootProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The previous-month button (disabled before `minDate`'s month). */
  getPreviousProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** The next-month button (disabled after `maxDate`'s month). */
  getNextProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** A month's caption, which names its grid. `index` counts the visible months from 0. */
  getCaptionProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** A month's `<table role="grid">`: the keys. */
  getGridProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** A weekday column header (`<th>`), with the long name as `abbr`. */
  getWeekdayProps: (column: number, props?: UserProps) => ThHTMLAttributes<HTMLTableCellElement>;
  /** A day's `<td role="gridcell">`: aria-selected and the range band. */
  getCellProps: (date: Date, month: Date, props?: UserProps) => TdHTMLAttributes<HTMLTableCellElement>;
  /** A day's `<button>`: its full date as the name, the tab stop, today and the pick on click. */
  getDayProps: (date: Date, month: Date, props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
}

const EMPTY_RANGE: DateRange = { start: null, end: null };
const dayTime = (date: Date) => startOfDay(date).getTime();
const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
const daysInMonth = (month: Date) => new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
const isRange = (value: unknown): value is DateRange => !!value && typeof value === 'object' && !(value instanceof Date);

/** "3 – 9 October 2026" for `locale`, on the Gregorian calendar the grid shows. */
function formatDayRange(start: Date, end: Date, locale?: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }) {
  const format = new Intl.DateTimeFormat(locale, { ...GREGORIAN, ...options });
  return typeof format.formatRange === 'function' ? format.formatRange(start, end) : `${format.format(start)} – ${format.format(end)}`;
}

export function useCalendar(options: CalendarOptions): CalendarState {
  const {
    locale,
    weekStartsOn: weekStartsOnProp,
    minDate,
    maxDate,
    isDateDisabled,
    month: monthProp,
    defaultMonth,
    onMonthChange,
    numberOfMonths = 1,
    autoFocus = false,
    labels: labelsProp,
  } = options;
  const mode = options.mode === 'range' ? 'range' : 'single';
  const labels = { ...DEFAULT_CALENDAR_LABELS, ...labelsProp };
  const [rawValue, setValue] = useControllableState<Date | null | DateRange>({
    value: options.value,
    defaultValue: options.defaultValue ?? (mode === 'range' ? EMPTY_RANGE : null),
    onChange: options.onValueChange as ((value: Date | null | DateRange) => void) | undefined,
  });
  const range = mode === 'range' ? (isRange(rawValue) ? rawValue : EMPTY_RANGE) : undefined;
  const selected = mode === 'single' && rawValue instanceof Date ? rawValue : null;
  // Where the keyboard cursor starts: the selected date or the range start.
  const anchor = range ? range.start : selected;
  const [hovered, setHovered] = useState<Date | null>(null);

  const id = useId();
  // The locale's own first weekday (Sunday in the US, Monday in most of Europe, Saturday in much of the Middle East).
  const localeWeekStart = useMemo(() => getWeekStart(locale), [locale]);
  const weekStartsOn = weekStartsOnProp ?? localeWeekStart;
  const root = useRef<HTMLElement | null>(null);
  const [rootRef] = useState(() => (node: HTMLElement | null) => {
    root.current = node;
  });
  // The tab-stop day's button: the only day with a ref, so focus can find it after a render.
  const activeDay = useRef<HTMLElement | null>(null);
  const [activeDayRef] = useState(() => (node: HTMLElement | null) => {
    activeDay.current = node;
  });
  const focusPending = useRef(false);
  const today = startOfDay(new Date());

  const min = minDate ? startOfDay(minDate) : null;
  const max = maxDate ? startOfDay(maxDate) : null;
  const clampDate = (date: Date) => {
    if (min && date < min) return min;
    if (max && date > max) return max;
    return date;
  };
  const isDisabled = (date: Date) => (min !== null && date < min) || (max !== null && date > max) || !!isDateDisabled?.(date);

  const [month, setMonthState] = useControllableState({
    value: monthProp,
    defaultValue: startOfMonth(defaultMonth ?? anchor ?? clampDate(today)),
    onChange: onMonthChange,
  });
  const firstMonth = startOfMonth(month);
  const [focused, setFocused] = useState(() => startOfDay(anchor ?? clampDate(today)));

  const isVisible = (date: Date) => {
    const offset = monthIndex(date) - monthIndex(firstMonth);
    return offset >= 0 && offset < numberOfMonths;
  };
  // The roving tab stop must sit in a visible month even after the month was changed from outside.
  const active = isVisible(focused) ? focused : anchor && isVisible(anchor) ? startOfDay(anchor) : clampDate(firstMonth);

  const setMonth = (date: Date) => {
    const next = startOfMonth(date);
    if (!isSameMonth(next, firstMonth)) setMonthState(next);
  };

  const focusDate = (date: Date, focus = false) => {
    const next = clampDate(date);
    setFocused(next);
    focusPending.current = focus;
    if (range) setHovered(next);
    const offset = monthIndex(next) - monthIndex(firstMonth);
    if (offset < 0) setMonth(next);
    else if (offset >= numberOfMonths) setMonth(addMonths(next, -(numberOfMonths - 1)));
  };

  const focusActiveDay = () => activeDay.current?.focus({ preventScroll: true });
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    focusActiveDay();
  });
  useEffect(() => {
    if (!autoFocus) return;
    // Wait a frame: a popover is still hidden while its first position is computed.
    const frame = requestAnimationFrame(focusActiveDay);
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  // A new month turns in from the side it comes from: data-turn for CSS keyframes, restarted by its alternate.
  // Not on the first render.
  const firstIndex = monthIndex(firstMonth);
  const shownMonth = useRef(firstIndex);
  useLayoutEffect(() => {
    const node = root.current;
    const delta = firstIndex - shownMonth.current;
    shownMonth.current = firstIndex;
    if (!node || delta === 0) return;
    node.toggleAttribute('data-turn-again', node.hasAttribute('data-turn') && !node.hasAttribute('data-turn-again'));
    node.setAttribute('data-turn', delta > 0 ? 'next' : 'previous');
  }, [firstIndex]);

  const select = (date: Date) => {
    if (isDisabled(date)) return;
    if (!range) {
      setValue(date);
      return;
    }
    // The band and aria-selected only show the range; what was picked is also read out, as React Aria does.
    if (range.start === null || range.end !== null) {
      setValue({ start: date, end: null });
      const text = labels.rangeStarted?.(new Intl.DateTimeFormat(locale, { ...GREGORIAN, dateStyle: 'long' }).format(date));
      if (text) announce(text, 'polite', 4000);
    } else {
      const start = range.start;
      const next = dayTime(date) < dayTime(start) ? { start: date, end: start } : { start, end: date };
      setValue(next);
      const text = labels.rangeSelected?.(formatDayRange(next.start, next.end, locale));
      if (text) announce(text, 'polite', 4000);
    }
  };

  // While a range's end is still open, the hovered (or keyboard-focused) day previews it.
  const picking = !!range && range.start !== null && range.end === null;
  const from = range?.start ?? null;
  const to = range ? (range.end ?? (picking ? hovered : null)) : null;
  const [lo, hi] = from && to && dayTime(to) < dayTime(from) ? [to, from] : [from, to];

  const getDayState = (date: Date, displayMonth: Date): CalendarDayState => {
    const base = {
      disabled: isDisabled(date),
      today: isSameDay(date, today),
      outside: !isSameMonth(date, displayMonth),
      focused: isSameDay(date, active),
    };
    if (!range) return { ...base, selected: isSameDay(date, selected), inRange: false, rangeStart: false, rangeEnd: false, preview: false };
    if (!lo) return { ...base, selected: false, inRange: false, rangeStart: false, rangeEnd: false, preview: false };
    const isStart = isSameDay(date, lo);
    const isEnd = hi ? isSameDay(date, hi) : isStart;
    return {
      ...base,
      selected: isSameDay(date, range.start) || isSameDay(date, range.end),
      rangeStart: isStart && !!hi && !isEnd,
      rangeEnd: isEnd && !isStart,
      inRange: !!hi && isWithinRange(date, lo, hi),
      preview: range.end === null,
    };
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    let next: Date;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        // Weeks run right-to-left under dir="rtl", so the arrows follow the layout.
        next = addDays(active, inlineArrowStep(event.key, getDirection(event.currentTarget)));
        break;
      case 'ArrowUp':
        next = addDays(active, -7);
        break;
      case 'ArrowDown':
        next = addDays(active, 7);
        break;
      case 'PageUp':
        next = addMonths(active, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonths(active, event.shiftKey ? 12 : 1);
        break;
      case 'Home':
        next = startOfWeek(active, weekStartsOn);
        break;
      case 'End':
        next = addDays(startOfWeek(active, weekStartsOn), 6);
        break;
      default:
        return;
    }
    event.preventDefault();
    focusDate(next, true);
  };

  const shiftMonth = (delta: number) => {
    setMonth(addMonths(firstMonth, delta));
    setFocused(clampDate(addMonths(active, delta)));
  };

  const dayLabel = useMemo(() => new Intl.DateTimeFormat(locale, { ...GREGORIAN, dateStyle: 'full' }), [locale]);
  // Plain numbers in the locale's digits ("١٢" in ar-EG); `day: 'numeric'` would add suffixes like "12日".
  const dayNumber = useMemo(() => new Intl.NumberFormat(locale, { useGrouping: false }), [locale]);
  const weekdays = useMemo(() => {
    const short = getWeekdayNames(locale, weekStartsOn);
    const fmt = new Intl.DateTimeFormat(locale, { ...GREGORIAN, weekday: 'long' });
    const first = startOfWeek(new Date(2024, 0, 10), weekStartsOn);
    return short.map((name, i) => ({ short: name, long: fmt.format(addDays(first, i)) }));
  }, [locale, weekStartsOn]);
  // Month and year, without the year marker some locales append ("октябрь 2026 г." → "октябрь 2026").
  const formatCaption = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { ...GREGORIAN, month: 'long', year: 'numeric' });
    return (date: Date) => {
      const parts = format.formatToParts(date);
      const last = parts.length - 1;
      if (last > 0 && parts[last].type === 'literal' && parts[last - 1].type === 'year') parts.pop();
      return parts.map((part) => part.value).join('');
    };
  }, [locale]);

  const lastMonth = addMonths(firstMonth, numberOfMonths - 1);
  const prevDisabled = min !== null && monthIndex(addMonths(firstMonth, -1)) < monthIndex(min);
  const nextDisabled = max !== null && monthIndex(addMonths(lastMonth, 1)) > monthIndex(max);
  const captionId = (index: number) => `${id}-caption-${index}`;

  return {
    mode,
    value: range ?? selected,
    months: Array.from({ length: numberOfMonths }, (_, index) => addMonths(firstMonth, index)),
    focusedDate: active,
    weekStartsOn,
    weekdays,
    setMonth,
    shiftMonth,
    select,
    focusDate,
    isDisabled,
    getDayState,
    getWeeks: (displayMonth, count = 6) => {
      const days = getMonthGrid(displayMonth, weekStartsOn);
      return Array.from({ length: count }, (_, w) => days.slice(w * 7, w * 7 + 7));
    },
    getWeekCount: (displayMonth) =>
      Math.ceil((getMonthGrid(displayMonth, weekStartsOn).findIndex((date) => isSameMonth(date, displayMonth)) + daysInMonth(displayMonth)) / 7),
    formatCaption,
    formatDay: (date) => dayNumber.format(date.getDate()),
    getRootProps: (props) =>
      withUserProps({ ref: rootRef, 'data-mode': mode, onPointerLeave: range ? () => setHovered(null) : undefined }, props) as never,
    getPreviousProps: (props) =>
      withUserProps({ type: 'button', 'aria-label': labels.previousMonth, disabled: prevDisabled, onClick: () => shiftMonth(-1) }, props) as never,
    getNextProps: (props) =>
      withUserProps({ type: 'button', 'aria-label': labels.nextMonth, disabled: nextDisabled, onClick: () => shiftMonth(1) }, props) as never,
    getCaptionProps: (index, props) => withUserProps({ id: captionId(index), 'aria-live': 'polite' }, props) as never,
    getGridProps: (index, props) =>
      withUserProps(
        {
          role: 'grid',
          // A range selects every day from start to end.
          'aria-multiselectable': range ? true : undefined,
          'aria-labelledby': captionId(index),
          onKeyDown: onGridKeyDown,
        },
        props,
      ) as never,
    getWeekdayProps: (column, props) => withUserProps({ scope: 'col', abbr: weekdays[column]?.long }, props) as never,
    getCellProps: (date, displayMonth, props) => {
      const day = getDayState(date, displayMonth);
      return withUserProps(
        {
          role: 'gridcell',
          'aria-selected': day.selected || (day.inRange && !day.preview),
          'data-in-range': day.inRange || undefined,
          'data-range-start': day.rangeStart || undefined,
          'data-range-end': day.rangeEnd || undefined,
          'data-preview': (day.inRange && day.preview) || undefined,
        },
        props,
      ) as never;
    },
    getDayProps: (date, displayMonth, props) => {
      const day = getDayState(date, displayMonth);
      return withUserProps(
        {
          ref: day.focused ? activeDayRef : undefined,
          type: 'button',
          tabIndex: day.focused ? 0 : -1,
          'aria-label': dayLabel.format(date),
          'aria-disabled': day.disabled || undefined,
          'aria-current': day.today ? 'date' : undefined,
          'data-today': day.today || undefined,
          'data-selected': day.selected || undefined,
          'data-outside': day.outside || undefined,
          'data-disabled': day.disabled || undefined,
          onPointerEnter: range ? () => setHovered(date) : undefined,
          onClick: () => {
            // A click already focuses the day; forcing focus here would pull it back from a trigger that a
            // closing picker just focused.
            focusDate(date, false);
            select(date);
          },
        },
        props,
      ) as never;
    },
  };
}
