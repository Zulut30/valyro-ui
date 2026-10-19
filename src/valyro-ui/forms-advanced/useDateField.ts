'use client';

import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type RefCallback } from 'react';
import { getDirection, GREGORIAN, inlineArrowStep, startOfDay } from '../primitives';
import { useControllableState } from '../primitives/useControllableState';
import { useId } from '../primitives/react-compat';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import {
  constrainDay,
  dateLayout,
  dateToValues,
  localeDigits,
  PAGE_STEP,
  periodNames,
  segmentRange,
  stepSegment,
  timeLayout,
  timeToValues,
  typeDigit,
  valuesToDate,
  valuesToTime,
  type SegmentPart,
  type SegmentType,
  type SegmentValues,
} from './date-segments';

/*
 * The behaviour of DateField and TimeField without their markup, after React Aria's useDateField: one
 * `role="spinbutton"` per segment, laid out by the locale (date-segments.ts). Digits fill a segment and move on when
 * no further digit fits; ArrowUp / ArrowDown step it (PageUp / PageDown in bigger steps, Home / End to its ends);
 * ArrowLeft / ArrowRight and Tab move between segments; Backspace clears digit by digit, then steps back; a typed
 * separator ("." "/" ":") jumps on. The segments are `contenteditable`, so a phone shows its number keyboard, and
 * what the keyboard types arrives through `beforeinput` when no key event says which key it was (Android).
 */

export interface DateFieldLabels {
  /** Names read with each segment; default: the locale's own words (Intl.DisplayNames), else these. */
  year: string;
  month: string;
  day: string;
  /** Shown in empty segments. */
  yearPlaceholder: string;
  monthPlaceholder: string;
  dayPlaceholder: string;
  /** Read for an empty segment. */
  empty: string;
}

export interface TimeFieldLabels {
  /** Names read with each segment; default: the locale's own words (Intl.DisplayNames), else these. */
  hour: string;
  minute: string;
  dayPeriod: string;
  /** Shown in empty segments (an empty AM/PM shows the locale's AM). */
  hourPlaceholder: string;
  minutePlaceholder: string;
  /** Read for an empty segment. */
  empty: string;
}

export const DEFAULT_DATE_FIELD_LABELS: DateFieldLabels = {
  year: 'year',
  month: 'month',
  day: 'day',
  yearPlaceholder: 'yyyy',
  monthPlaceholder: 'mm',
  dayPlaceholder: 'dd',
  empty: 'Empty',
};

export const DEFAULT_TIME_FIELD_LABELS: TimeFieldLabels = {
  hour: 'hour',
  minute: 'minute',
  dayPeriod: 'AM/PM',
  hourPlaceholder: '––',
  minutePlaceholder: '––',
  empty: 'Empty',
};

type SegmentLabels = DateFieldLabels & TimeFieldLabels;
const DEFAULT_SEGMENT_LABELS: SegmentLabels = { ...DEFAULT_DATE_FIELD_LABELS, ...DEFAULT_TIME_FIELD_LABELS };

/** One piece of the field: a segment to edit, or the text between two of them. */
export interface DateSegmentView {
  type: SegmentType | 'literal';
  /** The digits, the placeholder, or the separator. */
  text: string;
  /** An empty segment showing its placeholder. */
  placeholder: boolean;
  /** For a segment: spread on its element (a `<span>`). Absent for separators, which are `aria-hidden` text. */
  props?: HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement>; 'data-type': SegmentType; 'data-placeholder'?: true };
}

interface SegmentsOptions {
  parts: SegmentPart[];
  values: SegmentValues;
  setValues: (values: SegmentValues) => void;
  locale?: string;
  hourCycle: 12 | 24;
  disabled: boolean;
  readOnly: boolean;
  invalid: boolean;
  required: boolean;
  labels?: Partial<SegmentLabels>;
  /** Names the field: each segment reads as "<field> <segment>". */
  labelledBy?: string;
  describedBy?: string;
}

const SEPARATORS = /[\s./\-:,،、]/;

function segmentNames(locale: string | undefined, labels: Partial<SegmentLabels> | undefined) {
  let display: Intl.DisplayNames | null = null;
  try {
    display = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(locale, { type: 'dateTimeField' }) : null;
  } catch {
    display = null;
  }
  const name = (type: SegmentType) => labels?.[type] ?? display?.of(type) ?? DEFAULT_SEGMENT_LABELS[type];
  return { year: name('year'), month: name('month'), day: name('day'), hour: name('hour'), minute: name('minute'), dayPeriod: name('dayPeriod') };
}

