'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentPropsWithRef } from 'react';
import { clamp, cx, mergeRefs } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { useFormReset } from './form-reset';
import { useFormField } from '../forms-advanced/form-field-context';
import './Textarea.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  /** Error border and aria-invalid on the textarea (an explicit `aria-invalid` wins). */
  invalid?: boolean;
  /** Text size and padding, like TextInput's sm / md / lg. */
  size?: 'sm' | 'md' | 'lg';
  /** Grow with the content between `minRows` and `maxRows`. */
  autoResize?: boolean;
  /** Visible rows when empty (also the initial height without `autoResize`). Default 3. */
  minRows?: number;
  /** Height limit for `autoResize`; the textarea scrolls beyond it. */
  maxRows?: number;
  /** Locale for the character counter numbers (default: the ThemeProvider's, then the browser's). */
  locale?: string;
}

/** Counter tone: `near` from 90% of the limit, `limit` once it is reached. */
export function counterState(length: number, maxLength: number | undefined) {
  if (maxLength === undefined) return undefined;
  if (length >= maxLength) return 'limit';
  return length >= maxLength * 0.9 ? 'near' : undefined;
}

/**
 * Multi-line field. With `maxLength` a character counter is shown.
 * `className` and `style` go to the field wrapper, other props to the native <textarea>.
 */
export const Textarea = withRef(function Textarea({
  invalid = false,
  size = 'md',
  autoResize = false,
  minRows = 3,
  maxRows,
  rows,
  maxLength,
  locale,
  disabled,
  readOnly,
  value,
  defaultValue,
  onChange,
  className,
  style,
  ref,
  'aria-invalid': ariaInvalid,
  'aria-describedby': describedBy,
  ...rest
}: TextareaProps) {
  // FormField's `required` only marks its label (aria-hidden); announce it on the control.
  const field = useFormField();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  const [innerLength, setInnerLength] = useState(() => String(defaultValue ?? '').length);
  const length = value !== undefined ? String(value).length : innerLength;
  const resolvedLocale = useLocale(locale);
  const numberFormat = useMemo(() => new Intl.NumberFormat(resolvedLocale), [resolvedLocale]);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !autoResize) return;
    const css = getComputedStyle(el);
    const lineHeight = parseFloat(css.lineHeight);
    const chrome =
      parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    const min = minRows * lineHeight + chrome;
    const max = maxRows ? maxRows * lineHeight + chrome : Infinity;
    // Measuring needs height: auto for a moment, which shortens the document: keep the page where it is meanwhile.
    const page = document.scrollingElement;
    const top = page?.scrollTop ?? 0;
    el.style.height = 'auto';
    const content = el.scrollHeight + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    el.style.height = `${clamp(content, min, max)}px`;
    if (page && page.scrollTop !== top) page.scrollTop = top;
    el.style.overflowY = content > max ? 'auto' : 'hidden';
  }, [autoResize, minRows, maxRows]);

  // On mount, when a controlled value changes and when the row limits change (not on every parent render).
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  // Narrower field = more wrapped lines, so the height follows width changes too (layout, window, container resizes).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !autoResize) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoResize, resize]);

  useFormReset(
    textareaRef,
    (textarea) => {
      setInnerLength(textarea.value.length);
      resize();
    },
    value === undefined,
  );

  const limitState = counterState(length, maxLength);

  return (
    <div
      className={cx('ui-field', 'ui-textarea', className)}
      style={style}
      data-size={size}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
      data-auto-resize={autoResize || undefined}
      data-counter={maxLength !== undefined || undefined}
      onMouseDown={(event) => {
        // Clicks on the padding or counter focus the textarea.
        if (event.target === textareaRef.current) return;
        event.preventDefault();
        textareaRef.current?.focus();
      }}
    >
      <textarea
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        aria-describedby={cx(describedBy, maxLength !== undefined && counterId) || undefined}
        aria-required={field?.required || undefined}
        {...rest}
        ref={mergeRefs(textareaRef, ref)}
        className="ui-textarea__input"
        rows={rows ?? minRows}
        maxLength={maxLength}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          setInnerLength(event.target.value.length);
          // A controlled value resizes in the layout effect once the parent applies it.
          if (value === undefined) resize();
          onChange?.(event);
        }}
      />
      {maxLength !== undefined && (
        <div className="ui-textarea__footer">
          <span id={counterId} className="ui-textarea__count" data-state={limitState}>
            {numberFormat.format(length)}/{numberFormat.format(maxLength)}
          </span>
        </div>
      )}
    </div>
  );
});
