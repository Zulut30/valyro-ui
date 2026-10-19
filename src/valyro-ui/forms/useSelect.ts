'use client';

import {
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type Dispatch,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type SelectHTMLAttributes,
  type SetStateAction,
} from 'react';
import { createContainsMatcher } from '../primitives/typeahead';
import { useControllableState } from '../primitives/useControllableState';
import { useDismissableLayer, type DismissReason } from '../primitives/useDismissableLayer';
import { useFloating, type Placement } from '../primitives/useFloating';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';
import { useFormReset } from './form-reset';
import { filterItems, firstEnabledIndex, flattenItems, type SelectItem, type SelectOption } from './listbox-items';
import { listboxName, useFieldLabelIds, useListbox, type ListboxState } from './useListbox';

/*
 * The behaviour of Select (and of MultiSelect, `multiple: true`) without its markup: the WAI-ARIA select-only
 * combobox. A button trigger opens a listbox popup; focus stays on the trigger, which forwards the list keys and
 * points at the highlighted option. Arrows, Enter and Space open it; letters jump to an option (and open a closed
 * single select); Tab and Escape close it. `searchable` adds a filter box to the popup. With `floating` (the
 * default) the hook also positions the popup next to the trigger (useFloating) and closes it on an outside press
 * or Escape (useDismissableLayer); the kit's Select renders its popup in Floating, which does both, so it passes
 * `floating: false`.
 */

interface SelectBaseOptions {
  /** Options, flat or in labelled groups. */
  items: SelectItem[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A filter box in the popup (getSearchProps) narrows the options; letters then type into it instead of jumping. */
  searchable?: boolean;
  /** Matcher of the filter box. Default: the label contains the text, ignoring case and accents as `locale` does ("e" finds "é"). */
  filter?: (option: SelectOption, query: string) => boolean;
  /** Locale of the type-ahead and the default filter. Default: the browser's. */
  locale?: string;
  /** Position the popup (getPopupProps) and close it on an outside press or Escape. Default true. */
  floating?: boolean;
  /** Preferred side and alignment of the popup. Default `bottom-start`. */
  placement?: Placement;
  /** Gap between the trigger and the popup, px. Default 6. */
  offset?: number;
  /**
   * The field is a native `<select>` (getNativeSelectProps): the browser's own picker, form validation and
   * autofill. The trigger, popup and listbox getters are then unused, and the popup never opens.
   */
  native?: boolean;
}

export interface SingleSelectOptions extends SelectBaseOptions {
  multiple?: false;
  /** Selected value; an empty string means none. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export interface MultipleSelectOptions extends SelectBaseOptions {
  /** Several values: picking an option toggles it and the popup stays open. */
  multiple: true;
  /** Selected values in the order they were picked. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}

export type SelectOptions = SingleSelectOptions | MultipleSelectOptions;

export interface SelectState<V extends string | string[] = string> {
  value: V;
  setValue: Dispatch<SetStateAction<V>>;
  /**
   * The options of the selected values. With `multiple`, a value no option has shows as `{ value, label: value }`;
   * without it, such a value is left out (the trigger shows its placeholder).
   */
  selected: SelectOption[];
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the popup with the selected option (or the first) highlighted. */
  show: () => void;
  /** Closes the popup and clears the filter; `restoreFocus` sends focus back to the trigger. */
  close: (restoreFocus?: boolean) => void;
  /** Text of the filter box. */
  query: string;
  setQuery: (query: string) => void;
  /** The option list, filtered by the filter box: options, highlight, selection. */
  listbox: ListboxState;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** The `<button>` that opens the popup: role combobox, the list keys, and the highlighted option. */
  getTriggerProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement> & { ref: (node: HTMLButtonElement | null) => void };
  /** The popup around the listbox: keeps focus where it is while rows are clicked; positioned with `floating`. */
  getPopupProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** The filter box of a `searchable` select (an `<input>` in the popup, which takes focus on open). */
  getSearchProps: (props?: UserProps) => InputHTMLAttributes<HTMLInputElement> & { ref: (node: HTMLInputElement | null) => void };
  /** The listbox, named by the trigger's `<label>` unless your props name it. */
  getListboxProps: ListboxState['getListboxProps'];
  getGroupProps: ListboxState['getGroupProps'];
  getGroupLabelProps: ListboxState['getGroupLabelProps'];
  getOptionProps: ListboxState['getOptionProps'];
  /**
   * A native `<select>` (with `native`): its value and change, kept in step after a form reset. Render the
   * `<option>`s (and `<optgroup>`s) of `items` inside it; a placeholder is an `<option value="">`.
   */
  getNativeSelectProps: (props?: UserProps) => SelectHTMLAttributes<HTMLSelectElement> & { ref: (node: HTMLSelectElement | null) => void };
}

const OPENING_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', ' '];

export function useSelect(options: SingleSelectOptions): SelectState<string>;
export function useSelect(options: MultipleSelectOptions): SelectState<string[]>;
export function useSelect(options: SelectOptions): SelectState<string> | SelectState<string[]>;
export function useSelect({
  items,
  multiple = false,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  searchable = false,
  filter: filterProp,
  locale,
  floating = true,
  placement = 'bottom-start',
  offset = 6,
  native = false,
}: SelectOptions): SelectState<string> | SelectState<string[]> {
  const emptyValue = multiple ? [] : '';
  const [raw, setRaw] = useControllableState<string | string[]>({
    value: valueProp,
    defaultValue: defaultValue ?? emptyValue,
    onChange: onValueChange as ((value: string | string[]) => void) | undefined,
  });
  const values = toValues(raw);
  const [openState, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen ?? false, onChange: onOpenChange });
  // A native select shows the browser's own picker: the popup never opens.
  const open = openState && !native;
  const [query, setQuery] = useState('');
  const [triggerRef, setTriggerNode] = useNodeRef<HTMLButtonElement>();
  const [nativeRef, setNativeNode] = useNodeRef<HTMLSelectElement>();
  const [searchRef, setSearchNode] = useNodeRef<HTMLInputElement>();
  const [popupRef, setPopupNode] = useNodeRef();
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset<Element>(native ? nativeRef : triggerRef, () => setRaw(defaultValue ?? emptyValue), valueProp === undefined);
  // The reset itself puts a native select on its first option (React marks no option `selected` in the HTML), so
  // the select shows the value again: the default, or the controlled value, which a reset does not change.
  useFormReset(
    nativeRef,
    (select) => {
      const shown = valueProp !== undefined ? values : toValues(defaultValue ?? emptyValue);
      for (const option of Array.from(select.options)) option.selected = shown.includes(option.value);
      if (!multiple && shown.length === 0) select.value = '';
    },
    native,
  );

