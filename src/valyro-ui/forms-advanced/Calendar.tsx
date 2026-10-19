'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import {
  addDays,
  addMonths,
  animateSpring,
  cx,
  getDirection,
  getMonthGrid,
  inlineArrowStep,
  getWeekdayNames,
  isSameDay,
  isSameMonth,
  isWithinRange,
  mergeRefs,
  startOfDay,
  startOfMonth,
  startOfWeek,
  useControllableState,
  type WeekStart,
} from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { IconButton } from '../basic/IconButton';
import './Calendar.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface CalendarLabels {
  previousMonth: string;
  nextMonth: string;
}

export const DEFAULT_CALENDAR_LABELS: CalendarLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
};

interface CalendarCommonProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange'> {
  locale?: string;
  weekStartsOn?: WeekStart;
  minDate?: Date;
  maxDate?: Date;
  isDateDisabled?: (date: Date) => boolean;
  /** First visible month (controlled). */
  month?: Date;
  defaultMonth?: Date;
  onMonthChange?: (month: Date) => void;
  /** Months shown side by side. */
  numberOfMonths?: number;
  /** Focus the active day on mount — used when the calendar opens in a popover. */
  autoFocus?: boolean;
  /** Accessible names of the month buttons. */
  labels?: Partial<CalendarLabels>;
}

export interface CalendarSingleProps extends CalendarCommonProps {
  mode?: 'single';
  value?: Date | null;
  defaultValue?: Date | null;
  onValueChange?: (value: Date | null) => void;
}

export interface CalendarRangeProps extends CalendarCommonProps {
  mode: 'range';
  value?: DateRange;
  defaultValue?: DateRange;
  onValueChange?: (value: DateRange) => void;
}

export type CalendarProps = CalendarSingleProps | CalendarRangeProps;

export const Calendar = withRef(function Calendar(props: CalendarProps) {
  return props.mode === 'range' ? <RangeCalendar {...props} /> : <SingleCalendar {...props} />;
});

const SingleCalendar = withRef(function SingleCalendar({ mode: _mode, value, defaultValue = null, onValueChange, ...rest }: CalendarSingleProps) {
  const [selected, setSelected] = useControllableState({ value, defaultValue, onChange: onValueChange });
  return (
    <CalendarView
      {...rest}
      data-mode="single"
      anchor={selected}
      getMarks={(date) => (isSameDay(date, selected) ? SELECTED : NONE)}
      onSelectDate={setSelected}
    />
  );
});

const EMPTY_RANGE: DateRange = { start: null, end: null };
const dayTime = (date: Date) => startOfDay(date).getTime();

const RangeCalendar = withRef(function RangeCalendar({ mode: _mode, value, defaultValue = EMPTY_RANGE, onValueChange, ...rest }: CalendarRangeProps) {
  const [range, setRange] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [hovered, setHovered] = useState<Date | null>(null);
  const picking = range.start !== null && range.end === null;

  // While the end is still open, the hovered (or keyboard-focused) day previews it.
  const from = range.start;
  const to = range.end ?? (picking ? hovered : null);
  const [lo, hi] = from && to && dayTime(to) < dayTime(from) ? [to, from] : [from, to];

  const getMarks = (date: Date): DayMarks => {
    if (!lo) return NONE;
    const isStart = isSameDay(date, lo);
    const isEnd = hi ? isSameDay(date, hi) : isStart;
    return {
      selected: isSameDay(date, range.start) || isSameDay(date, range.end),
      rangeStart: isStart && !!hi && !isEnd,
      rangeEnd: isEnd && !isStart,
      inRange: !!hi && isWithinRange(date, lo, hi),
      preview: range.end === null,
    };
  };

  const onSelectDate = (date: Date) => {
    if (!picking || !range.start) {
      setRange({ start: date, end: null });
    } else {
      const start = range.start;
      setRange(dayTime(date) < dayTime(start) ? { start: date, end: start } : { start, end: date });
    }
  };

  return (
    <CalendarView
      {...rest}
      data-mode="range"
      anchor={range.start}
      getMarks={getMarks}
      onSelectDate={onSelectDate}
      onHoverDate={setHovered}
    />
  );
});

interface DayMarks {
  selected?: boolean;
  rangeStart?: boolean;
  rangeEnd?: boolean;
  inRange?: boolean;
  /** The range end is not chosen yet; the band follows the pointer. */
  preview?: boolean;
}

const NONE: DayMarks = {};
const SELECTED: DayMarks = { selected: true };

interface CalendarViewProps extends CalendarCommonProps {
  /** Date the keyboard cursor starts on (selected date or range start). */
  anchor: Date | null;
  getMarks: (date: Date) => DayMarks;
  onSelectDate: (date: Date) => void;
  onHoverDate?: (date: Date | null) => void;
  'data-mode': 'single' | 'range';
}

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

const daysInMonth = (month: Date) => new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

