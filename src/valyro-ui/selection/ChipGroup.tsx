'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx, useControllableState } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { CheckIcon } from '../icons';
import { useFormField } from '../forms-advanced/form-field-context';
import { nextSelection, useGroupName } from './utils';
import './ChipGroup.css';
import { withRef, useId } from '../primitives/react-compat';

export interface ChipGroupItem {
  value: string;
  label: ReactNode;
  /** Icon before the label. */
  icon?: ReactNode;
  /** Number after the label: matching results, unread items. */
  count?: ReactNode;
  disabled?: boolean;
}

export interface ChipGroupItemPartProps extends Omit<ChipGroupItem, 'label'> {
  /** The chip's label. */
  children?: ReactNode;
}

/** A chip of the compound form (`ChipGroup.Item`; ChipGroupItem is the type of an `items` entry). */
export const ChipGroupItemPart = collectionPart<ChipGroupItemPartProps>('ChipGroup.Item');

export interface ChipGroupProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'defaultValue' | 'onChange'> {
  /** The chips, in order. Or compose them as children: `ChipGroup.Item`. */
  items?: ChipGroupItem[];
  /** The compound form instead of `items`: `ChipGroup.Item` elements. */
  children?: ReactNode;
  /** `multiple`: any number of chips (checkboxes); `single`: one at a time (radios). Default `multiple`. */
  selectionMode?: 'single' | 'multiple';
  /** Selected values (controlled). */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Name of the native inputs, so the selection submits with a form. */
  name?: string;
  /** Chip height and text size. Default `md`. */
  size?: 'sm' | 'md' | 'lg';
  /** `soft`: filled chips; `outline`: bordered chips. Default `soft`. */
  variant?: 'soft' | 'outline';
  /** Disables every chip. */
  disabled?: boolean;
  /**
   * Visible name above the chips, linked to the group. Outside a FormField a group needs a name (this, or an
   * `aria-label` / `aria-labelledby`); inside one, the field's label names it.
   */
  label?: ReactNode;
  /** Error state, e.g. from a FormField: aria-invalid on the group and a danger edge on the chips. */
  invalid?: boolean;
}

export const ChipGroup = withRef(function ChipGroup({
  items: itemsProp,
  children,
  selectionMode = 'multiple',
  value: valueProp,
  defaultValue,
  onValueChange,
  name,
  size = 'md',
  variant = 'soft',
  disabled = false,
  label,
  invalid = false,
  className,
  ...rest
}: ChipGroupProps) {
  const items =
    itemsProp ?? partsOf<ChipGroupItemPartProps>(children, ChipGroupItemPart).map(({ props: { children: label, ...item } }) => ({ ...item, label }));
  const [value, setValue] = useControllableState<string[]>({ value: valueProp, defaultValue: defaultValue ?? [], onChange: onValueChange });
  const groupName = useGroupName(name);
  const single = selectionMode === 'single';
  const field = useFormField();
  const legendId = `${useId()}-legend`;
  // A radiogroup carries aria-required; a group of checkboxes cannot, so the field's "required" joins its description.
  const required = !!field?.required;
  return (
    <div
      role={single ? 'radiogroup' : 'group'}
      className={cx('ui-chip-group', className)}
      data-size={size}
      data-variant={variant}
      data-invalid={invalid || undefined}
      aria-labelledby={label != null ? legendId : rest['aria-label'] ? undefined : field?.labelId}
      aria-invalid={invalid || undefined}
      aria-required={(single && required) || undefined}
      {...rest}
      aria-describedby={cx(rest['aria-describedby'], !single && required && field?.requiredId) || undefined}
    >
      {label != null && (
        <span id={legendId} className="ui-chip-group__legend">
          {label}
        </span>
      )}
      {items.map((item) => {
        const checked = value.includes(item.value);
        const off = disabled || item.disabled;
        return (
          <label key={item.value} className="ui-chip-group__chip" data-checked={checked || undefined} data-disabled={off || undefined}>
            <input
              className="ui-sr-only"
              type={single ? 'radio' : 'checkbox'}
              name={groupName}
              value={item.value}
              checked={checked}
              disabled={off}
              onChange={(event) => setValue(nextSelection(value, item.value, selectionMode, event.target.checked))}
            />
            {/* A chosen chip leads with a check in place of its icon (as Material filter chips do), so the
                choice is not told by colour alone (WCAG 1.4.1). */}
            {(checked || item.icon != null) && (
              <span className="ui-chip-group__icon" data-check={checked || undefined} aria-hidden="true">
                {checked ? <CheckIcon size={16} /> : item.icon}
              </span>
            )}
            <span className="ui-chip-group__label">{item.label}</span>
            {item.count != null && <span className="ui-chip-group__count">{item.count}</span>}
          </label>
        );
      })}
    </div>
  );
}, { Item: ChipGroupItemPart });
