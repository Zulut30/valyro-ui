'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type FocusEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { createContainsMatcher } from '../primitives/typeahead';
import { useControllableState } from '../primitives/useControllableState';
import { useDismissableLayer } from '../primitives/useDismissableLayer';
import { useFloating, type Placement } from '../primitives/useFloating';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';
import { useFormReset } from './form-reset';
import { filterItems, firstEnabledIndex, flattenItems, type SelectItem, type SelectOption } from './listbox-items';
import { listboxName, useFieldLabelIds, useListbox, type ListboxState } from './useListbox';

/*
 * The behaviour of Combobox without its markup: the WAI-ARIA editable combobox with list autocomplete. Typing
 * filters the options and opens the popup; focus stays in the input, which points at the highlighted option. Enter
 * picks it (or commits the typed text), Escape and Tab close, leaving the field resolves the text into a value
 * (an option with that label, the text itself with `allowCustomValue`, or back to the selected label). The
 * highlight follows its option when the list changes under it (async results). With `floating` (the default) the
 * hook positions the popup and closes it on an outside press or Escape; the kit's Combobox renders it in Floating.
 */

export interface ComboboxOptions {
  /** Options, flat or in labelled groups; filtered by the typed text unless `filter` is false. */
  items: SelectItem[];
  /** Selected option value (or the typed text with `allowCustomValue`); an empty string means none. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Text in the input. */
  inputValue?: string;
  defaultInputValue?: string;
  onInputValueChange?: (text: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Matcher of the typed text, or `false` when `items` come filtered (by a server). Default: the label contains it,
   * ignoring case and accents as `locale` does ("e" finds "é", as React Aria's useFilter).
   */
  filter?: false | ((option: SelectOption, query: string) => boolean);
  /** Locale of the default filter. Default: the browser's. */
  locale?: string;
  /** Typed text that matches no option is kept as the value on Enter and on leaving the field. */
  allowCustomValue?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Position the popup (getPopupProps) and close it on an outside press or Escape. Default true. */
  floating?: boolean;
  /** Preferred side and alignment of the popup. Default `bottom-start`. */
  placement?: Placement;
  /** Gap between the field and the popup, px. Default 6. */
  offset?: number;
  /**
   * `single` (default): a pick sets the value and the text. `none`: a pick only calls `onSelect` (a command menu,
   * search results): the text stays, there is no value, the highlighted option reads as selected, and leaving the
   * field changes nothing.
   */
  selectionMode?: 'single' | 'none';
  /** Called with the picked option (click or Enter), after the value changes. */
  onSelect?: (option: SelectOption) => void;
  /** Keep the first enabled option highlighted while typing (and from the start). Default: with `selectionMode: 'none'`. */
  autoHighlight?: boolean;
}

export interface ComboboxState {
  value: string;
  setValue: (value: string) => void;
  /** Text in the input. */
  inputValue: string;
  setInputValue: (text: string) => void;
  /** The selected option (undefined for none, or for a custom value). */
  selected: SelectOption | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens with every option shown and the selected one highlighted. */
  show: () => void;
  /** Closes without touching the value. */
  close: () => void;
  /** Picks an option as a click does: sets the value and the text, closes (with `selectionMode: 'none'`, only onSelect). */
  selectOption: (option: SelectOption) => void;
  /** Does what typing `text` does: sets the text, filters, opens and moves the highlight. */
  search: (text: string) => void;
  /** The text that filters the options, or null while every option shows (opened without typing). */
  query: string | null;
  /** The visible options: highlight and selection. */
  listbox: ListboxState;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The `<input>`: role combobox, typing, the list keys, and leaving the field. */
  getInputProps: (props?: UserProps) => InputHTMLAttributes<HTMLInputElement> & { ref: (node: HTMLInputElement | null) => void };
  /** The element around the input and its buttons (optional): the popup anchors to it, presses on it focus the input. */
  getFieldProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The element the popup anchors to: the field, or the input without one. */
  anchorRef: RefObject<HTMLElement | null>;
  /** A button that opens and closes the list (outside the Tab order); name it with `aria-label`. */
  getToggleButtonProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement> & { ref: (node: HTMLButtonElement | null) => void };
  /** The popup around the listbox: keeps focus in the input while rows are clicked; positioned with `floating`. */
  getPopupProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** The listbox, named by the input's `<label>` unless your props name it. */
  getListboxProps: ListboxState['getListboxProps'];
  getGroupProps: ListboxState['getGroupProps'];
  getGroupLabelProps: ListboxState['getGroupLabelProps'];
  getOptionProps: ListboxState['getOptionProps'];
}

export function useCombobox({
  items,
  value: valueProp,
  defaultValue,
  onValueChange,
  inputValue: inputValueProp,
  defaultInputValue,
  onInputValueChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  filter: filterProp,
  locale,
  allowCustomValue = false,
  disabled = false,
  readOnly = false,
  floating = true,
  placement = 'bottom-start',
  offset = 6,
  selectionMode = 'single',
  onSelect,
  autoHighlight = selectionMode === 'none',
}: ComboboxOptions): ComboboxState {
  const picking = selectionMode === 'single';
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue: defaultValue ?? '', onChange: onValueChange });
  const allOptions = useMemo(() => flattenItems(items), [items]);
  const defaultFilter = useMemo(() => {
    const contains = createContainsMatcher(locale);
    return (option: SelectOption, q: string) => contains(option.label, q.trim());
  }, [locale]);
  const filter = filterProp ?? defaultFilter;
  // Remembers the picked option so its label survives async option lists that no longer contain it.
  const picked = useRef<SelectOption | null>(null);
  const labelFor = (v: string) =>
    v === '' ? '' : (allOptions.find((option) => option.value === v)?.label ?? (picked.current?.value === v ? picked.current.label : v));

