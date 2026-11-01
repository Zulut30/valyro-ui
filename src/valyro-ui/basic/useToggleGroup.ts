import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { useRovingFocus } from '../primitives/useRovingFocus';
import { nextSelection } from '../primitives/selection';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import type { Direction } from '../primitives/utils';

/*
 * The behaviour of ToggleGroup without its markup: which buttons are pressed (one or several, controlled or
 * not), `aria-pressed` on each, and one tab stop for the group moved with arrows, Home and End (useRovingFocus).
 * Focus never presses anything; Space and Enter press the focused button.
 */

export type ToggleGroupType = 'single' | 'multiple';
/** One value (or null) in `single` mode, a list in `multiple` mode. */
export type ToggleGroupValue<M extends ToggleGroupType> = M extends 'multiple' ? string[] : string | null;

/** An item, as the getters see it. */
export interface ToggleGroupEntry {
  value: string;
  disabled?: boolean;
}

export interface ToggleGroupOptions<M extends ToggleGroupType = 'single'> {
  /** The items in order (their values and disabled flags drive the arrow keys). */
  items: readonly ToggleGroupEntry[];
  /** `single`: at most one pressed; `multiple`: any number. Default `single`. */
  type?: M;
  value?: ToggleGroupValue<M>;
  defaultValue?: ToggleGroupValue<M>;
  onValueChange?: (value: ToggleGroupValue<M>) => void;
  /** `single`: pressing the pressed item releases it, leaving none. Default true. */
  allowEmpty?: boolean;
  /** Arrow keys along the row or the column. Default `horizontal`. */
  orientation?: 'horizontal' | 'vertical';
  /** Arrows wrap from the last item to the first. Default true. */
  loop?: boolean;
  /** Every item is disabled. */
  disabled?: boolean;
  /** Reading direction for Left / Right; read from the element when left out. */
  dir?: Direction;
}

export interface ToggleGroupState<M extends ToggleGroupType = 'single'> {
  value: ToggleGroupValue<M>;
  setValue: (value: ToggleGroupValue<M>) => void;
  /** The pressed values as a list, in either mode. */
  pressed: string[];
  isPressed: (value: string) => boolean;
  /** Presses or releases an item the way a click does. */
  toggle: (value: string) => void;
  /** The element around the items: `role="group"`, orientation. */
  getGroupProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** An item's `<button>`: `aria-pressed`, the roving tab stop, the click. */
  getItemProps: (item: ToggleGroupEntry, props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement> & { 'data-state': 'on' | 'off' };
}

const asList = (value: string | string[] | null | undefined): string[] => (Array.isArray(value) ? value : value == null ? [] : [value]);

export function useToggleGroup<M extends ToggleGroupType = 'single'>({
  items,
  type,
  value: valueProp,
  defaultValue,
  onValueChange,
  allowEmpty = true,
  orientation = 'horizontal',
  loop = true,
  disabled = false,
  dir,
}: ToggleGroupOptions<M>): ToggleGroupState<M> {
  const multiple = type === 'multiple';
  const [value, setValue] = useControllableState<ToggleGroupValue<M>>({
    value: valueProp,
    defaultValue: (defaultValue ?? (multiple ? [] : null)) as ToggleGroupValue<M>,
    onChange: onValueChange,
  });
  const pressed = asList(value);
  const isDisabled = (index: number) => disabled || !!items[index]?.disabled;
  const roving = useRovingFocus({
    count: items.length,
    orientation,
    loop,
    dir,
    isDisabled,
    preferredIndex: items.findIndex((item) => pressed.includes(item.value)),
  });

  const toggle = (itemValue: string) =>
    setValue((prev) => {
      const current = asList(prev);
      const on = current.includes(itemValue);
      if (multiple) return nextSelection(current, itemValue, 'multiple', !on) as ToggleGroupValue<M>;
      if (on) return (allowEmpty ? null : prev) as ToggleGroupValue<M>;
      return itemValue as ToggleGroupValue<M>;
    });

  return {
    value,
    setValue,
    pressed,
    isPressed: (itemValue) => pressed.includes(itemValue),
    toggle,
    getGroupProps: (props) =>
      withUserProps({ role: 'group', 'data-orientation': orientation, 'aria-disabled': disabled || undefined }, props) as never,
    getItemProps: (item, props) => {
      const index = items.findIndex((entry) => entry.value === item.value);
      const on = pressed.includes(item.value);
      const off = disabled || !!item.disabled;
      return withUserProps(
        {
          ...roving.getItemProps(index),
          type: 'button',
          'aria-pressed': on,
          'data-state': on ? 'on' : 'off',
          disabled: off || undefined,
          onClick: () => toggle(item.value),
        },
        props,
      ) as never;
    },
  };
}
