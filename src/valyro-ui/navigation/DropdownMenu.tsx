'use client';

import { type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { Slot, type Placement } from '../primitives';
import { collectionPart } from '../primitives/compound';
import { menuFromParts, type MenuParts } from './menu-parts';
import { MenuPopup, type MenuActionItem, type MenuCheckboxItem, type MenuItem } from './Menu';
import { useMenu } from './useMenu';
import { withRef } from '../primitives/react-compat';

/** Native attributes, `style` and `ref` go to the menu surface. */
export interface DropdownMenuProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** A single focusable element, usually a Button. Receives the menu-button ARIA and handlers. Or `DropdownMenu.Trigger`. */
  trigger?: ReactElement;
  /**
   * Menu rows: actions (with optional submenus), checkboxes, radio groups, separators and labels. Or compose them as
   * children: `DropdownMenu.Item`, `.CheckboxItem`, `.Label`, `.Separator`.
   */
  items?: MenuItem[];
  /** The compound form: a `DropdownMenu.Trigger` and the rows, instead of `trigger` and `items`. */
  children?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Preferred side and alignment relative to the trigger; flips when there is no room. */
  placement?: Placement;
  /** `pop` (default): the theme's enter. `spring`: the menu and its submenus spring open and one highlight glides between rows. */
  animation?: 'pop' | 'spring';
  /** Class for the menu surface. */
  className?: string;
}

export interface DropdownMenuTriggerProps {
  /** A single focusable element, usually a Button. */
  children: ReactElement;
}

export interface DropdownMenuItemProps extends Omit<MenuActionItem, 'type' | 'label'> {
  /** The row's label (plain text: type-ahead reads it). */
  children: string;
}

export interface DropdownMenuCheckboxItemProps extends Omit<MenuCheckboxItem, 'type' | 'label'> {
  /** The row's label. */
  children: string;
}

export interface DropdownMenuLabelProps {
  /** Heading text of the rows that follow. */
  children: string;
}

/** The element that opens the menu (`DropdownMenu.Trigger`). */
export const DropdownMenuTrigger = collectionPart<DropdownMenuTriggerProps>('DropdownMenu.Trigger');
/** An action row (`DropdownMenu.Item`): the props of a MenuActionItem, with the label as children. */
export const DropdownMenuItem = collectionPart<DropdownMenuItemProps>('DropdownMenu.Item');
/** A row with a checkbox (`DropdownMenu.CheckboxItem`). */
export const DropdownMenuCheckboxItem = collectionPart<DropdownMenuCheckboxItemProps>('DropdownMenu.CheckboxItem');
/** A heading row (`DropdownMenu.Label`). */
export const DropdownMenuLabel = collectionPart<DropdownMenuLabelProps>('DropdownMenu.Label');
/** A divider between groups of rows (`DropdownMenu.Separator`). */
export const DropdownMenuSeparator = collectionPart<Record<never, never>>('DropdownMenu.Separator');

const PARTS: MenuParts = {
  trigger: DropdownMenuTrigger,
  item: DropdownMenuItem,
  checkboxItem: DropdownMenuCheckboxItem,
  label: DropdownMenuLabel,
  separator: DropdownMenuSeparator,
};

export const DropdownMenu = withRef(function DropdownMenu({
  trigger: triggerProp,
  items: itemsProp,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom-start',
  className,
  ...rest
}: DropdownMenuProps) {
  const parts = triggerProp && itemsProp ? undefined : menuFromParts(children, PARTS);
  const trigger = triggerProp ?? parts?.trigger;
  const items = itemsProp ?? parts?.items ?? [];
  // The behaviour is useMenu's (valyro-ui/headless): the menu button here, the rows in each MenuPopup level.
  const menu = useMenu({ items, open: openProp, defaultOpen, onOpenChange, floating: false });
  const triggerId = (trigger?.props as { id?: string } | undefined)?.id ?? `${menu.menuId}-trigger`;

  return (
    <>
      <Slot {...menu.getTriggerProps({ id: triggerId })}>{trigger}</Slot>
      <MenuPopup
        {...rest}
        id={menu.menuId}
        open={menu.open}
        anchorRef={menu.anchorRef}
        placement={placement}
        offset={6}
        items={items}
        initialHighlight={menu.highlight}
        onClose={menu.close}
        // The trigger names the menu unless the caller names it (aria-labelledby would outrank an aria-label).
        aria-labelledby={rest['aria-labelledby'] ?? (rest['aria-label'] ? undefined : triggerId)}
        className={className}
      />
    </>
  );
}, {
  Trigger: DropdownMenuTrigger,
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
});
