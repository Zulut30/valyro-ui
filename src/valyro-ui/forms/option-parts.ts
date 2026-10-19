import type { ReactElement, ReactNode } from 'react';
import { childElements, partsOf } from '../primitives/compound';
import type { SelectItem, SelectOption } from './listbox-items';

/*
 * The compound form of the option lists (Select, MultiSelect, Combobox): `.Item` and `.Group` children become the
 * `options` the props form takes, `.Empty` the empty state. Read while rendering, so both forms give the same markup.
 */

export interface OptionPartProps extends Omit<SelectOption, 'label'> {
  /** The option's label (plain text: filtering, type-ahead and the field show it). */
  children: string;
}

export interface OptionGroupPartProps {
  /** Heading of the group. */
  label: string;
  /** Its `.Item` elements. */
  children?: ReactNode;
}

export interface OptionEmptyPartProps {
  /** Shown in the popup when no option is there to show. */
  children?: ReactNode;
}

/** The options of `.Item` / `.Group` children, and the content of an `.Empty` child (undefined without one). */
export function optionsFromParts(
  children: ReactNode,
  itemPart: unknown,
  groupPart: unknown,
  emptyPart?: unknown,
): { items: SelectItem[]; empty?: ReactNode } {
  const option = ({ props: { children: label, ...rest } }: ReactElement<OptionPartProps>): SelectOption => ({ ...rest, label });
  let empty: ReactNode;
  const items = childElements(children).flatMap((child): SelectItem[] => {
    if (child.type === itemPart) return [option(child as ReactElement<OptionPartProps>)];
    if (emptyPart !== undefined && child.type === emptyPart) empty = (child.props as OptionEmptyPartProps).children ?? null;
    if (child.type !== groupPart) return [];
    const { label, children: groupChildren } = (child as ReactElement<OptionGroupPartProps>).props;
    return [{ label, options: partsOf<OptionPartProps>(groupChildren, itemPart).map(option) }];
  });
  return { items, empty };
}