/** Segment views and the group's props for any layout of segments (shared by useDateField and useTimeField). */
function useSegments({
  parts,
  values,
  setValues,
  locale,
  hourCycle,
  disabled,
  readOnly,
  invalid,
  required,
  labels: labelsProp,
  labelledBy,
  describedBy,
}: SegmentsOptions) {
  const labels = { ...DEFAULT_SEGMENT_LABELS, ...labelsProp };
  const baseId = useId();
  const elements = useRef(new Map<SegmentType, HTMLElement>());
  const refCallbacks = useRef(new Map<SegmentType, RefCallback<HTMLElement>>());
  /** Digits typed into the focused segment since it took focus. */
  const typing = useRef<{ type: SegmentType; text: string } | null>(null);
  const [, setTyped] = useState(0);
  const latest = useRef({ values, setValues });
  latest.current = { values, setValues };

  const editable = parts.filter((part): part is { type: SegmentType } => part.type !== 'literal').map((part) => part.type);
  const names = useMemo(() => segmentNames(locale, labelsProp), [locale, labelsProp]);
  const digits = useMemo(() => localeDigits(locale), [locale]);
  const periods = useMemo(() => periodNames(locale), [locale]);
  const monthNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { ...GREGORIAN, month: 'long' });
    return Array.from({ length: 12 }, (_, i) => format.format(new Date(2000, i, 1)));
  }, [locale]);
  const numbers = useMemo(() => {
    const plain = new Intl.NumberFormat(locale, { useGrouping: false });
    const padded = new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 2 });
    return { plain, padded };
  }, [locale]);

  const range = (type: SegmentType, from = latest.current.values) => segmentRange(type, from, hourCycle);

  const focusAt = (index: number) => {
    const type = editable[Math.max(0, Math.min(editable.length - 1, index))];
    elements.current.get(type)?.focus({ preventScroll: true });
  };
  const focusNext = (type: SegmentType) => {
    const index = editable.indexOf(type);
    if (index < editable.length - 1) focusAt(index + 1);
  };

  const commit = (type: SegmentType, value: number | undefined) => {
    const current = latest.current.values;
    let next: SegmentValues = { ...current };
    if (value === undefined) delete next[type];
    else next[type] = value;
    // A 12-hour clock without a period yet: the first hour typed starts in the morning.
    if (type === 'hour' && value !== undefined && hourCycle === 12 && next.dayPeriod === undefined) next.dayPeriod = 0;
    if (type === 'month' || type === 'year') next = constrainDay(next);
    latest.current.values = next;
    latest.current.setValues(next);
  };

  /** Today's part, where an arrow key starts an empty segment from. */
  const startValue = (type: SegmentType) => {
    const now = new Date();
    const today: SegmentValues = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: hourCycle === 12 ? now.getHours() % 12 || 12 : now.getHours(),
      minute: now.getMinutes(),
      dayPeriod: now.getHours() < 12 ? 0 : 1,
    };
    const [min, max] = range(type);
    return Math.min(max, Math.max(min, today[type] ?? min));
  };

  const typeChar = (type: SegmentType, char: string) => {
    if (type === 'dayPeriod') {
      const letter = char.toLocaleLowerCase(locale);
      const at = periods.findIndex((name) => name.toLocaleLowerCase(locale).startsWith(letter));
      const latin = letter === 'a' ? 0 : letter === 'p' ? 1 : -1;
      const pick = at !== -1 ? at : latin;
      if (pick !== -1) {
        commit(type, pick);
        focusNext(type);
      }
      return;
    }
    const digit = digits.get(char);
    if (digit === undefined) {
      // A separator typed after a value moves on, as typing "12." would on paper.
      if (SEPARATORS.test(char) && latest.current.values[type] !== undefined) focusNext(type);
      return;
    }
    const buffer = typing.current?.type === type ? typing.current.text : '';
    const result = typeDigit(buffer, digit, range(type));
    typing.current = result.done ? null : { type, text: result.buffer };
    if (result.value !== null) commit(type, result.value);
    else setTyped((n) => n + 1);
    if (result.done) focusNext(type);
  };

  const erase = (type: SegmentType) => {
    const buffer = typing.current?.type === type ? typing.current.text : '';
    const value = latest.current.values[type];
    if (!buffer && value === undefined) {
      // Already empty: Backspace steps back to the previous segment.
      const index = editable.indexOf(type);
      if (index > 0) focusAt(index - 1);
      return;
    }
    if (type === 'dayPeriod') {
      commit(type, undefined);
      return;
    }
    const text = (buffer || String(value)).slice(0, -1);
    typing.current = text ? { type, text } : null;
    const number = text ? Number(text) : NaN;
    commit(type, Number.isFinite(number) && number >= range(type)[0] ? number : undefined);
  };

  const onKeyDown = (type: SegmentType) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    // Left / Right follow the layout, which runs right-to-left in RTL locales.
    const inline = horizontal ? inlineArrowStep(event.key, getDirection(event.currentTarget)) : 0;
    if (inline !== 0) {
      event.preventDefault();
      focusAt(editable.indexOf(type) + inline);
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter' || event.key === 'Escape') return;
    // Nothing else may edit the text of a contenteditable segment directly.
    if (event.key.length === 1 || ['Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
    }
    if (disabled || readOnly) return;
    const value = latest.current.values[type];
    const [min, max] = range(type);
    const step = (delta: number) => {
      typing.current = null;
      commit(type, value === undefined ? startValue(type) : stepSegment(type, value, delta, [min, max]));
    };
    switch (event.key) {
      case 'ArrowUp':
        return step(1);
      case 'ArrowDown':
        return step(-1);
      case 'PageUp':
        return step(PAGE_STEP[type]);
      case 'PageDown':
        return step(-PAGE_STEP[type]);
      case 'Home':
        typing.current = null;
        return commit(type, min);
      case 'End':
        typing.current = null;
        return commit(type, max);
      case 'Backspace':
      case 'Delete':
        return erase(type);
    }
    if (event.key.length === 1) typeChar(type, event.key);
  };

  // Phones type through `beforeinput` (no key in the keydown event); every other edit of the text is refused.
  const rootRef = useRef<HTMLElement | null>(null);
  const handlers = useRef({ typeChar, erase, disabled, readOnly });
  handlers.current = { typeChar, erase, disabled, readOnly };
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onBeforeInput = (event: InputEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-type]');
      const type = target?.dataset.type as SegmentType | undefined;
      event.preventDefault();
      const { typeChar: type_, erase: erase_, disabled: off, readOnly: locked } = handlers.current;
      if (!type || off || locked) return;
      if (event.inputType === 'insertText' && event.data) {
        // Several characters at once (a paste, an IME, an assistive tool) flow on from segment to segment.
        for (const char of Array.from(event.data)) {
          const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('[data-type]');
          const current = focused && root.contains(focused) ? (focused.dataset.type as SegmentType) : type;
          type_(current, char);
        }
      } else if (event.inputType.startsWith('delete')) erase_(type);
    };
    root.addEventListener('beforeinput', onBeforeInput);
    return () => root.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  const refFor = (type: SegmentType): RefCallback<HTMLElement> => {
    let callback = refCallbacks.current.get(type);
    if (!callback) {
      callback = (node) => {
        if (node) elements.current.set(type, node);
        else elements.current.delete(type);
      };
      refCallbacks.current.set(type, callback);
    }
    return callback;
  };

  const textOf = (type: SegmentType): { text: string; placeholder: boolean } => {
    const buffer = typing.current?.type === type ? typing.current.text : '';
    const value = values[type];
    if (buffer && (value === undefined || Number(buffer) !== value)) return { text: numbers.plain.format(Number(buffer)).padStart(buffer.length, numbers.plain.format(0)), placeholder: false };
    if (value === undefined) {
      const placeholder =
        type === 'dayPeriod' ? periods[0] : labels[`${type}Placeholder` as 'yearPlaceholder' | 'monthPlaceholder' | 'dayPlaceholder' | 'hourPlaceholder' | 'minutePlaceholder'];
      return { text: placeholder, placeholder: true };
    }
    if (type === 'dayPeriod') return { text: periods[value] ?? '', placeholder: false };
    const pad = type === 'minute' || type === 'day' || type === 'month' || (type === 'hour' && hourCycle === 24);
    return { text: (pad ? numbers.padded : numbers.plain).format(value), placeholder: false };
  };

  const valueText = (type: SegmentType) => {
    const value = values[type];
    if (value === undefined) return labels.empty;
    if (type === 'dayPeriod') return periods[value];
    if (type === 'month') return `${numbers.plain.format(value)} – ${monthNames[value - 1]}`;
    return numbers.plain.format(value);
  };

  const segments: DateSegmentView[] = parts.map((part) => {
    if (part.type === 'literal') return { type: 'literal', text: part.text, placeholder: false };
    const type = part.type;
    const { text, placeholder } = textOf(type);
    const [min, max] = segmentRange(type, values, hourCycle);
    const id = `${baseId}-${type}`;
    const editableNow = !disabled && !readOnly;
    return {
      type,
      text,
      placeholder,
      props: {
        ref: refFor(type),
        id,
        role: 'spinbutton',
        tabIndex: disabled ? -1 : 0,
        'aria-label': names[type],
        'aria-labelledby': labelledBy ? `${labelledBy} ${id}` : undefined,
        'aria-describedby': describedBy,
        'aria-valuenow': values[type],
        'aria-valuemin': min,
        'aria-valuemax': max,
        'aria-valuetext': valueText(type),
        'aria-invalid': invalid || undefined,
        'aria-required': required || undefined,
        'aria-readonly': readOnly || undefined,
        'aria-disabled': disabled || undefined,
        contentEditable: editableNow,
        suppressContentEditableWarning: true,
        spellCheck: false,
        autoCorrect: 'off',
        autoCapitalize: 'off',
        inputMode: type === 'dayPeriod' ? 'text' : 'numeric',
        enterKeyHint: 'next',
        'data-type': type,
        'data-placeholder': placeholder || undefined,
        onKeyDown: onKeyDown(type),
        onFocus: () => {
          typing.current = null;
        },
        onBlur: () => {
          if (typing.current?.type === type) {
            typing.current = null;
            setTyped((n) => n + 1);
          }
        },
      } as DateSegmentView['props'],
    };
  });

  const getGroupProps = (props?: UserProps): HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement> } =>
    withUserProps(
      {
        role: 'group',
        'aria-labelledby': labelledBy,
        'aria-describedby': describedBy,
        'aria-disabled': disabled || undefined,
        ref: (node: HTMLElement | null) => {
          rootRef.current = node;
        },
        // A press on the field around the segments (its padding, an icon) starts at the first empty one.
        onPointerDown: (event: { target: EventTarget | null; currentTarget: HTMLElement; preventDefault: () => void }) => {
          if (disabled || (event.target as HTMLElement).closest?.('[data-type]')) return;
          event.preventDefault();
          const empty = editable.findIndex((type) => latest.current.values[type] === undefined);
          focusAt(empty === -1 ? 0 : empty);
        },
      } as HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement> },
      props,
    );

  return { segments, getGroupProps, focusFirst: () => focusAt(0) };
}