/** Weeks of the 6-week grid that hold a day of `month` (always the first ones). */
const weeksIn = (month: Date, weekStartsOn: WeekStart) =>
  Math.ceil((getMonthGrid(month, weekStartsOn).findIndex((date) => isSameMonth(date, month)) + daysInMonth(month)) / 7);

/** Month and year, without the year marker some locales append ("октябрь 2026 г." → "октябрь 2026"). */
function useMonthCaption(locale: string | undefined) {
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    return (date: Date) => {
      const parts = format.formatToParts(date);
      const last = parts.length - 1;
      if (last > 0 && parts[last].type === 'literal' && parts[last - 1].type === 'year') parts.pop();
      return parts.map((part) => part.value).join('');
    };
  }, [locale]);
}

const CalendarView = withRef(function CalendarView({
  locale: localeProp,
  weekStartsOn = 1,
  minDate,
  maxDate,
  isDateDisabled,
  month: monthProp,
  defaultMonth,
  onMonthChange,
  numberOfMonths = 1,
  autoFocus = false,
  labels: labelsProp,
  anchor,
  getMarks,
  onSelectDate,
  onHoverDate,
  className,
  ref,
  ...rest
}: CalendarViewProps) {
  const id = useId();
  const locale = useLocale(localeProp);
  const labels = { ...DEFAULT_CALENDAR_LABELS, ...labelsProp };
  const rootRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const today = startOfDay(new Date());

  const min = minDate ? startOfDay(minDate) : null;
  const max = maxDate ? startOfDay(maxDate) : null;
  const clampDate = (date: Date) => {
    if (min && date < min) return min;
    if (max && date > max) return max;
    return date;
  };
  const isDisabled = (date: Date) =>
    (min !== null && date < min) || (max !== null && date > max) || !!isDateDisabled?.(date);

  const [month, setMonth] = useControllableState({
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
  const active = isVisible(focused)
    ? focused
    : anchor && isVisible(anchor)
      ? startOfDay(anchor)
      : clampDate(firstMonth);

  const goToMonth = (date: Date) => {
    const next = startOfMonth(date);
    if (!isSameMonth(next, firstMonth)) setMonth(next);
  };

  const moveFocus = (date: Date, focus: boolean) => {
    const next = clampDate(date);
    setFocused(next);
    focusPending.current = focus;
    onHoverDate?.(next);
    const offset = monthIndex(next) - monthIndex(firstMonth);
    if (offset < 0) goToMonth(next);
    else if (offset >= numberOfMonths) goToMonth(addMonths(next, -(numberOfMonths - 1)));
  };

  const focusActiveDay = () =>
    rootRef.current?.querySelector<HTMLElement>('.ui-calendar__day[tabindex="0"]')?.focus({ preventScroll: true });

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

  const onGridKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
    moveFocus(next, true);
  };

  const shiftMonth = (delta: number) => {
    goToMonth(addMonths(firstMonth, delta));
    setFocused(clampDate(addMonths(active, delta)));
  };

  const dayLabel = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'full' }), [locale]);
  // Plain numbers in the locale's digits ("١٢" in ar-EG); `day: 'numeric'` would add suffixes like "12日".
  const dayNumber = useMemo(() => new Intl.NumberFormat(locale, { useGrouping: false }), [locale]);
  const weekdays = useMemo(() => getWeekdayNames(locale, weekStartsOn), [locale, weekStartsOn]);
  const weekdayLong = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'long' });
    const first = startOfWeek(new Date(2024, 0, 10), weekStartsOn);
    return Array.from({ length: 7 }, (_, i) => fmt.format(addDays(first, i)));
  }, [locale, weekStartsOn]);

  const lastMonth = addMonths(firstMonth, numberOfMonths - 1);
  const prevDisabled = min !== null && monthIndex(addMonths(firstMonth, -1)) < monthIndex(min);
  const nextDisabled = max !== null && monthIndex(addMonths(lastMonth, 1)) > monthIndex(max);
  const monthCaption = useMonthCaption(locale);

  // Side-by-side months wrap into a column when the container is narrow: then both arrows move to the
  // first month's header, and each month keeps only its own weeks (no blank row between the months).
  const [wrapped, setWrapped] = useState(false);
  const stacked = wrapped && numberOfMonths > 1;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || numberOfMonths < 2 || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const months = root.querySelectorAll<HTMLElement>(':scope > .ui-calendar__month');
      setWrapped(months.length > 1 && months[months.length - 1].offsetTop > months[0].offsetTop);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [numberOfMonths]);

  // A new month slides in from the side it comes from and fades in, like turning a page (the caption
  // fades with it). Not on the first render; under reduced motion the theme's 1 ms tempo makes it instant.
  const firstIndex = monthIndex(firstMonth);
  const shownMonth = useRef(firstIndex);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const delta = firstIndex - shownMonth.current;
    shownMonth.current = firstIndex;
    if (!root || delta === 0) return;
    const shift = Math.sign(delta) * (getDirection(root) === 'rtl' ? -1 : 1) * 16;
    for (const grid of root.querySelectorAll<HTMLElement>('.ui-calendar__grid')) {
      for (const running of grid.getAnimations()) running.cancel();
      animateSpring(grid, [{ opacity: 0, transform: `translateX(${shift}px)` }, { opacity: 1, transform: 'none' }], 'smooth');
    }
    for (const caption of root.querySelectorAll<HTMLElement>('.ui-calendar__caption')) {
      animateSpring(caption, [{ opacity: 0 }, { opacity: 1 }], 'smooth');
    }
  }, [firstIndex]);

  // One month keeps a steady 6-week grid. Side by side, months share the row count the longest one needs;
  // stacked, each month shows only its own weeks.
  const visibleMonths = Array.from({ length: numberOfMonths }, (_, index) => addMonths(firstMonth, index));
  const sharedWeeks = Math.max(...visibleMonths.map((m) => weeksIn(m, weekStartsOn)));
  const weekCount = (displayMonth: Date) =>
    numberOfMonths === 1 ? 6 : stacked ? weeksIn(displayMonth, weekStartsOn) : sharedWeeks;

  return (
    <div
      {...rest}
      ref={mergeRefs(rootRef, ref)}
      className={cx('ui-calendar', className)}
      data-months={numberOfMonths}
      data-stacked={stacked || undefined}
      onPointerLeave={() => onHoverDate?.(null)}
    >
      {visibleMonths.map((displayMonth, index) => {
        const captionId = `${id}-caption-${index}`;
        const days = getMonthGrid(displayMonth, weekStartsOn);
        const weeks = Array.from({ length: weekCount(displayMonth) }, (_, w) => days.slice(w * 7, w * 7 + 7));
        const showNext = stacked ? index === 0 : index === numberOfMonths - 1;
        return (
          <div className="ui-calendar__month" key={index}>
            <div className="ui-calendar__header">
              {index === 0 ? (
                <IconButton
                  size="sm"
                  label={labels.previousMonth}
                  icon={<ChevronLeftIcon />}
                  className="ui-calendar__nav"
                  disabled={prevDisabled}
                  onClick={() => shiftMonth(-1)}
                />
              ) : (
                <span className="ui-calendar__nav-spacer" />
              )}
              <div className="ui-calendar__caption" id={captionId} aria-live="polite">
                <bdi>{monthCaption(displayMonth)}</bdi>
              </div>
              {showNext ? (
                <IconButton
                  size="sm"
                  label={labels.nextMonth}
                  icon={<ChevronRightIcon />}
                  className="ui-calendar__nav"
                  disabled={nextDisabled}
                  onClick={() => shiftMonth(1)}
                />
              ) : (
                <span className="ui-calendar__nav-spacer" />
              )}
            </div>
            <table className="ui-calendar__grid" role="grid" aria-labelledby={captionId} onKeyDown={onGridKeyDown}>
              <thead>
                <tr>
                  {weekdays.map((name, i) => (
                    <th key={i} scope="col" abbr={weekdayLong[i]} className="ui-calendar__weekday">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, w) => (
                  <tr key={w}>
                    {week.map((date) => {
                      const outside = !isSameMonth(date, displayMonth);
                      // Adjacent months already show these days; repeating them would duplicate tab stops.
                      if (outside && numberOfMonths > 1) {
                        return <td key={date.getTime()} className="ui-calendar__cell" data-empty="" />;
                      }
                      const marks = getMarks(date);
                      const disabled = isDisabled(date);
                      const isToday = isSameDay(date, today);
                      return (
                        <td
                          key={date.getTime()}
                          role="gridcell"
                          className="ui-calendar__cell"
                          aria-selected={!!(marks.selected || (marks.inRange && !marks.preview))}
                          data-in-range={marks.inRange || undefined}
                          data-range-start={marks.rangeStart || undefined}
                          data-range-end={marks.rangeEnd || undefined}
                          data-preview={(marks.inRange && marks.preview) || undefined}
                        >
                          <button
                            type="button"
                            className="ui-calendar__day"
                            tabIndex={isSameDay(date, active) ? 0 : -1}
                            aria-label={dayLabel.format(date)}
                            aria-disabled={disabled || undefined}
                            aria-current={isToday ? 'date' : undefined}
                            data-today={isToday || undefined}
                            data-selected={marks.selected || undefined}
                            data-outside={outside || undefined}
                            data-disabled={disabled || undefined}
                            onPointerEnter={() => onHoverDate?.(date)}
                            onClick={() => {
                              // A click already focuses the day; forcing focus here would pull it
                              // back from a trigger that a closing picker just focused.
                              moveFocus(date, false);
                              if (!disabled) onSelectDate(date);
                            }}
                          >
                            {dayNumber.format(date.getDate())}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
});
