'use client';

import { useMemo, type ComponentPropsWithRef, type ReactNode } from 'react';
import { ChevronsUpDownIcon } from '../icons';
import { cx, Floating, useAnnounceCount } from '../primitives';
import { collectionPart } from '../primitives/compound';
import { Spinner } from '../basic/Spinner';
import type { SelectItem, SelectOption } from './listbox-items';
import { ListboxView } from './listbox-view';
import { optionsFromParts, type OptionEmptyPartProps, type OptionGroupPartProps, type OptionPartProps } from './option-parts';
import { useCombobox } from './useCombobox';
import { useFormField } from '../forms-advanced/form-field-context';
import { useLocale } from '../theme/ThemeProvider';
import './Combobox.css';
import { withRef } from '../primitives/react-compat';

export interface ComboboxLabels {
  /** Popover text while `loading` and no options are shown. */
  loading: string;
  /** Popover hint with `allowCustomValue` when the typed text matches nothing. */
  useCustomValue: (text: string) => string;
  /** Accessible name of the chevron button. */
  toggleSuggestions: string;
  /** Read to screen readers when the list opens or the typing pauses, e.g. "5 results available". */
  resultCount?: (count: number) => string;
}

export const defaultComboboxLabels: Required<ComboboxLabels> = {
  loading: 'Loading…',
  useCustomValue: (text) => `Press Enter to use “${text}”`,
  toggleSuggestions: 'Show suggestions',
  resultCount: (count) => `${count} ${count === 1 ? 'result' : 'results'} available`,
};

