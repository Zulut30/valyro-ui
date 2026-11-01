'use client';

import { createContext, useContext, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { cx, isSameMonth, mergeRefs, type WeekStart } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { IconButton } from '../basic/IconButton';
import { useCalendar, type CalendarDayState, type CalendarLabels, type CalendarOptions, type CalendarState, type DateRange } from './useCalendar';
import './Calendar.css';
import { withRef, useLayoutEffect } from '../primitives/react-compat';

export { DEFAULT_CALENDAR_LABELS, type CalendarLabels, type CalendarDayState, type DateRange } from './useCalendar';

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
  /**
   * The parts of each month, in your order and with your content between them: `Calendar.Header` (with
   * `Calendar.Previous`, `Calendar.Caption`, `Calendar.Next`) and `Calendar.Grid`. Default: a header and a grid.
   */
  children?: ReactNode;
}

export interface CalendarSingleProps extends CalendarCommonProps {
  /** `single`: one date (default). `range`: a start and an end, with a live preview of the band. */
  mode?: 'single';
  value?: Date | null;
  defaultValue?: Date | null;
  onValueChange?: (value: Date | null) => void;
}

export interface CalendarRangeProps extends CalendarCommonProps {
  /** `single`: one date (default). `range`: a start and an end, with a live preview of the band. */
  mode: 'range';
  value?: DateRange;
  defaultValue?: DateRange;
  onValueChange?: (value: DateRange) => void;
}

export type CalendarProps = CalendarSingleProps | CalendarRangeProps;

/* ── Parts: rendered once per visible month, inside it ── */

interface MonthContextValue {
  calendar: CalendarState;
  /** Index of the month among the visible ones. */
  index: number;
  month: Date;
  count: number;
  /** Side-by-side months wrapped into a column: the arrows move to the first month's header. */
  stacked: boolean;
  weekCount: number;
}

const MonthContext = createContext<MonthContextValue | null>(null);

function useMonth(part: string) {
  const month = useContext(MonthContext);
  if (!month) throw new Error(`${part} must be rendered inside a <Calendar>.`);
  return month;
}

export interface CalendarHeaderProps extends ComponentPropsWithRef<'div'> {
  /** Default: `Calendar.Previous`, `Calendar.Caption` and `Calendar.Next`. */
  children?: ReactNode;
}

/** A month's header row. */
export const CalendarHeader = withRef(function CalendarHeader({ className, children, ref, ...rest }: CalendarHeaderProps) {
  useMonth('Calendar.Header');
  return (
    <div {...rest} ref={ref} className={cx('ui-calendar__header', className)}>
      {children ?? (
        <>
          <CalendarPrevious />
          <CalendarCaption />
          <CalendarNext />
        </>
      )}
    </div>
  );
});

export interface CalendarNavProps {
  /** Default: a chevron. */
  icon?: ReactNode;
  className?: string;
}

/** The previous-month button, on the first month (a spacer on the others). */
export function CalendarPrevious({ icon, className }: CalendarNavProps) {
  const { calendar, index } = useMonth('Calendar.Previous');
  if (index !== 0) return <span className="ui-calendar__nav-spacer" />;
  const { 'aria-label': label = '', type: _type, ...props } = calendar.getPreviousProps();
  return <IconButton size="sm" label={label} icon={icon ?? <ChevronLeftIcon />} className={cx('ui-calendar__nav', className)} {...props} />;
}

/** The next-month button, on the last month (the first one while the months are stacked; a spacer on the others). */
export function CalendarNext({ icon, className }: CalendarNavProps) {
  const { calendar, index, count, stacked } = useMonth('Calendar.Next');
  if (index !== (stacked ? 0 : count - 1)) return <span className="ui-calendar__nav-spacer" />;
  const { 'aria-label': label = '', type: _type, ...props } = calendar.getNextProps();
  return <IconButton size="sm" label={label} icon={icon ?? <ChevronRightIcon />} className={cx('ui-calendar__nav', className)} {...props} />;
}

export interface CalendarCaptionProps {
  className?: string;
}

