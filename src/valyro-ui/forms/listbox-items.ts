import type { ReactNode } from 'react';

/*
 * The option model of Select, MultiSelect, Combobox and the headless listbox hooks: options, labelled groups and
 * the helpers that flatten and filter them. No React, no CSS, so useListbox and the components share it.
 */

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

/** A single option or a labelled group of options. */
export type SelectItem = SelectOption | SelectOptionGroup;

export function isOptionGroup(item: SelectItem): item is SelectOptionGroup {
  return 'options' in item;
}

export function flattenItems(items: SelectItem[]): SelectOption[] {
  return items.flatMap((item) => (isOptionGroup(item) ? item.options : [item]));
}

/** Keeps matching options; groups left without options are dropped. */
export function filterItems(items: SelectItem[], keep: (option: SelectOption) => boolean): SelectItem[] {
  const out: SelectItem[] = [];
  for (const item of items) {
    if (!isOptionGroup(item)) {
      if (keep(item)) out.push(item);
      continue;
    }
    const options = item.options.filter(keep);
    if (options.length) out.push({ ...item, options });
  }
  return out;
}

export function matchesQuery(option: SelectOption, query: string) {
  return option.label.toLowerCase().includes(query.trim().toLowerCase());
}

export function firstEnabledIndex(options: SelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

export const optionId = (listId: string, index: number) => `${listId}-option-${index}`;