export interface ComboboxProps
  extends Omit<ComponentPropsWithRef<'input'>, 'value' | 'defaultValue' | 'onChange' | 'size' | 'type' | 'role'> {
  /**
   * Suggestions, flat or in labelled groups; filtered by the typed text unless `filter={false}`. Or compose them as
   * children: `Combobox.Item`, `Combobox.Group`, `Combobox.Empty`.
   */
  options?: SelectItem[];
  /** The compound form instead of `options`: `Combobox.Item`, `Combobox.Group` and `Combobox.Empty` elements. */
  children?: ReactNode;
  /** Selected option value (or the typed text with `allowCustomValue`); empty string means none. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Text in the input. Control it together with `filter={false}` to load options asynchronously. */
  inputValue?: string;
  defaultInputValue?: string;
  /** Called with the text whenever the input changes (typing, picking an option, clearing). */
  onInputValueChange?: (text: string) => void;
  /**
   * Same as `onInputValueChange`.
   * @deprecated Use `onInputValueChange`, the library's `onXxxChange` name.
   */
  onInputChange?: (text: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Custom matcher, or `false` when `options` are already filtered (e.g. by a server). Default: the label contains
   * the text, ignoring case and accents for the ThemeProvider locale ("e" finds "é", as React Aria's useFilter).
   */
  filter?: false | ((option: SelectOption, query: string) => boolean);
  /** Shows a spinner in the field, sets aria-busy, and replaces the empty state with a loading message. */
  loading?: boolean;
  /** Shown in the popover when no option matches (unless `allowCustomValue` offers the typed text). Or `Combobox.Empty`. */
  emptyText?: ReactNode;
  labels?: Partial<ComboboxLabels>;
  /** Typed text that matches no option is kept as the value on Enter / blur. */
  allowCustomValue?: boolean;
  /** Field height and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Error border and aria-invalid on the input (an explicit `aria-invalid` wins). */
  invalid?: boolean;
  /** Icon inside the field, before the text. */
  leftIcon?: ReactNode;
}

const NO_OPTIONS: SelectItem[] = [];

/** A suggestion of the compound form (`Combobox.Item`). */
export const ComboboxItem = collectionPart<OptionPartProps>('Combobox.Item');
/** A labelled group of `Combobox.Item`s (`Combobox.Group`). */
export const ComboboxGroup = collectionPart<OptionGroupPartProps>('Combobox.Group');
/** The popover content while nothing matches (`Combobox.Empty`, the `emptyText` prop). */
export const ComboboxEmpty = collectionPart<OptionEmptyPartProps>('Combobox.Empty');

/** Editable combobox with list autocomplete. Props not listed go to the <input>; `name` submits the value. */
export const Combobox = withRef(function Combobox({
  options: optionsProp,
  children,
  value,
  defaultValue,
  onValueChange,
  inputValue,
  defaultInputValue,
  onInputValueChange,
  onInputChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  filter: filterProp,
  loading = false,
  emptyText: emptyTextProp,
  labels: labelsProp,
  allowCustomValue = false,
  size = 'md',
  invalid = false,
  leftIcon,
  name,
  disabled,
  readOnly,
  className,
  style,
  ref,
  'aria-invalid': ariaInvalid,
  ...rest
}: ComboboxProps) {
  // FormField's `required` only marks its label (aria-hidden); announce it on the control.
  const field = useFormField();
  const parts = useMemo(
    () => (optionsProp ? undefined : optionsFromParts(children, ComboboxItem, ComboboxGroup, ComboboxEmpty)),
    [optionsProp, children],
  );
  const options = optionsProp ?? parts?.items ?? NO_OPTIONS;
  const emptyText = emptyTextProp ?? parts?.empty ?? 'No results';
  const labels = { ...defaultComboboxLabels, ...labelsProp };
  // The behaviour is useCombobox's (valyro-ui/headless); the popover is a Floating, which positions and dismisses it.
  const combobox = useCombobox({
    items: options,
    value,
    defaultValue,
    onValueChange,
    inputValue,
    defaultInputValue,
    onInputValueChange:
      onInputValueChange || onInputChange
        ? (next) => {
            onInputValueChange?.(next);
            onInputChange?.(next);
          }
        : undefined,
    open: openProp,
    defaultOpen,
    onOpenChange,
    filter: filterProp,
    // The default filter compares as the locale does: case and accents ignored ("e" finds "é").
    locale: useLocale(),
    allowCustomValue,
    disabled,
    readOnly,
    floating: false,
  });
  const { open } = combobox;
  // How many suggestions there are is read out when the list opens and each time typing pauses.
  useAnnounceCount(combobox.listbox.options.filter((option) => !option.disabled).length, {
    active: open && !loading,
    message: labels.resultCount,
    key: combobox.query,
  });
  const text = combobox.inputValue;
  const { ref: fieldRef, ...fieldProps } = combobox.getFieldProps();

  const showEmpty = loading ? (
    <>
      <Spinner size={14} label={null} />
      {labels.loading}
    </>
  ) : allowCustomValue && text.trim() ? (
    labels.useCustomValue(text.trim())
  ) : (
    emptyText
  );

  return (
    <div
      {...fieldProps}
      ref={fieldRef}
      className={cx('ui-field', 'ui-combobox', className)}
      style={style}
      data-size={size}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
      data-open={open || undefined}
    >
      {leftIcon && <span className="ui-field__icon">{leftIcon}</span>}
      <input
        {...combobox.getInputProps({
          'aria-invalid': ariaInvalid ?? (invalid || undefined),
          'aria-busy': loading || undefined,
          'aria-required': field?.required || undefined,
          ...rest,
          ref,
          className: 'ui-field__input ui-combobox__input',
        })}
      />
      {loading && <Spinner size={14} label={null} className="ui-combobox__spinner" />}
      <button {...combobox.getToggleButtonProps({ 'aria-label': labels.toggleSuggestions, className: 'ui-combobox__toggle' })}>
        <ChevronsUpDownIcon />
      </button>
      {name && <input type="hidden" name={name} value={combobox.value} disabled={disabled} />}
      <Floating
        open={open && !disabled && !readOnly}
        anchorRef={combobox.anchorRef}
        placement="bottom-start"
        offset={6}
        matchAnchorWidth
        onDismiss={combobox.close}
        {...combobox.getPopupProps({ className: 'ui-listbox__popover' })}
      >
        <ListboxView
          listbox={combobox.listbox}
          indicator="check"
          listboxProps={{ 'aria-label': rest['aria-label'], 'aria-labelledby': rest['aria-labelledby'] }}
          emptyState={showEmpty}
        />
      </Floating>
    </div>
  );
}, { Item: ComboboxItem, Group: ComboboxGroup, Empty: ComboboxEmpty });
