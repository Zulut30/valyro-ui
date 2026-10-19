'use client';

import { Fragment, useMemo, type ComponentPropsWithRef, type ReactNode } from 'react';
import { ChevronDownIcon } from '../icons';
import { cx, Floating } from '../primitives';
import { collectionPart } from '../primitives/compound';
import { isOptionGroup, type SelectItem, type SelectOption } from './listbox-items';
import { ListboxView } from './listbox-view';
import { optionsFromParts } from './option-parts';
import { useSelect } from './useSelect';
import { useFormField } from '../forms-advanced/form-field-context';
import { FormValue, useMissingValue } from '../forms-advanced/form-value';
import { useLocale } from '../theme/ThemeProvider';
import './Select.css';
import { withRef } from '../primitives/react-compat';

export interface SelectProps
  extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'type'> {
  /** Options to pick from, flat or in labelled groups. Or compose them as children: `Select.Item`, `Select.Group`. */
  options?: SelectItem[];
  /** The compound form instead of `options`: `Select.Item` and `Select.Group` elements. */
  children?: ReactNode;
  /** Selected option value; an empty string means nothing is selected. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Trigger text while nothing is selected. */
  placeholder?: string;
  /** Shown in the popover when `options` is empty. */
  emptyText?: ReactNode;
  /** Trigger height and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Error border and aria-invalid on the trigger (an explicit `aria-invalid` wins). */
  invalid?: boolean;
  /** Submits the value with the surrounding form (a hidden input, or the native select's own value). */
  name?: string;
  /**
   * Renders a native `<select>` in the same field look: the phone's own wheel or sheet, the browser's form
   * validation (`required`) and autofill (`autoComplete`). `ref` and the other props then go to the `<select>`;
   * option icons and descriptions are not shown in its list.
   */
  native?: boolean;
  /** A value is required: `aria-required`, and the surrounding form does not submit without one. */
  required?: boolean;
  /** Autofill hint of the native select, e.g. `country` (with `native`). */
  autoComplete?: string;
}

export interface SelectItemPartProps extends Omit<SelectOption, 'label'> {
  /** The option's label (plain text: type-ahead and the trigger show it). */
  children: string;
}

export interface SelectGroupPartProps {
  /** Heading of the group. */
  label: string;
  /** Its `Select.Item` elements. */
  children?: ReactNode;
}

/** An option of the compound form (`Select.Item`; SelectItem is the type of an `options` entry). */
export const SelectItemPart = collectionPart<SelectItemPartProps>('Select.Item');
/** A labelled group of `Select.Item`s (`Select.Group`). */
export const SelectGroupPart = collectionPart<SelectGroupPartProps>('Select.Group');

/** Select-only combobox: a field-styled trigger that opens a listbox. Props not listed go to the trigger button. */
export const Select = withRef(function Select({
  options: optionsProp,
  children,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  placeholder = 'Select…',
  emptyText = 'No options',
  size = 'md',
  invalid = false,
  name,
  native = false,
  required,
  autoComplete,
  disabled,
  className,
  style,
  ref,
  'aria-invalid': ariaInvalid,
  ...rest
}: SelectProps) {
  // FormField's `required` only marks its label (aria-hidden); announce it on the control.
  const field = useFormField();
  const options = useMemo(() => optionsProp ?? optionsFromParts(children, SelectItemPart, SelectGroupPart).items, [optionsProp, children]);
  // The behaviour is useSelect's (valyro-ui/headless); the popup is a Floating, which positions and dismisses it.
  const select = useSelect({
    items: options,
    value: valueProp,
    defaultValue,
    onValueChange,
    open: openProp,
    defaultOpen,
    onOpenChange,
    floating: false,
    locale: useLocale(),
    native,
  });
  const { open } = select;
  const selected = select.selected[0];
  // After `required` blocked a submit, the field shows as invalid until a value is picked.
  const [missing, markMissing] = useMissingValue(!!selected);
  const invalidAttr = ariaInvalid ?? (invalid || missing || undefined);

  if (native) {
    // The field look sits on a wrapper; the select fills it, the icon and chevron are drawn over it.
    const renderOption = (option: SelectOption) => (
      <option key={option.value} value={option.value} disabled={option.disabled}>
        {option.label}
      </option>
    );
    return (
      <span
        className={cx('ui-field', 'ui-select', className)}
        style={style}
        data-native=""
        data-size={size}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        data-placeholder={selected ? undefined : ''}
        data-icon={selected?.icon ? '' : undefined}
      >
        {selected?.icon && <span className="ui-field__icon ui-select__icon">{selected.icon}</span>}
        <select
          aria-invalid={invalidAttr}
          aria-required={(!required && field?.required) || undefined}
          {...select.getNativeSelectProps({
            ...rest,
            ref,
            name,
            required,
            autoComplete,
            disabled,
            className: 'ui-select__native',
          })}
        >
          {/* Shown in the field while nothing is selected, not in the list: it cannot be picked back, `required` holds. */}
          <option value="" disabled hidden>
            {placeholder}
          </option>
          {options.map((item, index) =>
            isOptionGroup(item) ? (
              <optgroup key={`group-${index}`} label={item.label}>
                {item.options.map(renderOption)}
              </optgroup>
            ) : (
              <Fragment key={item.value}>{renderOption(item)}</Fragment>
            ),
          )}
        </select>
        <ChevronDownIcon className="ui-select__chevron" />
      </span>
    );
  }

  return (
    <>
      <button
        {...select.getTriggerProps({
          'aria-invalid': invalidAttr,
          'aria-required': (required ?? field?.required) || undefined,
          ...rest,
          ref,
          disabled,
          style,
          className: cx('ui-field', 'ui-select', className),
          'data-size': size,
          'data-invalid': invalid || missing || undefined,
          'data-disabled': disabled || undefined,
          'data-open': open || undefined,
          'data-placeholder': selected ? undefined : '',
        })}
      >
        {selected?.icon && <span className="ui-field__icon ui-select__icon">{selected.icon}</span>}
        <span className="ui-select__value">{selected ? selected.label : placeholder}</span>
        <ChevronDownIcon className="ui-select__chevron" />
      </button>
      {name && <input type="hidden" name={name} value={select.value} disabled={disabled} form={rest.form} />}
      <FormValue
        values={[select.value]}
        required={required}
        disabled={disabled}
        onMissing={(focus) => {
          markMissing();
          if (focus) select.triggerRef.current?.focus();
        }}
      />
      <Floating
        open={open && !disabled}
        anchorRef={select.triggerRef}
        placement="bottom-start"
        offset={6}
        matchAnchorWidth
        onDismiss={(reason) => select.close(reason === 'escape')}
        {...select.getPopupProps({ className: 'ui-listbox__popover' })}
      >
        <ListboxView
          listbox={select.listbox}
          indicator="check"
          listboxProps={{ 'aria-label': rest['aria-label'], 'aria-labelledby': rest['aria-labelledby'] }}
          emptyState={emptyText}
        />
      </Floating>
    </>
  );
}, { Item: SelectItemPart, Group: SelectGroupPart });
