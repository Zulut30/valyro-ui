'use client';

import { useRef, useState, type ClipboardEvent, type ComponentPropsWithRef, type KeyboardEvent } from 'react';
import { XIcon } from '../icons';
import {
  composeHandlers,
  cx,
  Floating,
  isComposingKey,
  mergeRefs,
  useControllableState,
  useListNavigation,
} from '../primitives';
import type { FieldSize } from './PickerTrigger';
import { useFormField } from './form-field-context';
import { FormValue, useMissingValue } from './form-value';
import { PASTE_SEPARATORS, pasteTags } from './tags';
import { useFormReset } from '../forms/form-reset';
import './TagsInput.css';
import { withRef, useId } from '../primitives/react-compat';

export interface TagsInputLabels {
  /** Accessible name of a tag's remove button. */
  remove: (tag: string) => string;
  /** Accessible name of the suggestion list. */
  suggestions: string;
}

export const DEFAULT_TAGS_INPUT_LABELS: TagsInputLabels = {
  remove: (tag) => `Remove ${tag}`,
  suggestions: 'Suggestions',
};

export interface TagsInputProps
  extends Omit<ComponentPropsWithRef<'input'>, 'value' | 'defaultValue' | 'onChange' | 'size' | 'max'> {
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (tags: string[]) => void;
  /** Maximum number of tags. */
  max?: number;
  /** Return false to reject a tag; the text stays in the input and the field is marked invalid. */
  validate?: (tag: string, tags: string[]) => boolean;
  /** Completions shown in a dropdown while typing (already added tags are hidden). */
  suggestions?: string[];
  /** Field height and text size. */
  size?: FieldSize;
  /** Danger border and `aria-invalid`. Also shown after a rejected tag or while a required field is empty on submit. */
  invalid?: boolean;
  /** Submits every tag with the surrounding form, one hidden input per tag. The typed text is not submitted. */
  name?: string;
  /** Blocks native form submission while there are no tags. */
  required?: boolean;
  labels?: Partial<TagsInputLabels>;
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `className` and `style` go to the field wrapper; all other props go to the `<input>`. */
export const TagsInput = withRef(function TagsInput({
  value,
  defaultValue = [],
  onValueChange,
  max,
  validate,
  suggestions,
  size = 'md',
  invalid,
  labels: labelsProp,
  name,
  required,
  disabled,
  readOnly,
  placeholder,
  className,
  style,
  ref,
  onKeyDown,
  onPaste,
  onBlur,
  ...rest
}: TagsInputProps) {
  const [tags, setTags] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [text, setText] = useState('');
  const [rejected, setRejected] = useState(false);
  const [open, setOpen] = useState(false);
  // FormField's `required` only marks its label (aria-hidden); announce it on the input.
  const field = useFormField();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(
    rootRef,
    () => {
      setTags(defaultValue);
      setText('');
    },
    value === undefined,
  );
  const listId = useId();
  const labels = { ...DEFAULT_TAGS_INPUT_LABELS, ...labelsProp };
  const [missing, markMissing] = useMissingValue(tags.length > 0);
  const showInvalid = invalid || rejected || missing;

  const full = max !== undefined && tags.length >= max;
  const query = text.trim().toLowerCase();
  const matches = (suggestions ?? []).filter(
    (s) => !tags.some((t) => sameTag(t, s)) && s.toLowerCase().includes(query),
  );
  const listOpen = open && matches.length > 0 && !full && !disabled && !readOnly;

  // Only the arrow keys are delegated; Enter is handled below so it can also add typed text.
  const nav = useListNavigation({ count: matches.length });
  const highlighted = listOpen ? matches[nav.activeIndex] : undefined;

  /** Adds candidates in order; rejected ones go back into the input, before any unfinished `remainder`. */
  const addTags = (candidates: string[], remainder = '') => {
    const next = [...tags];
    const refused: string[] = [];
    for (const candidate of candidates) {
      const tag = candidate.trim();
      if (!tag || next.some((t) => sameTag(t, tag))) continue;
      if ((max !== undefined && next.length >= max) || (validate && !validate(tag, next))) {
        refused.push(tag);
        continue;
      }
      next.push(tag);
    }
    if (next.length !== tags.length) setTags(next);
    setText([...refused, remainder].filter(Boolean).join(', '));
    setRejected(refused.length > 0);
    nav.setActiveIndex(-1);
  };

  const removeAt = (index: number) => setTags(tags.filter((_, i) => i !== index));

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter confirms an IME conversion and arrows pick its candidates: not a tag, not the suggestion list.
    if (isComposingKey(event)) return;
    if (listOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      nav.onKeyDown(event);
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        if (suggestions) {
          event.preventDefault();
          setOpen(true);
        }
        return;
      case 'Enter':
        event.preventDefault();
        addTags([highlighted ?? text]);
        return;
      case 'Backspace':
        // Not read-only (the remove buttons are hidden then too); a full list still loses its last tag.
        if (text === '' && tags.length > 0 && !readOnly) {
          event.preventDefault();
          removeAt(tags.length - 1);
        }
        return;
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!PASTE_SEPARATORS.test(pasted)) return;
    event.preventDefault();
    const { selectionStart, selectionEnd } = event.currentTarget;
    addTags(pasteTags(text, selectionStart ?? text.length, selectionEnd ?? text.length, pasted));
  };

  return (
    <div
      ref={rootRef}
      className={cx('ui-field ui-tags-input', className)}
      style={style}
      data-size={size}
      data-invalid={showInvalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      // Marks the dimmed tags as part of an inactive control (exempt from text contrast), not just the input.
      aria-disabled={disabled || undefined}
      onMouseDown={(event) => {
        // Clicks on the field's padding focus the input instead of doing nothing.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {tags.map((tag, index) => (
        <span key={tag} className="ui-tags-input__tag">
          <span className="ui-tags-input__tag-label">{tag}</span>
          {!disabled && !readOnly && (
            <button
              type="button"
              className="ui-tags-input__remove"
              aria-label={labels.remove(tag)}
              onClick={() => {
                removeAt(index);
                inputRef.current?.focus();
              }}
            >
              <XIcon size={12} strokeWidth={2} />
            </button>
          )}
        </span>
      ))}
      <input
        type="text"
        autoComplete="off"
        role={suggestions ? 'combobox' : undefined}
        aria-autocomplete={suggestions ? 'list' : undefined}
        aria-expanded={suggestions ? listOpen : undefined}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={highlighted !== undefined ? `${listId}-${nav.activeIndex}` : undefined}
        {...rest}
        // A rejected tag marks the input invalid even when a FormField passes aria-invalid={undefined}.
        aria-invalid={rest['aria-invalid'] || showInvalid || undefined}
        aria-required={(required ?? field?.required) || undefined}
        ref={mergeRefs(inputRef, ref)}
        className="ui-field__input ui-tags-input__input"
        value={text}
        placeholder={tags.length === 0 ? placeholder : undefined}
        disabled={disabled}
        readOnly={readOnly || full}
        onChange={(event) => {
          const next = event.target.value;
          setRejected(false);
          setOpen(true);
          nav.setActiveIndex(-1);
          if (next.includes(',')) {
            const parts = next.split(',');
            const remainder = parts.pop() ?? '';
            addTags(parts, remainder.trimStart());
          } else {
            setText(next);
          }
        }}
        onKeyDown={composeHandlers(onKeyDown, handleKeyDown)}
        onPaste={composeHandlers(onPaste, handlePaste)}
        onBlur={composeHandlers(onBlur, () => setOpen(false))}
      />
      <Floating
        open={listOpen}
        anchorRef={rootRef}
        placement="bottom-start"
        matchAnchorWidth
        offset={6}
        onDismiss={() => setOpen(false)}
        id={listId}
        role="listbox"
        aria-label={labels.suggestions}
        className="ui-tags-input__listbox"
      >
        {matches.map((suggestion, index) => (
          <div
            key={suggestion}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === nav.activeIndex}
            className="ui-menu-item"
            data-highlighted={index === nav.activeIndex ? 'true' : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => nav.setActiveIndex(index)}
            onClick={() => addTags([suggestion])}
          >
            <span className="ui-menu-item__label">{suggestion}</span>
          </div>
        ))}
      </Floating>
      <FormValue
        name={name}
        values={tags}
        disabled={disabled}
        required={required}
        onMissing={(focus) => {
          markMissing();
          if (focus) inputRef.current?.focus();
        }}
      />
    </div>
  );
});