  const allOptions = useMemo(() => flattenItems(items), [items]);
  const defaultFilter = useMemo(() => {
    const contains = createContainsMatcher(locale);
    return (option: SelectOption, q: string) => contains(option.label, q.trim());
  }, [locale]);
  const filter = filterProp ?? defaultFilter;
  const itemsFor = (q: string) => (searchable && q ? filterItems(items, (option) => filter(option, q)) : items);
  const visibleItems = useMemo(() => itemsFor(query), [items, filter, query, searchable]);
  const flat = useMemo(() => flattenItems(visibleItems), [visibleItems]);
  const selectedIndex = multiple ? -1 : flat.findIndex((option) => option.value === values[0]);
  const startIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(flat);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const listbox = useListbox({
    items: visibleItems,
    multiple,
    value: values,
    onValueChange: (next) => setRaw(multiple ? next : (next[0] ?? '')),
    // A single select closes on a pick; focus goes (back) to the trigger.
    onSelect: multiple ? undefined : () => close(true),
    defaultActiveIndex: open ? startIndex : -1,
    // With a filter box, letters filter the list instead of jumping to a row.
    typeahead: !searchable,
    locale,
    focusable: false,
  });
  const fieldLabelIds = useFieldLabelIds(triggerRef, open, listbox.id);
  // The listbox is named by the trigger's <label> unless the caller names it.
  const named: ListboxState = { ...listbox, getListboxProps: (props) => listbox.getListboxProps(listboxName(props, fieldLabelIds)) };
  const activeId = open && listbox.activeIndex >= 0 ? listbox.getOptionId(listbox.activeIndex) : undefined;

  const show = () => {
    listbox.setActiveIndex(startIndex);
    setOpen(true);
  };

