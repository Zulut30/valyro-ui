import type { ReactElement, ReactNode } from 'react';
import { childElements } from '../primitives/compound';
import type { MenuActionItem, MenuCheckboxItem, MenuItem } from './menu-items';

/*
 * The compound form of DropdownMenu and ContextMenu: `.Trigger` and the row parts (`.Item`, `.CheckboxItem`,
 * `.Label`, `.Separator`) become the `trigger` (or target) and `items` of the props form, read while rendering.
 */

/** The part components of one menu. */
export interface MenuParts {
  trigger: unknown;
  item: unknown;
  checkboxItem: unknown;
  label: unknown;
  separator: unknown;
}

type ItemPartProps = Omit<MenuActionItem, 'type' | 'label'> & { children: string };
type CheckboxPartProps = Omit<MenuCheckboxItem, 'type' | 'label'> & { children: string };

export function menuFromParts(children: ReactNode, parts: MenuParts): { trigger?: ReactElement; items: MenuItem[] } {
  const elements = childElements(children);
  const trigger = elements.find((child) => child.type === parts.trigger) as ReactElement<{ children: ReactElement }> | undefined;
  const items = elements.flatMap((child): MenuItem[] => {
    const props = child.props as { children?: ReactNode };
    if (child.type === parts.item) {
      const { children: label, ...item } = props as ItemPartProps;
      return [{ ...item, label }];
    }
    if (child.type === parts.checkboxItem) {
      const { children: label, ...item } = props as CheckboxPartProps;
      return [{ ...item, type: 'checkbox', label }];
    }
    if (child.type === parts.label) return [{ type: 'label', label: props.children as string }];
    if (child.type === parts.separator) return [{ type: 'separator' }];
    return [];
  });
  return { trigger: trigger?.props.children, items };
}