/* ── Date ── */

export interface DateFieldOptions {
  value?: Date | null;
  defaultValue?: Date | null;
  onValueChange?: (value: Date | null) => void;
  /** Order, separators, digits and segment names. Default: the browser's. */
  locale?: string;
  /** Earliest valid day; a complete date before it marks the field invalid. */
  minDate?: Date;
  /** Latest valid day; a complete date after it marks the field invalid. */
  maxDate?: Date;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  /** aria-required on every segment. */
  required?: boolean;
  labels?: Partial<DateFieldLabels>;
  /** Id of the field's label: each segment reads as "<label> <segment>". */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export interface DateFieldState {
  /** The date, or null while any segment is empty. */
  value: Date | null;
  setValue: (value: Date | null) => void;
  /** A complete date outside `minDate`…`maxDate`. */
  outOfRange: boolean;
  segments: DateSegmentView[];
  /** The element around the segments: `role="group"`, its name, and focus for presses between segments. */
  getGroupProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement> };
  focusFirst: () => void;
}

const sameDay = (a: Date | null | undefined, b: Date | null | undefined) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** A date typed segment by segment (day, month, year in the locale's order). */
export function useDateField({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  locale,
  minDate,
  maxDate,
  disabled = false,
  readOnly = false,
  invalid = false,
  required = false,
  labels,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: DateFieldOptions = {}): DateFieldState {
  const [value, setValue] = useControllableState<Date | null>({ value: valueProp, defaultValue, onChange: onValueChange });
  const [values, setValuesState] = useState<SegmentValues>(() => dateToValues(value));
  const emitted = useRef(value);
  // A value set from outside (a reset, another control) replaces whatever is typed.
  if (!sameDay(value, emitted.current)) {
    emitted.current = value;
    setValuesState(dateToValues(value));
  }
  const setValues = (next: SegmentValues) => {
    setValuesState(next);
    const date = valuesToDate(next);
    if (!sameDay(date, emitted.current)) {
      emitted.current = date;
      setValue(date);
    }
  };
  const parts = useMemo(() => dateLayout(locale), [locale]);
  const outOfRange =
    !!value && ((!!minDate && value < startOfDay(minDate)) || (!!maxDate && startOfDay(value) > startOfDay(maxDate)));
  const { segments, getGroupProps, focusFirst } = useSegments({
    parts,
    values,
    setValues,
    locale,
    hourCycle: 24,
    disabled,
    readOnly,
    invalid: invalid || outOfRange,
    required,
    labels,
    labelledBy,
    describedBy,
  });
  return {
    value,
    setValue: (next) => {
      emitted.current = next;
      setValuesState(dateToValues(next));
      setValue(next);
    },
    outOfRange,
    segments,
    getGroupProps,
    focusFirst,
  };
}

/* ── Time ── */

export interface TimeFieldOptions extends Omit<DateFieldOptions, 'value' | 'defaultValue' | 'onValueChange' | 'minDate' | 'maxDate' | 'labels'> {
  /** 24-hour "HH:mm". */
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  /** 12 (with an AM/PM segment) or 24. */
  hourCycle: 12 | 24;
  labels?: Partial<TimeFieldLabels>;
}

export interface TimeFieldState extends Omit<DateFieldState, 'value' | 'setValue' | 'outOfRange'> {
  /** 24-hour "HH:mm", or null while any segment is empty. */
  value: string | null;
  setValue: (value: string | null) => void;
}

/** "9:05" → { h: 9, m: 5 }; null for anything that is not a 24-hour time. */
export function parseTimeValue(value: string | null | undefined): { h: number; m: number } | null {
  const match = value ? /^(\d{1,2}):(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

const formatTimeValue = (time: { h: number; m: number } | null) =>
  time ? `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}` : null;

/** A time typed segment by segment (hour, minute and, on a 12-hour clock, AM/PM). */
export function useTimeField({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  locale,
  hourCycle,
  disabled = false,
  readOnly = false,
  invalid = false,
  required = false,
  labels,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: TimeFieldOptions): TimeFieldState {
  const [raw, setRaw] = useControllableState<string | null>({ value: valueProp, defaultValue, onChange: onValueChange });
  const value = formatTimeValue(parseTimeValue(raw));
  const [values, setValuesState] = useState<SegmentValues>(() => timeToValues(parseTimeValue(value), hourCycle));
  const emitted = useRef({ value, hourCycle });
  if (value !== emitted.current.value || hourCycle !== emitted.current.hourCycle) {
    emitted.current = { value, hourCycle };
    setValuesState(timeToValues(parseTimeValue(value), hourCycle));
  }
  const setValues = (next: SegmentValues) => {
    setValuesState(next);
    const time = formatTimeValue(valuesToTime(next, hourCycle));
    if (time !== emitted.current.value) {
      emitted.current = { value: time, hourCycle };
      setRaw(time);
    }
  };
  const parts = useMemo(() => timeLayout(locale, hourCycle), [locale, hourCycle]);
  const { segments, getGroupProps, focusFirst } = useSegments({
    parts,
    values,
    setValues,
    locale,
    hourCycle,
    disabled,
    readOnly,
    invalid,
    required,
    labels,
    labelledBy,
    describedBy,
  });
  return {
    value,
    setValue: (next) => {
      const normalized = formatTimeValue(parseTimeValue(next));
      emitted.current = { value: normalized, hourCycle };
      setValuesState(timeToValues(parseTimeValue(normalized), hourCycle));
      setRaw(normalized);
    },
    segments,
    getGroupProps,
    focusFirst,
  };
}
