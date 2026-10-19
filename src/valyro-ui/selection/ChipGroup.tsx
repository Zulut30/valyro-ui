'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx, useControllableState } from '../primitives';
import { CheckIcon } from '../icons';
import { nextSelection, useGroupName } from './utils';
import './ChipGroup.css';
import { withRef } from '../primitives/react-compat';

export interface ChipGroupItem {
  value: string;
  label: ReactNode;
  /** Icon before the label. */
  icon?: ReactNode;
  /** Number after the label: matching results, unread items. */
  count?: ReactNode;
  disabled?: boolean;
}

export interface ChipGroupProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'defaultValue' | 'onChange'> {
  /** The chips, in order. */
  items: ChipGroupItem[];
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
}

export const ChipGroup = withRef(function ChipGroup({
  items,
  selectionMode = 'multiple',
  value: valueProp,
  defaultValue,
  onValueChange,
  name,
  size = 'md',
  variant = 'soft',
  disabled = false,
  className,
  ...rest
}: ChipGroupProps) {
  const [value, setValue] = useControllableState<string[]>({ value: valueProp, defaultValue: defaultValue ?? [], onChange: onValueChange });
  const groupName = useGroupName(name);
  const single = selectionMode === 'single';
  return (
    <div role={single ? 'radiogroup' : 'group'} className={cx('ui-chip-group', className)} data-size={size} data-variant={variant} {...rest}>
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
});