  // The popup is positioned (and made visible) one render after it mounts, so focus waits a frame.
  useEffect(() => {
    if (!open || !searchable) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);

  const positioned = floating && open;
  const { floatingStyles, side, align } = useFloating({
    open: positioned,
    anchorRef: triggerRef,
    floatingRef: popupRef,
    placement,
    offset,
    matchAnchorWidth: true,
  });
  useDismissableLayer({
    enabled: positioned,
    refs: [popupRef, triggerRef],
    onDismiss: (reason: DismissReason) => close(reason === 'escape'),
  });

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (OPENING_KEYS.includes(event.key)) {
        event.preventDefault();
        show();
      } else if (!multiple && !searchable && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // Type-ahead on a closed select opens it on the first match.
        setOpen(true);
        listbox.onKeyDown(event);
      }
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    // Alt+↑ (APG select-only combobox): pick the highlighted option of a single select and close.
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      if (!multiple && listbox.activeIndex >= 0) listbox.select(listbox.activeIndex);
      close(true);
      return;
    }
    listbox.onKeyDown(event);
  };

  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Keyboard-generated clicks (detail 0, e.g. Space keyup) are already handled in onKeyDown.
    if (event.detail === 0) return;
    // Safari does not focus buttons on click; keyboard navigation needs focus on the trigger.
    event.currentTarget.focus();
    if (open) close();
    else show();
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setQuery(next);
    listbox.setActiveIndex(firstEnabledIndex(flattenItems(itemsFor(next))));
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME composition (Japanese, Chinese, Korean): Enter and Escape confirm or cancel the conversion, not the field.
    // keyCode 229: Safari reports the composition's last keydown with isComposing false.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab') {
      // Hand focus back to the trigger so Tab continues from there, not from a popup portaled to the end of <body>.
      close(true);
      return;
    }
    // Space, Home and End edit the search text.
    if (event.key === ' ' || event.key === 'Home' || event.key === 'End') return;
    listbox.onKeyDown(event);
  };

  const selected = values.flatMap((v): SelectOption[] => {
    const option = allOptions.find((o) => o.value === v);
    return option ? [option] : multiple ? [{ value: v, label: v }] : [];
  });

  return {
    value: raw as never,
    setValue: setRaw as never,
    selected,
    open,
    setOpen,
    show,
    close,
    query,
    setQuery,
    listbox: named,
    triggerRef,
    getTriggerProps: (props) =>
      withUserProps(
        {
          ref: setTriggerNode,
          type: 'button',
          role: 'combobox',
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          'aria-controls': open ? listbox.id : undefined,
          // With a filter box, that box points at the highlighted option.
          'aria-activedescendant': searchable ? undefined : activeId,
          onClick: handleTriggerClick,
          onKeyDown: handleTriggerKeyDown,
        },
        props,
      ) as never,
    getPopupProps: (props) =>
      withUserProps(
        {
          ...(floating && { ref: setPopupNode, style: floatingStyles, 'data-side': side, 'data-align': align }),
          // Keeps focus on the trigger (or in the filter box) while rows and buttons are clicked.
          onMouseDown: (event: MouseEvent) => {
            if (event.target !== searchRef.current) event.preventDefault();
          },
        },
        props,
      ),
    getSearchProps: (props) =>
      withUserProps(
        {
          ref: setSearchNode,
          type: 'text',
          role: 'combobox',
          'aria-expanded': open,
          'aria-controls': listbox.id,
          'aria-autocomplete': 'list',
          'aria-activedescendant': activeId,
          autoComplete: 'off',
          spellCheck: false,
          value: query,
          onChange: handleSearchChange,
          onKeyDown: handleSearchKeyDown,
        },
        props,
      ) as never,
    getListboxProps: named.getListboxProps,
    getGroupProps: listbox.getGroupProps,
    getGroupLabelProps: listbox.getGroupLabelProps,
    getOptionProps: listbox.getOptionProps,
    getNativeSelectProps: (props) =>
      withUserProps(
        {
          ref: setNativeNode,
          multiple: multiple || undefined,
          value: multiple ? values : (values[0] ?? ''),
          onChange: (event: ChangeEvent<HTMLSelectElement>) => {
            const select = event.currentTarget;
            setRaw(multiple ? Array.from(select.selectedOptions, (option) => option.value) : select.value);
          },
        },
        props,
      ) as never,
  } as SelectState<string> | SelectState<string[]>;
}

function toValues(value: string | string[]): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}