  const [text, setText] = useControllableState({
    value: inputValueProp,
    defaultValue: defaultInputValue ?? labelFor(value),
    onChange: onInputValueChange,
  });
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen ?? false, onChange: onOpenChange });
  // null = show every option (opened without typing); a string = filter by what was typed.
  const [query, setQuery] = useState<string | null>(null);
  const [fieldRef, setFieldNode] = useNodeRef();
  const [inputRef, setInputNode] = useNodeRef<HTMLInputElement>();
  const [toggleRef, setToggleNode] = useNodeRef<HTMLButtonElement>();
  const [popupRef, setPopupNode] = useNodeRef();
  // The popup anchors to the field around the input, or to the input itself.
  const anchorRef = useMemo(
    () => ({
      get current(): HTMLElement | null {
        return fieldRef.current ?? inputRef.current;
      },
    }),
    [],
  );
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(
    inputRef,
    () => {
      if (valueProp === undefined) setValue(defaultValue ?? '');
      if (inputValueProp === undefined) setText(defaultInputValue ?? labelFor(defaultValue ?? ''));
    },
    valueProp === undefined || inputValueProp === undefined,
  );

  const itemsFor = (q: string | null) => (q && filter ? filterItems(items, (option) => filter(option, q)) : items);
  // Filtered once per query, not on every render: moving the highlight over a long list re-renders on each row.
  const visibleItems = useMemo(() => itemsFor(query), [items, filter, query]);
  const flat = useMemo(() => flattenItems(visibleItems), [visibleItems]);

  // Show the label when the value changes from outside (e.g. a form reset).
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    if (query === null) setText(labelFor(value));
  });

  const close = () => {
    setOpen(false);
    setQuery(null);
  };

  const selectOption = (option: SelectOption) => {
    if (picking) {
      picked.current = option;
      lastValue.current = option.value;
      setValue(option.value);
      setText(option.label);
      close();
    }
    onSelect?.(option);
  };

  const listbox = useListbox({
    items: visibleItems,
    value: value ? [value] : [],
    onSelect: (i) => selectOption(flat[i]),
    defaultActiveIndex: autoHighlight ? firstEnabledIndex(flat) : -1,
    typeahead: false,
    focusable: false,
    selectionFollowsFocus: !picking,
  });
  const { activeIndex, setActiveIndex } = listbox;
  const fieldLabelIds = useFieldLabelIds(inputRef, open, listbox.id);
  // The listbox is named by the input's <label> unless the caller names it.
  const named: ListboxState = { ...listbox, getListboxProps: (props) => listbox.getListboxProps(listboxName(props, fieldLabelIds)) };

  // The highlight follows the option, not its position: when new suggestions arrive (async search), Enter must not
  // pick whatever now sits at the old index. Typing resets it on purpose (handleChange), so that change is skipped.
  const highlighted = useRef<string | undefined>(undefined);
  const typed = useRef(false);
  const flatKey = useMemo(() => flat.map((option) => option.value).join('\u0000'), [flat]);
  useEffect(() => {
    if (typed.current) {
      typed.current = false;
      // Options that arrive for the typed text (filtered outside the hook) get the highlight on their first one.
      if (autoHighlight) setActiveIndex(firstEnabledIndex(flat));
      return;
    }
    const previous = highlighted.current;
    if (previous === undefined) return;
    const index = flat.findIndex((option) => option.value === previous);
    if (index !== activeIndex) setActiveIndex(index >= 0 ? index : allowCustomValue ? -1 : firstEnabledIndex(flat));
    // Runs when the list itself changes.
  }, [flatKey]);
  useEffect(() => {
    highlighted.current = activeIndex >= 0 ? flat[activeIndex]?.value : undefined;
    // A keystroke that left the list unchanged must not swallow the next real update.
    typed.current = false;
  });

  const show = () => {
    if (disabled || readOnly) return;
    const selectedIndex = allOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : -1);
    setQuery(null);
    setOpen(true);
  };

  /** Resolves free text into a value when the user leaves the field or presses Enter without a highlighted row. */
  const commitText = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      lastValue.current = '';
      setValue('');
      setText('');
      return;
    }
    const exact = allOptions.find((option) => !option.disabled && option.label.toLowerCase() === trimmed.toLowerCase());
    if (exact) selectOption(exact);
    else if (allowCustomValue) {
      lastValue.current = trimmed;
      setValue(trimmed);
    } else setText(labelFor(value));
  };

  const search = (next: string) => {
    setText(next);
    setQuery(next);
    setOpen(true);
    const nextFlat = flattenItems(itemsFor(next));
    typed.current = true;
    setActiveIndex(!autoHighlight && (allowCustomValue || next.trim() === '') ? -1 : firstEnabledIndex(nextFlat));
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => search(event.target.value);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME composition (Japanese, Chinese, Korean): Enter and Escape confirm or cancel the conversion, not the field.
    // keyCode 229: Safari reports the composition's last keydown with isComposing false.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (!open) {
          event.preventDefault();
          show();
          return;
        }
        // Alt+↑ closes the list and keeps the text (WAI-ARIA APG combobox).
        if (event.altKey && event.key === 'ArrowUp') {
          event.preventDefault();
          close();
          return;
        }
        break;
      case 'Enter':
        if (!open) return;
        event.preventDefault();
        if (activeIndex >= 0) selectOption(flat[activeIndex]);
        else if (picking) {
          commitText();
          close();
        }
        return;
      case 'Tab':
        if (open) close();
        return;
      // Space, Home and End edit the text instead of moving through the list.
      case ' ':
      case 'Home':
      case 'End':
        return;
    }
    if (open) listbox.onKeyDown(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (!picking) return;
    const next = event.relatedTarget as Node | null;
    if (fieldRef.current?.contains(next) || (next && toggleRef.current === next)) return;
    close();
    commitText();
  };

  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    if (!open && event.detail > 0) show();
  };

  const positioned = floating && open && !disabled && !readOnly;
  const { floatingStyles, side, align } = useFloating({
    open: positioned,
    anchorRef,
    floatingRef: popupRef,
    placement,
    offset,
    matchAnchorWidth: true,
  });
  useDismissableLayer({ enabled: positioned, refs: [popupRef, anchorRef], onDismiss: close });

  return {
    value,
    setValue,
    inputValue: text,
    setInputValue: setText,
    selected: allOptions.find((option) => option.value === value),
    open,
    setOpen,
    show,
    close,
    selectOption,
    search,
    query,
    listbox: named,
    inputRef,
    anchorRef,
    getInputProps: (props) =>
      withUserProps(
        {
          ref: setInputNode,
          type: 'text',
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': open,
          'aria-controls': open ? listbox.id : undefined,
          'aria-activedescendant': open && activeIndex >= 0 ? listbox.getOptionId(activeIndex) : undefined,
          autoComplete: 'off',
          spellCheck: false,
          value: text,
          disabled,
          readOnly,
          onChange: handleChange,
          onKeyDown: handleKeyDown,
          onClick: handleClick,
          onBlur: handleBlur,
        },
        props,
      ) as never,
    getFieldProps: (props) =>
      withUserProps(
        {
          ref: setFieldNode,
          onMouseDown: (event: MouseEvent) => {
            // Presses on padding or icons focus the input instead of blurring it.
            if (event.target !== inputRef.current) {
              event.preventDefault();
              inputRef.current?.focus();
            }
          },
        },
        props,
      ) as never,
    getToggleButtonProps: (props) =>
      withUserProps(
        {
          ref: setToggleNode,
          type: 'button',
          tabIndex: -1,
          'aria-expanded': open,
          disabled: disabled || readOnly,
          onClick: () => {
            if (open) close();
            else show();
            inputRef.current?.focus();
          },
        },
        props,
      ) as never,
    getPopupProps: (props) =>
      withUserProps(
        {
          ...(floating && { ref: setPopupNode, style: floatingStyles, 'data-side': side, 'data-align': align }),
          // Keeps focus in the input while rows are clicked.
          onMouseDown: (event: MouseEvent) => event.preventDefault(),
        },
        props,
      ),
    getListboxProps: named.getListboxProps,
    getGroupProps: listbox.getGroupProps,
    getGroupLabelProps: listbox.getGroupLabelProps,
    getOptionProps: listbox.getOptionProps,
  };
}
