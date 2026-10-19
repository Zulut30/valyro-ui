'use client';

import { useMemo, type ComponentPropsWithRef, type ReactNode } from 'react';
import { collectionPart } from '../primitives/compound';
import { withRef } from '../primitives/react-compat';
import { useLocale } from '../theme/ThemeProvider';
import { useFormField } from '../forms-advanced/form-field-context';
import { FormValue, useMissingValue } from '../forms-advanced/form-value';
import type { SelectItem } from './listbox-items';
import { ListboxView } from './listbox-view';
import { optionsFromParts, type OptionEmptyPartProps, type OptionGroupPartProps, type OptionPartProps } from './option-parts';
import { useListbox } from './useListbox';
import './Listbox.css';

export {
  isOptionGroup,
  flattenItems,
  filterItems,
  matchesQuery,
  firstEnabledIndex,
  optionId,
  type SelectOption,
  type SelectOptionGroup,
  type SelectItem,
} from './listbox-items';
export { useFieldLabelIds } from './useListbox';

export interface ListboxProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** Options, flat or in labelled groups. Or compose them as children: `Listbox.Item`, `Listbox.Group`, `Listbox.Empty`. */
  options?: SelectItem[];
  /** The compound form instead of `options`: `Listbox.Item`, `Listbox.Group` and `Listbox.Empty` elements. */
  children?: ReactNode;
  /** Several options can be selected: checkboxes, Shift ranges, Ctrl/Cmd+A, Escape to clear. */
  multiple?: boolean;
  /** Selected values (at most one without `multiple`), in the order they were picked. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /**
   * `toggle` (default): a click, Enter or Space picks or toggles an option, the arrows only move. `replace`: a click
   * or an arrow selects that option alone, as in a file list; Ctrl/Cmd+click and Ctrl/Cmd+Space add or remove one.
   */
  selectionBehavior?: 'toggle' | 'replace';
  /** Shown instead of the list when there are no options; announced politely. */
  emptyText?: ReactNode;
  /** Submits the selected values with the surrounding form, one hidden input each. */
  name?: string;
  /** At least one option must be selected: `aria-required`, and the surrounding form does not submit without one. */
  required?: boolean;
  /** Every option is disabled and the list leaves the tab order. */
  disabled?: boolean;
  /** Error border and `aria-invalid` (an explicit `aria-invalid` wins). */
  invalid?: boolean;
}

/** An option of the compound form (`Listbox.Item`); its children are the label. */
export const ListboxItem = collectionPart<OptionPartProps>('Listbox.Item');
/** A labelled group of `Listbox.Item`s (`Listbox.Group`). */
export const ListboxGroup = collectionPart<OptionGroupPartProps>('Listbox.Group');
/** Shown when there are no options (`Listbox.Empty`). */
export const ListboxEmpty = collectionPart<OptionEmptyPartProps>('Listbox.Empty');

/**
 * A list of options that stays on the page (WAI-ARIA listbox, React Aria's ListBox): one or several selected, the
 * arrows, Home / End, Page keys and type-ahead move the highlight, and with `multiple` Shift+click and Shift+arrows
 * select ranges. Props not listed go to the listbox element.
 */
export const Listbox = withRef(function Listbox({
  options: optionsProp,
  children,
  multiple = false,
  value: valueProp,
  defaultValue,
  onValueChange,
  selectionBehavior,
  emptyText,
  name,
  required,
  disabled = false,
  invalid = false,
  id,
  className,
  ref,
  'aria-invalid': ariaInvalid,
  ...rest
}: ListboxProps) {
  const field = useFormField();
  const parts = useMemo(() => (optionsProp ? undefined : optionsFromParts(children, ListboxItem, ListboxGroup, ListboxEmpty)), [optionsProp, children]);
  const given = optionsProp ?? parts?.items ?? [];
  // A disabled list disables every option, so neither a click nor a key picks one.
  const items = useMemo(
    () =>
      disabled
        ? given.map((item) => ('options' in item ? { ...item, options: item.options.map((o) => ({ ...o, disabled: true })) } : { ...item, disabled: true }))
        : given,
    [given, disabled],
  );
  // The behaviour is useListbox's (valyro-ui/headless).
  const listbox = useListbox({
    items,
    multiple,
    value: valueProp,
    defaultValue,
    onValueChange,
    selectionBehavior,
    locale: useLocale(),
    id,
  });
  const [missing, markMissing] = useMissingValue(listbox.value.length > 0);
  const isRequired = required ?? field?.required;

  return (
    <>
      <ListboxView
        listbox={listbox}
        indicator={multiple ? 'checkbox' : 'check'}
        emptyState={emptyText ?? parts?.empty}
        listboxProps={{
          // Inside a FormField its label names the list (a `for` pointing at a div names nothing).
          'aria-labelledby': rest['aria-label'] ? undefined : field?.labelId,
          'aria-required': isRequired || undefined,
          'aria-invalid': ariaInvalid ?? (invalid || missing || undefined),
          'aria-disabled': disabled || undefined,
          ...rest,
          tabIndex: disabled ? -1 : rest.tabIndex,
          ref,
          className,
          'data-standalone': '',
        }}
      />
      <FormValue
        name={name}
        values={listbox.value}
        required={isRequired}
        disabled={disabled}
        onMissing={(focus) => {
          markMissing();
          if (focus) document.getElementById(listbox.id)?.focus();
        }}
      />
    </>
  );
}, { Item: ListboxItem, Group: ListboxGroup, Empty: ListboxEmpty });
