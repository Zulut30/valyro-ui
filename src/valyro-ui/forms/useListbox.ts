'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { stepIndex, useListNavigation } from '../primitives/useListNavigation';
import { useId, useLayoutEffect } from '../primitives/react-compat';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';
import { firstEnabledIndex, flattenItems, optionId, type SelectItem, type SelectOption } from './listbox-items';

/*
 * The behaviour of a listbox without its markup: options (flat or in labelled groups), which of them are selected
 * (one or several, controlled or not), the highlighted option and the WAI-ARIA keys (arrows, Home / End, Enter /
 * Space, type-ahead). The listbox takes focus itself, or a select trigger or a combobox input keeps focus, forwards
 * its keys (`onKeyDown`) and points at the highlighted option (`getOptionId`): `focusable: false`. The option list of
 * Select, MultiSelect and Combobox renders with it, so their option ARIA lives here.
 *
 * A focusable listbox with `multiple` also selects ranges as React Aria's ListBox does: Shift+click and Shift with
 * the arrows, Home / End and Page keys extend the selection from the last picked option (the anchor), Shift+Space
 * selects up to the highlighted one, Ctrl/Cmd+A selects all, Escape clears. `selectionBehavior: 'replace'` makes it
 * work like a file list: a click or an arrow selects that option alone, Ctrl/Cmd+click and Ctrl/Cmd+Space toggle,
 * Ctrl/Cmd+arrows move without selecting.
 */

export interface ListboxOptions {
  /** Options, flat or in labelled groups. */
  items: SelectItem[];
  /** Several options can be selected; picking one toggles it. */
  multiple?: boolean;
  /** Selected values (at most one without `multiple`). */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Called after an option is picked (click, Enter, Space) with its index among the options. */
  onSelect?: (index: number) => void;
  /** Highlighted option on mount (an index among the options). Default none. */
  defaultActiveIndex?: number;
  /** Letters move the highlight to the next option that starts with them. Default true. */
  typeahead?: boolean;
  /** Locale of the type-ahead comparison (case and accents ignored as this locale does). Default: the browser's. */
  locale?: string;
  /**
   * true (default): the listbox is focusable and handles the keys itself. false: another element keeps focus (a
   * select trigger, a combobox input) and forwards its keys to `onKeyDown`.
   */
  focusable?: boolean;
  /** Id of the listbox; option and group ids derive from it. Default from useId. */
  id?: string;
  /**
   * The highlighted option is the selected one (`aria-selected`): a command list, search results. The value then
   * only says what a pick would choose. Default false.
   */
  selectionFollowsFocus?: boolean;
  /**
   * How a focusable listbox selects (React Aria's `selectionBehavior`). `toggle` (default): a click, Enter or Space
   * picks or toggles an option, the arrows only move the highlight. `replace`: a click or an arrow selects that
   * option alone; Ctrl/Cmd+click and Ctrl/Cmd+Space add or remove one, Ctrl/Cmd+arrows only move.
   */
  selectionBehavior?: 'toggle' | 'replace';
}

export interface ListboxState {
  /** The `items` the state was built from. */
  items: SelectItem[];
  /** The options of `items`, flat, in order: the index the getters take is an index into this. */
  options: SelectOption[];
  value: string[];
  setValue: (value: string[]) => void;
  isSelected: (value: string) => boolean;
  /** Picks the option at `index` as a click does: selects it, or toggles it with `multiple` (`toggle` behaviour). */
  select: (index: number) => void;
  /**
   * Selects the options from the anchor (the last option picked) to `index`, replacing the range extended before,
   * as Shift+click does. Only with `multiple`.
   */
  selectRange: (index: number) => void;
  /** Selects every enabled option (Ctrl/Cmd+A). Only with `multiple`. */
  selectAll: () => void;
  /** Index of the highlighted option, -1 for none. */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** The list keys, for the element that keeps focus when `focusable` is false. */
  onKeyDown: (event: KeyboardEvent) => void;
  /** Id of the listbox. */
  id: string;
  /** Id of the option at `index`: the `aria-activedescendant` of the element with focus. */
  getOptionId: (index: number) => string;
  /** The listbox element. With `focusable`, it takes focus and points at the highlighted option. */
  getListboxProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** A group of options: `groupIndex` is the group's index in `items`. */
  getGroupProps: (groupIndex: number, props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** The heading of a group, which names it. */
  getGroupLabelProps: (groupIndex: number, props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** An option: selected state, highlight on pointer move, pick on click. */
  getOptionProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement> & { 'data-index': number; 'data-highlighted': boolean };
}

const NO_VALUE: string[] = [];

export function useListbox({
  items,
  multiple = false,
  value: valueProp,
  defaultValue = NO_VALUE,
  onValueChange,
  onSelect,
  defaultActiveIndex = -1,
  typeahead = true,
  locale,
  focusable = true,
  id: idProp,
  selectionFollowsFocus = false,
  selectionBehavior = 'toggle',
}: ListboxOptions): ListboxState {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const options = useMemo(() => flattenItems(items), [items]);
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const [listRef, setListNode] = useNodeRef();
  // Hover already shows the row; scrolling it into view would make the list jump under the pointer.
  const fromPointer = useRef(false);
  // A row sliding under a still pointer (the list scrolled, a row was added) is not a hover.
  const lastPointer = useRef({ x: NaN, y: NaN });

  // Range selection: the option a range starts from, and where the last range ended (it is replaced when extended).
  const anchor = useRef(-1);
  const rangeEnd = useRef(-1);
  // `replace`: the next highlight move made by a key selects the option it lands on.
  const followFocus = useRef(false);
  const replace = focusable && selectionBehavior === 'replace';
  const isDisabled = (i: number) => !!options[i]?.disabled;
  const setAnchor = (index: number) => {
    anchor.current = index;
    rangeEnd.current = index;
  };
  /** Enabled values from `a` to `b`, either way round. */
  const valuesBetween = (a: number, b: number) =>
    options.slice(Math.max(0, Math.min(a, b)), Math.max(a, b) + 1).flatMap((option) => (option.disabled ? [] : [option.value]));

  const toggle = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (multiple) setValue((prev) => (prev.includes(option.value) ? prev.filter((v) => v !== option.value) : [...prev, option.value]));
    else setValue([option.value]);
    setAnchor(index);
    onSelect?.(index);
  };

  const select = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (!replace) return toggle(index);
    setValue([option.value]);
    setAnchor(index);
    onSelect?.(index);
  };

