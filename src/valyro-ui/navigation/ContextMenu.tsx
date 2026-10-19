'use client';

import { isValidElement, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { Slot } from '../primitives';
import { collectionPart } from '../primitives/compound';
import type {
  DropdownMenuCheckboxItemProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuTriggerProps,
} from './DropdownMenu';
import { MenuPopup, type MenuItem } from './Menu';
import { menuFromParts, type MenuParts } from './menu-parts';
import { useMenu } from './useMenu';
import { withRef } from '../primitives/react-compat';

/** Native attributes, `style` and `ref` go to the menu surface. */
export interface ContextMenuProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /**
   * The target area. Right-click, long-press, Shift+F10 or the ContextMenu key inside it opens the menu. Or, without
   * `items`, the compound form: a `ContextMenu.Trigger` around the area and the rows (`ContextMenu.Item`,
   * `.CheckboxItem`, `.Label`, `.Separator`).
   */
  children: ReactNode;
  /** Menu rows: actions (with optional submenus), checkboxes, radio groups, separators and labels. */
  items?: MenuItem[];
  /**
   * Controlled open state. A menu opened through this prop (not by the user)
   * appears at `anchorPoint` of the target (its centre by default).
   */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Ignore the opening gestures and keys, so the browser's native context menu appears instead. */
  disabled?: boolean;
  /** `pop` (default): the theme's enter. `spring`: the menu and its submenus spring open and one highlight glides between rows. */
  animation?: 'pop' | 'spring';
  /** Class for the menu surface. */
  className?: string;
  /**
   * Where a menu opened through `open` / `defaultOpen` appears, as fractions of the target's box:
   * `{ x: 0, y: 1 }` is its bottom-left corner. Default: the centre. User gestures open at the pointer.
   */
  anchorPoint?: { x: number; y: number };
}

const CENTRE = { x: 0.5, y: 0.5 };

/** The target area of the compound form (`ContextMenu.Trigger`): a single element. */
export const ContextMenuTrigger = collectionPart<DropdownMenuTriggerProps>('ContextMenu.Trigger');
/** An action row (`ContextMenu.Item`): the props of a MenuActionItem, with the label as children. */
export const ContextMenuItem = collectionPart<DropdownMenuItemProps>('ContextMenu.Item');
/** A row with a checkbox (`ContextMenu.CheckboxItem`). */
export const ContextMenuCheckboxItem = collectionPart<DropdownMenuCheckboxItemProps>('ContextMenu.CheckboxItem');
/** A heading row (`ContextMenu.Label`). */
export const ContextMenuLabel = collectionPart<DropdownMenuLabelProps>('ContextMenu.Label');
/** A divider between groups of rows (`ContextMenu.Separator`). */
export const ContextMenuSeparator = collectionPart<Record<never, never>>('ContextMenu.Separator');

const PARTS: MenuParts = {
  trigger: ContextMenuTrigger,
  item: ContextMenuItem,
  checkboxItem: ContextMenuCheckboxItem,
  label: ContextMenuLabel,
  separator: ContextMenuSeparator,
};

export const ContextMenu = withRef(function ContextMenu({
  children,
  items: itemsProp,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
  anchorPoint = CENTRE,
  ...rest
}: ContextMenuProps) {
  const parts = itemsProp ? undefined : menuFromParts(children, PARTS);
  const items = itemsProp ?? parts?.items ?? [];
  const target = parts ? parts.trigger : isValidElement(children) ? (children as ReactElement) : undefined;
  // The behaviour is useMenu's (valyro-ui/headless): the gestures and keys of the target, the opening point.
  const menu = useMenu({
    items,
    open: openProp,
    defaultOpen,
    onOpenChange,
    targetDisabled: disabled,
    anchorPoint,
    floating: false,
  });

  return (
    <>
      <Slot {...menu.getTargetProps()}>{target}</Slot>
      <MenuPopup
        {...rest}
        open={menu.open}
        anchorRef={menu.anchorRef}
        placement="bottom-start"
        offset={2}
        items={items}
        initialHighlight={menu.highlight}
        onClose={menu.close}
        className={className}
      />
    </>
  );
}, {
  Trigger: ContextMenuTrigger,
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
});
