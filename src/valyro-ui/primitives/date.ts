/**
 * Small date helpers shared by pickers and calendars. All work in local time, on the Gregorian calendar the grids
 * are built on: text is formatted with `calendar: 'gregory'`, so a Persian or Thai locale names the same month the
 * grid shows (its own digits and month names stay).
 */

/** First day of the week: 0 = Sunday, 1 = Monday … 6 = Saturday. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Options for every date text a calendar or picker prints. */
export const GREGORIAN: Intl.DateTimeFormatOptions = { calendar: 'gregory' };

// CLDR week data for browsers without Intl.Locale#getWeekInfo (Firefox, older Safari): regions that start the week
// on a day other than Sunday. Everything else starts on Sunday.
const MONDAY_REGIONS =
  '001 AD AI AL AM AN AR AT AU AX AZ BA BE BG BM BN BY CH CL CM CN CR CY CZ DE DK EC EE ES FI FJ FO FR GB GE GF GP GR HR HU IE IS IT KG KZ LB LI LK LT LU LV MC MD ME MK MN MQ MY NL NO NZ PL RE RO RS RU SE SI SK SM TJ TM TR UA UY UZ VA VN XK';
const SATURDAY_REGIONS = 'AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY';
const FRIDAY_REGIONS = 'MV';
const FW_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };

/** Week start of a region (ISO 3166 code or "001"), from the CLDR table. */
export function regionWeekStart(region: string | undefined): WeekStart {
  if (!region) return 1;
  if (MONDAY_REGIONS.split(' ').includes(region)) return 1;
  if (SATURDAY_REGIONS.split(' ').includes(region)) return 6;
  if (FRIDAY_REGIONS.split(' ').includes(region)) return 5;
  return 0;
}

/**
 * First day of the week for `locale` (default: the browser's), as Intl.Locale#getWeekInfo reports it, else from the
 * CLDR table by the locale's region (`en` counts as `en-US`). A `-u-fw-` extension ("en-GB-u-fw-sun") wins.
 */
export function getWeekStart(locale?: string): WeekStart {
  const tag = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;
  const fw = /-u(?:-[a-z0-9]{2,8})*?-fw-([a-z]{3})/i.exec(tag)?.[1]?.toLowerCase();
  if (fw && FW_DAYS.includes(fw)) return FW_DAYS.indexOf(fw) as WeekStart;
  if (typeof Intl.Locale !== 'function') return regionWeekStart(/[-_]([A-Z]{2}|\d{3})(?:[-_]|$)/.exec(tag)?.[1]);
  try {
    const intl = new Intl.Locale(tag) as LocaleWithWeek;
    const info = typeof intl.getWeekInfo === 'function' ? intl.getWeekInfo() : intl.weekInfo;
    // getWeekInfo counts 1 = Monday … 7 = Sunday.
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return (info.firstDay % 7) as WeekStart;
    return regionWeekStart(intl.region ?? intl.maximize().region);
  } catch {
    return 1;
  }
}

/** 12 or 24: the clock `locale` (default: the browser's) writes times with. */
export function getHourCycle(locale?: string): 12 | 24 {
  try {
    const options = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
    if (options.hourCycle) return options.hourCycle === 'h11' || options.hourCycle === 'h12' ? 12 : 24;
    return options.hour12 ? 12 : 24;
  } catch {
    return 24;
  }
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Adds months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

export function isSameDay(a: Date | null | undefined, b: Date | null | undefined) {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Inclusive day-level range check; order of `start`/`end` does not matter. */
export function isWithinRange(date: Date, start: Date, end: Date) {
  const t = startOfDay(date).getTime();
  const a = startOfDay(start).getTime();
  const b = startOfDay(end).getTime();
  return t >= Math.min(a, b) && t <= Math.max(a, b);
}

export function startOfWeek(date: Date, weekStartsOn: WeekStart = 1) {
  const diff = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(startOfDay(date), -diff);
}

/** 6×7 grid of days covering `month`, starting on `weekStartsOn`. */
export function getMonthGrid(month: Date, weekStartsOn: WeekStart = 1): Date[] {
  const first = startOfWeek(startOfMonth(month), weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** Localised short weekday names in grid order. */
export function getWeekdayNames(locale?: string, weekStartsOn: WeekStart = 1, format: 'narrow' | 'short' = 'short') {
  const fmt = new Intl.DateTimeFormat(locale, { ...GREGORIAN, weekday: format });
  // 2024-01-07 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + weekStartsOn + i)));
}

/** Month and year for a heading, without a trailing era marker: «октябрь 2026», not «октябрь 2026 г.». */
export function formatMonth(date: Date, locale?: string) {
  const parts = new Intl.DateTimeFormat(locale, { ...GREGORIAN, month: 'long', year: 'numeric' }).formatToParts(date);
  let end = parts.length;
  while (end > 0 && parts[end - 1].type === 'literal') end--;
  // Only a marker after the year goes («2026 г.»); a trailing month suffix stays («2026年10月»).
  if (parts[end - 1]?.type !== 'year') end = parts.length;
  return parts
    .slice(0, end)
    .map((part) => part.value)
    .join('');
}

export function formatDate(date: Date, locale?: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat(locale, { ...GREGORIAN, ...options }).format(date);
}