  const nav = useListNavigation({
    count: options.length,
    isDisabled,
    getLabel: typeahead ? (i) => options[i].label : undefined,
    locale,
    onSelect: select,
    initialIndex: defaultActiveIndex,
  });
  const { activeIndex, setActiveIndex } = nav;

  const selectRange = (index: number) => {
    if (!multiple || !options[index] || options[index].disabled) return;
    if (anchor.current < 0 || anchor.current >= options.length) setAnchor(activeIndex >= 0 ? activeIndex : index);
    const previous = new Set(valuesBetween(anchor.current, rangeEnd.current));
    const range = valuesBetween(anchor.current, index);
    rangeEnd.current = index;
    setValue((prev) => {
      const kept = prev.filter((v) => !previous.has(v));
      return [...kept, ...range.filter((v) => !kept.includes(v))];
    });
  };

  const selectAll = () => {
    if (!multiple) return;
    const enabled = options.flatMap((option) => (option.disabled ? [] : [option.value]));
    setValue((prev) => [...prev, ...enabled.filter((v) => !prev.includes(v))]);
  };

  useEffect(() => {
    if (!followFocus.current) return;
    followFocus.current = false;
    if (activeIndex < 0 || isDisabled(activeIndex)) return;
    setValue([options[activeIndex].value]);
    setAnchor(activeIndex);
  }, [activeIndex]);

  /** Where Shift with a moving key takes the highlight (no wrap at the ends); null for other keys. */
  const shiftTarget = (key: string): number | null => {
    const count = options.length;
    const from = activeIndex;
    const step = (start: number, delta: 1 | -1) => stepIndex(count, start, delta, isDisabled, false);
    switch (key) {
      case 'ArrowDown':
        return step(from, 1);
      case 'ArrowUp':
        return from < 0 ? step(count, -1) : step(from, -1);
      case 'Home':
        return step(-1, 1);
      case 'End':
        return step(count, -1);
      case 'PageDown':
      case 'PageUp': {
        const delta = key === 'PageDown' ? 1 : -1;
        let index = from < 0 ? (delta > 0 ? -1 : count) : from;
        for (let moved = 0; moved < 10; moved++) {
          const next = step(index, delta);
          if (next === index || next < 0) break;
          index = next;
        }
        return index >= 0 && index < count ? index : -1;
      }
      default:
        return null;
    }
  };

