import { GREGORIAN } from '../primitives';

/*
 * Pure model of a segmented date or time field, as React Aria's DateField builds it: the segments and the text
 * between them come from `Intl.DateTimeFormat#formatToParts` for the locale ("дд.мм.гггг" in ru, "mm/dd/yyyy" in
 * en-US, "yyyy/mm/dd" in ja), each segment is edited on its own with digits or the arrow keys, and a value exists
 * only once every segment has one. Unit-tested in date-segments.test.ts.
 */

export type SegmentType = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'dayPeriod';

export type SegmentPart = { type: SegmentType } | { type: 'literal'; text: string };

/** Values per segment while editing; a missing key is an empty segment (its placeholder shows). */
export type SegmentValues = Partial<Record<SegmentType, number>>;

const DATE_TYPES = new Set(['year', 'month', 'day']);
const TIME_TYPES = new Set(['hour', 'minute', 'dayPeriod']);

// 23 November 2026, 09:05: every number distinct, so the order of the parts is unambiguous.
const SAMPLE = new Date(2026, 10, 23, 9, 5);

function layout(format: Intl.DateTimeFormat, keep: Set<string>): SegmentPart[] {
  const parts: SegmentPart[] = [];
  for (const part of format.formatToParts(SAMPLE)) {
    if (keep.has(part.type)) parts.push({ type: part.type as SegmentType });
    else if (part.type === 'literal') {
      const last = parts[parts.length - 1];
      if (last?.type === 'literal') last.text += part.value;
      else parts.push({ type: 'literal', text: part.value });
    }
  }
  // Text before the first segment or after the last one (a trailing " г.") is not a separator.
  while (parts[0]?.type === 'literal') parts.shift();
  while (parts[parts.length - 1]?.type === 'literal') parts.pop();
  return parts;
}

/** Day, month and year in the locale's order, with its separators. */
export function dateLayout(locale?: string): SegmentPart[] {
  return layout(new Intl.DateTimeFormat(locale, { ...GREGORIAN, year: 'numeric', month: '2-digit', day: '2-digit' }), DATE_TYPES);
}

/** Hour, minute and, on a 12-hour clock, the day period, in the locale's order ("午前9:05" puts it first). */
export function timeLayout(locale: string | undefined, hourCycle: 12 | 24): SegmentPart[] {
  return layout(
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: hourCycle === 12 ? 'h12' : 'h23' }),
    TIME_TYPES,
  );
}

export const daysInMonth = (year: number, month: number) => new Date(2000 + (year % 400), month, 0).getDate();

/** Range of a segment; the day depends on the month and year chosen so far (31 until they are). */
export function segmentRange(type: SegmentType, values: SegmentValues, hourCycle: 12 | 24 = 24): [number, number] {
  switch (type) {
    case 'year':
      return [1, 9999];
    case 'month':
      return [1, 12];
    case 'day':
      return [1, values.month ? daysInMonth(values.year ?? 2000, values.month) : 31];
    case 'hour':
      return hourCycle === 12 ? [1, 12] : [0, 23];
    case 'minute':
      return [0, 59];
    case 'dayPeriod':
      return [0, 1];
  }
}

/** Arrow-key step from `value` by `delta`, wrapping inside the range (the year stops at its ends). */
export function stepSegment(type: SegmentType, value: number, delta: number, [min, max]: [number, number]) {
  if (type === 'year') return Math.min(max, Math.max(min, value + delta));
  const span = max - min + 1;
  return ((((value + delta - min) % span) + span) % span) + min;
}

/** How far PageUp / PageDown move a segment (React Aria's steps). */
export const PAGE_STEP: Record<SegmentType, number> = { year: 5, month: 2, day: 7, hour: 2, minute: 15, dayPeriod: 1 };

/**
 * One typed digit: `buffer` holds the digits typed into the segment so far. A digit that would overflow starts over
 * ("3" then "5" in a day is 5, not 35). `done` means no further digit can fit, so focus moves on to the next segment.
 * `value` is null while the digits are below the range (a leading "0").
 */
export function typeDigit(buffer: string, digit: string, [min, max]: [number, number]) {
  let text = buffer + digit;
  if (Number(text) > max) text = digit;
  const number = Number(text);
  const done = number * 10 > max || text.length >= String(max).length;
  return { buffer: text, value: number >= min ? number : done ? min : null, done };
}

/** Values of each segment for `date` (date parts) or `time` (24-hour { h, m }). */
export function dateToValues(date: Date | null | undefined): SegmentValues {
  return date ? { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() } : {};
}

export function timeToValues(time: { h: number; m: number } | null, hourCycle: 12 | 24): SegmentValues {
  if (!time) return {};
  return hourCycle === 12 ? { hour: time.h % 12 || 12, minute: time.m, dayPeriod: time.h < 12 ? 0 : 1 } : { hour: time.h, minute: time.m };
}

/** The date once day, month and year are all set and form a real day; else null. */
export function valuesToDate(values: SegmentValues): Date | null {
  const { year, month, day } = values;
  if (year === undefined || month === undefined || day === undefined) return null;
  if (day > daysInMonth(year, month)) return null;
  const date = new Date(2000, month - 1, day);
  // Two-digit years are years, not 19xx.
  date.setFullYear(year);
  return date;
}

/** 24-hour time once every segment is set; else null. */
export function valuesToTime(values: SegmentValues, hourCycle: 12 | 24): { h: number; m: number } | null {
  const { hour, minute, dayPeriod } = values;
  if (hour === undefined || minute === undefined) return null;
  if (hourCycle === 24) return { h: hour, m: minute };
  if (dayPeriod === undefined) return null;
  return { h: (hour % 12) + (dayPeriod === 1 ? 12 : 0), m: minute };
}

/** After the month or year changes, a day past the end of the month moves back to its last day (31 → 30). */
export function constrainDay(values: SegmentValues): SegmentValues {
  if (values.day === undefined || values.month === undefined) return values;
  const last = daysInMonth(values.year ?? 2000, values.month);
  return values.day > last ? { ...values, day: last } : values;
}

/** The locale's own AM and PM names ("AM"/"PM", "午前"/"午後"). */
export function periodNames(locale?: string): [string, string] {
  const format = new Intl.DateTimeFormat(locale, { hour: 'numeric', hourCycle: 'h12' });
  const name = (h: number) => format.formatToParts(new Date(2000, 0, 1, h)).find((part) => part.type === 'dayPeriod')?.value;
  return [name(9) ?? 'AM', name(21) ?? 'PM'];
}

/** Digits of `locale` mapped to 0–9, so "٣" typed on an Arabic keyboard counts as 3. */
export function localeDigits(locale?: string): Map<string, string> {
  const map = new Map<string, string>();
  const format = new Intl.NumberFormat(locale, { useGrouping: false });
  for (let i = 0; i <= 9; i++) {
    map.set(String(i), String(i));
    map.set(format.format(i), String(i));
  }
  return map;
}