/** The month and year, which names the grid. */
export function CalendarCaption({ className }: CalendarCaptionProps) {
  const { calendar, index, month } = useMonth('Calendar.Caption');
  return (
    <div className={cx('ui-calendar__caption', className)} {...calendar.getCaptionProps(index)}>
      <bdi>{calendar.formatCaption(month)}</bdi>
    </div>
  );
}

export interface CalendarGridProps extends Omit<ComponentPropsWithRef<'table'>, 'children'> {
  /** Content of each day's button (a price, an event dot). Default: the day number in the locale's digits. */
  renderDay?: (date: Date, state: CalendarDayState) => ReactNode;
}

/** The month's day grid. */
export const CalendarGrid = withRef(function CalendarGrid({ renderDay, className, ref, ...rest }: CalendarGridProps) {
  const { calendar, index, month, count, weekCount } = useMonth('Calendar.Grid');
  return (
    <table className={cx('ui-calendar__grid', className)} {...calendar.getGridProps(index, { ...rest, ref })}>
      <thead>
        <tr>
          {calendar.weekdays.map((name, i) => (
            <th key={i} className="ui-calendar__weekday" {...calendar.getWeekdayProps(i)}>
              {name.short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {calendar.getWeeks(month, weekCount).map((week, w) => (
          <tr key={w}>
            {week.map((date) =>
              // Adjacent months already show these days; repeating them would duplicate tab stops.
              count > 1 && !isSameMonth(date, month) ? (
                <td key={date.getTime()} className="ui-calendar__cell" data-empty="" />
              ) : (
                <td key={date.getTime()} className="ui-calendar__cell" {...calendar.getCellProps(date, month)}>
                  <button className="ui-calendar__day" {...calendar.getDayProps(date, month)}>
                    {renderDay ? renderDay(date, calendar.getDayState(date, month)) : calendar.formatDay(date)}
                  </button>
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

const DEFAULT_PARTS = (
  <>
    <CalendarHeader />
    <CalendarGrid />
  </>
);

/* ── Calendar ── */

export const Calendar = withRef(function Calendar(props: CalendarProps) {
  // One date and a range are two calendars: switching starts over.
  return <CalendarRoot key={props.mode === 'range' ? 'range' : 'single'} {...props} />;
}, { Header: CalendarHeader, Previous: CalendarPrevious, Caption: CalendarCaption, Next: CalendarNext, Grid: CalendarGrid });

const CalendarRoot = withRef(function CalendarRoot({
  mode,
  value,
  defaultValue,
  onValueChange,
  locale: localeProp,
  weekStartsOn,
  minDate,
  maxDate,
  isDateDisabled,
  month,
  defaultMonth,
  onMonthChange,
  numberOfMonths = 1,
  autoFocus,
  labels,
  className,
  children,
  ref,
  ...rest
}: CalendarProps) {
  const locale = useLocale(localeProp);
  // The value, the months, the tab stop, the keys and the page turn come from the headless hook.
  const calendar = useCalendar({
    mode,
    value,
    defaultValue,
    onValueChange,
    locale,
    weekStartsOn,
    minDate,
    maxDate,
    isDateDisabled,
    month,
    defaultMonth,
    onMonthChange,
    numberOfMonths,
    autoFocus,
    labels,
  } as CalendarOptions);
  const rootRef = useRef<HTMLDivElement>(null);

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

  // One month keeps a steady 6-week grid. Side by side, months share the row count the longest one needs;
  // stacked, each month shows only its own weeks.
  const sharedWeeks = Math.max(...calendar.months.map((m) => calendar.getWeekCount(m)));
  const weekCount = (displayMonth: Date) => (numberOfMonths === 1 ? 6 : stacked ? calendar.getWeekCount(displayMonth) : sharedWeeks);

  return (
    <div
      {...rest}
      {...calendar.getRootProps({ ref: mergeRefs(rootRef, ref) })}
      className={cx('ui-calendar', className)}
      data-months={numberOfMonths}
      data-stacked={stacked || undefined}
    >
      {calendar.months.map((displayMonth, index) => (
        <div className="ui-calendar__month" key={index}>
          <MonthContext.Provider
            value={{ calendar, index, month: displayMonth, count: numberOfMonths, stacked, weekCount: weekCount(displayMonth) }}
          >
            {children ?? DEFAULT_PARTS}
          </MonthContext.Provider>
        </div>
      ))}
    </div>
  );
});