  const onListKeyDown = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (multiple) {
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
      if (event.shiftKey && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        if (activeIndex >= 0) selectRange(activeIndex);
        return;
      }
      const target = event.shiftKey && !event.altKey ? shiftTarget(event.key) : null;
      if (target !== null) {
        event.preventDefault();
        if (target >= 0) {
          selectRange(target);
          setActiveIndex(target);
        }
        return;
      }
      // Escape clears a selection first (React Aria's default); a dialog around the list closes on the next press.
      if (event.key === 'Escape' && value.length > 0) {
        event.preventDefault();
        setValue([]);
        setAnchor(-1);
        return;
      }
    }
    if (replace) {
      if (mod && event.key === ' ') {
        event.preventDefault();
        if (activeIndex >= 0) toggle(activeIndex);
        return;
      }
      // Keys that move the highlight select where it lands; with Ctrl/Cmd they only move it.
      const moves = /^(Arrow(Up|Down)|Home|End|Page(Up|Down))$/.test(event.key) || (event.key.length === 1 && event.key !== ' ');
      followFocus.current = moves && !mod;
    }
    nav.onKeyDown(event);
  };

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    const list = listRef.current;
    const option = list?.querySelector(`[data-index="${activeIndex}"]`);
    if (!list || !option) return;
    const rect = option.getBoundingClientRect();
    let top = rect.top;
    // Reaching the first row of a group also reveals the group's label above it.
    const group = option.closest('[role="group"]');
    if (group?.querySelector('[role="option"]') === option && group.firstElementChild !== option) {
      top = Math.min(top, group.firstElementChild?.getBoundingClientRect().top ?? top);
    }
    // Scrolls the list only, never the page: a list below the fold must not pull the page to itself.
    const bounds = list.getBoundingClientRect();
    if (top < bounds.top) list.scrollTop -= bounds.top - top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }, [activeIndex]);

  const isSelected = (v: string) => value.includes(v);
  const getOptionId = (index: number) => optionId(id, index);
  const groupLabelId = (groupIndex: number) => `${id}-group-${groupIndex}`;

  return {
    items,
    options,
    value,
    setValue,
    isSelected,
    select,
    selectRange,
    selectAll,
    activeIndex,
    setActiveIndex,
    onKeyDown: nav.onKeyDown,
    id,
    getOptionId,
    getListboxProps: (props) =>
      withUserProps(
        {
          ref: setListNode,
          id,
          role: 'listbox',
          'aria-multiselectable': multiple || undefined,
          ...(focusable && {
            tabIndex: 0,
            'aria-activedescendant': activeIndex >= 0 ? getOptionId(activeIndex) : undefined,
            onKeyDown: onListKeyDown,
            // Tabbing in highlights the selected option, or the first one.
            onFocus: () => {
              if (activeIndex >= 0) return;
              followFocus.current = false;
              const selected = options.findIndex((option) => value.includes(option.value) && !option.disabled);
              setActiveIndex(selected >= 0 ? selected : firstEnabledIndex(options));
            },
            // The highlight is where the keys act: it goes with focus, and a hover over an unfocused list ends with it.
            onBlur: (event: FocusEvent<HTMLElement>) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveIndex(-1);
            },
            onPointerLeave: (event: PointerEvent<HTMLElement>) => {
              if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) setActiveIndex(-1);
            },
          }),
        },
        props,
      ) as never,
    getGroupProps: (groupIndex, props) => {
      const group = items[groupIndex];
      const labelled = !!group && 'options' in group && group.label !== '';
      return withUserProps({ role: 'group', 'aria-labelledby': labelled ? groupLabelId(groupIndex) : undefined }, props);
    },
    getGroupLabelProps: (groupIndex, props) => withUserProps({ id: groupLabelId(groupIndex), role: 'presentation' }, props),
    getOptionProps: (index, props) => {
      const option = options[index];
      const disabled = !!option?.disabled;
      return withUserProps(
        {
          id: getOptionId(index),
          role: 'option',
          'aria-selected': selectionFollowsFocus ? index === activeIndex : !!option && value.includes(option.value),
          'aria-disabled': disabled || undefined,
          'data-index': index,
          'data-highlighted': index === activeIndex,
          onPointerMove: (event: PointerEvent) => {
            const { x, y } = lastPointer.current;
            lastPointer.current = { x: event.clientX, y: event.clientY };
            if (event.clientX === x && event.clientY === y) return;
            if (disabled || index === activeIndex) return;
            followFocus.current = false;
            fromPointer.current = true;
            setActiveIndex(index);
          },
          onClick: (event: MouseEvent) => {
            if (disabled) return;
            if (focusable && index !== activeIndex) {
              followFocus.current = false;
              fromPointer.current = true;
              setActiveIndex(index);
            }
            if (multiple && focusable && event.shiftKey) selectRange(index);
            else if (replace && (event.ctrlKey || event.metaKey)) toggle(index);
            else select(index);
          },
        },
        props,
      ) as never;
    },
  };
}

/**
 * The ids of a field's `<label for>` elements while its popup is open, so the listbox is named like the field
 * (a listbox without a name fails WCAG 4.1.2). Labels without an id get one derived from `baseId`.
 */
export function useFieldLabelIds(fieldRef: RefObject<HTMLInputElement | HTMLButtonElement | null>, open: boolean, baseId: string) {
  const [ids, setIds] = useState<string>();
  useLayoutEffect(() => {
    if (!open) return;
    const labels = fieldRef.current?.labels;
    const next = labels?.length ? Array.from(labels, (label, i) => label.id || (label.id = `${baseId}-label-${i}`)).join(' ') : undefined;
    setIds((current) => (current === next ? current : next));
  }, [open, fieldRef, baseId]);
  return ids;
}

/** Props of a popup's listbox: named like the field unless the caller names it. */
export function listboxName(props: UserProps | undefined, fieldLabelIds: string | undefined): UserProps | undefined {
  if (props?.['aria-label'] !== undefined || props?.['aria-labelledby'] !== undefined || !fieldLabelIds) return props;
  return { ...props, 'aria-labelledby': fieldLabelIds };
}
