'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode, type RefObject } from 'react';
import { cx } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { useFold } from '../primitives/useFold';
import { useCheckboxTree, type CheckboxTreeState } from './useCheckboxTree';
import './CheckboxTree.css';
import { inertAttr, withRef } from '../primitives/react-compat';

export { nodeState, toggleNode, type CheckboxTreeState } from './useCheckboxTree';

/** A branch's children that unfold and fold (height and fade), mounted until the fold has played. */
function FoldGroup({ open, readyRef, groupProps, children }: { open: boolean; readyRef: RefObject<boolean>; groupProps: object; children: ReactNode }) {
  const { ref, isMounted, state, cssFold } = useFold<HTMLUListElement>(open, readyRef);
  if (!isMounted) return null;
  return (
    <ul ref={ref} {...groupProps} className="ui-checkbox-tree__group" data-state={state} data-ui-fold={cssFold} inert={inertAttr(state === 'closed' || undefined)}>
      {children}
    </ul>
  );
}

export interface CheckboxTreeNode {
  id: string;
  label: ReactNode;
  /** Icon before the label: a folder, a file, a person. */
  icon?: ReactNode;
  /** Child nodes; a node without children is a leaf. */
  children?: CheckboxTreeNode[];
  /** Can't be toggled; a parent's toggle skips it. */
  disabled?: boolean;
}

export interface CheckboxTreeProps extends Omit<ComponentPropsWithRef<'ul'>, 'children' | 'defaultValue' | 'onChange'> {
  /** The tree. Or compose it as children: `CheckboxTree.Item` elements, nested for branches. */
  nodes?: CheckboxTreeNode[];
  /** The compound form instead of `nodes`: `CheckboxTree.Item` elements. */
  children?: ReactNode;
  /** Ids of the checked leaves (controlled); parents show checked, mixed or unchecked from them. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Ids of the expanded parents (controlled). */
  expanded?: string[];
  defaultExpanded?: string[];
  onExpandedChange?: (expanded: string[]) => void;
  /** Connector lines from each parent to its children. Default true. */
  guides?: boolean;
  /** Row height. Default `md`. */
  size?: 'sm' | 'md';
}

export interface CheckboxTreeItemProps {
  /** Id of the node, used by `value` and `expanded`. */
  id: string;
  label: ReactNode;
  /** Icon before the label: a folder, a file, a person. */
  icon?: ReactNode;
  /** Can't be toggled; a parent's toggle skips it. */
  disabled?: boolean;
  /** Nested `CheckboxTree.Item` elements: the branch's children. */
  children?: ReactNode;
}

/** A node of the compound form (`CheckboxTree.Item`), nested inside another for a branch. */
export const CheckboxTreeItem = collectionPart<CheckboxTreeItemProps>('CheckboxTree.Item');

function nodesFromParts(children: ReactNode): CheckboxTreeNode[] {
  return partsOf<CheckboxTreeItemProps>(children, CheckboxTreeItem).map(({ props }) => {
    const nested = nodesFromParts(props.children);
    return { id: props.id, label: props.label, icon: props.icon, disabled: props.disabled, children: nested.length > 0 ? nested : undefined };
  });
}

export const CheckboxTree = withRef(function CheckboxTree({
  nodes: nodesProp,
  children,
  value,
  defaultValue,
  onValueChange,
  expanded,
  defaultExpanded,
  onExpandedChange,
  guides = true,
  size = 'md',
  className,
  ref,
  onKeyDown,
  ...rest
}: CheckboxTreeProps) {
  const nodes = nodesProp ?? nodesFromParts(children);
  // The checked leaves, the open branches, the tab stop and the keys come from the headless hook.
  const tree = useCheckboxTree({ nodes, value, defaultValue, onValueChange, expanded, defaultExpanded, onExpandedChange });
  // Branches open on the first render show without unfolding; later toggles animate.
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = true;
  }, []);

  const renderNodes = (list: CheckboxTreeNode[]): ReactNode =>
    list.map((node) => {
      const isParent = !!node.children?.length;
      const open = isParent && tree.isExpanded(node.id);
      const state: CheckboxTreeState = tree.getCheckState(node.id);
      return (
        <li key={node.id} className="ui-checkbox-tree__item" data-id={node.id} {...tree.getItemProps(node)}>
          <div className="ui-checkbox-tree__row" {...tree.getRowProps(node)}>
            {isParent ? (
              <span className="ui-checkbox-tree__toggle" {...tree.getToggleProps(node)}>
                <svg viewBox="0 0 24 24">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            ) : (
              <span className="ui-checkbox-tree__toggle" aria-hidden="true" />
            )}
            <span className="ui-checkbox-tree__box" data-state={state} aria-hidden="true">
              <svg viewBox="0 0 24 24">{state === 'mixed' ? <path d="M6 12h12" /> : <path d="M5 12.5l4.5 4.5L19 7.5" />}</svg>
            </span>
            {node.icon != null && (
              <span className="ui-checkbox-tree__icon" aria-hidden="true">
                {node.icon}
              </span>
            )}
            <span className="ui-checkbox-tree__label">{node.label}</span>
          </div>
          {isParent && (
            <FoldGroup open={open} readyRef={readyRef} groupProps={tree.getGroupProps(node)}>
              {renderNodes(node.children!)}
            </FoldGroup>
          )}
        </li>
      );
    });

  return (
    <ul
      className={cx('ui-checkbox-tree', className)}
      data-size={size}
      data-guides={guides || undefined}
      {...tree.getTreeProps({ onKeyDown, ref, ...rest })}
    >
      {renderNodes(nodes)}
    </ul>
  );
}, { Item: CheckboxTreeItem });
