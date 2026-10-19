'use client';

import { Fragment, type ReactNode } from 'react';
import { CheckIcon } from '../icons';
import type { UserProps } from '../primitives/prop-getters';
import { isOptionGroup, type SelectOption } from './listbox-items';
import type { ListboxState } from './useListbox';
import './Listbox.css';

interface ListboxViewProps {
  /** The state from useListbox (or the owner's: useSelect, useCombobox); its `items` are rendered. */
  listbox: ListboxState;
  /** `check` — trailing checkmark (single select); `checkbox` — leading checkbox (multi select). */
  indicator: 'check' | 'checkbox';
  /** Props of the listbox element: its name, and for the standalone Listbox its class, style and ref. */
  listboxProps?: UserProps;
  /** Shown below the (empty) listbox when there are no options; announced politely when it appears. */
  emptyState?: ReactNode;
}

/**
 * The markup of a useListbox state: the option list of Select, MultiSelect and Combobox (DOM focus stays on the
 * owning trigger or input, the active row is exposed via aria-activedescendant) and of the standalone Listbox.
 */
export function ListboxView({ listbox, indicator, listboxProps, emptyState }: ListboxViewProps) {
  const { items } = listbox;
  let index = -1;
  const renderOption = (option: SelectOption) => {
    index += 1;
    const selected = listbox.isSelected(option.value);
    return (
      <div key={option.value} {...listbox.getOptionProps(index, { className: 'ui-menu-item ui-listbox__option' })}>
        {indicator === 'checkbox' && (
          <span className="ui-listbox__checkbox" data-checked={selected || undefined}>
            <CheckIcon size={12} strokeWidth={3} />
          </span>
        )}
        {option.icon && <span className="ui-menu-item__icon">{option.icon}</span>}
        <span className="ui-listbox__text">
          <span className="ui-menu-item__label">{option.label}</span>
          {option.description && <span className="ui-listbox__description">{option.description}</span>}
        </span>
        {indicator === 'check' && (
          <span className="ui-listbox__check" data-checked={selected || undefined}>
            <CheckIcon />
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <div {...listbox.getListboxProps({ ...listboxProps, className: ['ui-listbox', listboxProps?.className].filter(Boolean).join(' '), 'data-indicator': indicator })}>
        {items.map((item, itemIndex) => {
          if (!isOptionGroup(item)) return renderOption(item);
          return (
            <Fragment key={`${listbox.id}-group-${itemIndex}`}>
              {itemIndex > 0 && <div role="none" className="ui-menu-separator" />}
              <div {...listbox.getGroupProps(itemIndex)}>
                <div {...listbox.getGroupLabelProps(itemIndex, { className: 'ui-menu-label' })}>{item.label}</div>
                {item.options.map(renderOption)}
              </div>
            </Fragment>
          );
        })}
      </div>
      {/* Kept mounted so screen readers announce "No results" / "Loading…" as the list changes. */}
      {emptyState !== undefined && (
        <div role="status" className="ui-listbox__empty">
          {items.length === 0 ? emptyState : null}
        </div>
      )}
    </>
  );
}
