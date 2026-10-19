import type { ReactNode } from 'react';

/*
 * The row model of DropdownMenu, ContextMenu and useMenu (public types). No React, no CSS, so the headless hook
 * and the components share it.
 */

export interface MenuActionItem {
  type?: 'item';
  label: string;
  icon?: ReactNode;
  /** Shortcut hint shown on the right, e.g. "⌘C". Display only. */
  shortcut?: string;
  /** Renders the row as a link. */
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Child items shown in a submenu that opens on hover or ArrowRight (ArrowLeft in RTL). */
  items?: MenuItem[];
}

export interface MenuCheckboxItem {
  type: 'checkbox';
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export interface MenuRadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MenuRadioGroup {
  type: 'radio';
  /** Heading shown above the options. */
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: MenuRadioOption[];
}

export interface MenuSeparatorItem {
  type: 'separator';
}

/** Heading of a section: the rows after it, up to the next separator or label, form a group it names. */
export interface MenuLabelItem {
  type: 'label';
  label: string;
}

export type MenuItem = MenuActionItem | MenuCheckboxItem | MenuRadioGroup | MenuSeparatorItem | MenuLabelItem;
