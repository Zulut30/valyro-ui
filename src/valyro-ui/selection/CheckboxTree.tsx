'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cx, mergeRefs, useControllableState } from '../primitives';
import { useFold } from '../primitives/useFold';
import './CheckboxTree.css';
import { inertAttr, withRef } from '../primitives/react-compat';

/** A branch's children that unfold and fold (height and fade), mounted until the fold has played. */
function FoldGroup({ open, readyRef, children }: { open: boolean; readyRef: RefObject<boolean>; children: ReactNode }) {
  const { ref, isMounted, state } = useFold<HTMLUListElement>(open, readyRef);
  if (!isMounted) return null;
  return (
    <ul ref={ref} role="group" className="ui-checkbox-tree__group" data-state={state} inert={inertAttr(state === 'closed' || undefined)}>
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

export type CheckboxTreeState = 'checked' | 'unchecked' | 'mixed';

export interface CheckboxTreeProps extends Omit<ComponentPropsWithRef<'ul'>, 'children' | 'defaultValue' | 'onChange'> {
  /** The tree. */
  nodes: CheckboxTreeNode[];
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

interface Index {
  parent: Map<string, string | undefined>;
  leaves: Map<string, CheckboxTreeNode[]>;
}

function indexTree(nodes: CheckboxTreeNode[]): Index {
  const parent = new Map<string, string | undefined>();
  const leaves = new Map<string, CheckboxTreeNode[]>();
  const visit = (node: CheckboxTreeNode, parentId?: string): CheckboxTreeNode[] => {
    parent.set(node.id, parentId);
    const own = node.children?.length ? node.children.flatMap((child) => visit(child, node.id)) : [node];
    leaves.set(node.id, own);
    return own;
  };
  nodes.forEach((node) => visit(node));
  return { parent, leaves };
}

/** Checked, unchecked or mixed, from the node's leaves. */
export function nodeState(leaves: CheckboxTreeNode[], checked: ReadonlySet<string>): CheckboxTreeState {
  const on = leaves.filter((leaf) => checked.has(leaf.id)).length;
  return on === 0 ? 'unchecked' : on === leaves.length ? 'checked' : 'mixed';
}

/** New checked leaves after toggling a node: all its enabled leaves on, or off when they already are. */
export function toggleNode(leaves: CheckboxTreeNode[], checked: readonly string[]): string[] {
  const enabled = leaves.filter((leaf) => !leaf.disabled).map((leaf) => leaf.id);
  const set = new Set(checked);
  const allOn = enabled.every((id) => set.has(id));
  enabled.forEach((id) => (allOn ? set.delete(id) : set.add(id)));
  return [...set];
}

function visibleNodes(nodes: CheckboxTreeNode[], expanded: ReadonlySet<string>): CheckboxTreeNode[] {
  return nodes.flatMap((node) => [node, ...(node.children?.length && expanded.has(node.id) ? visibleNodes(node.children, expanded) : [])]);
}

export const CheckboxTree = withRef(function CheckboxTree({
  nodes,
  value: valueProp,
  defaultValue,
  onValueChange,
  expanded: expandedProp,
  defaultExpanded,
  onExpandedChange,
  guides = true,
  size = 'md',
  className,
  ref,
  onKeyDown,
  ...rest
}: CheckboxTreeProps) {
  const [value, setValue] = useControllableState<string[]>({ value: valueProp, defaultValue: defaultValue ?? [], onChange: onValueChange });
  const [expandedList, setExpanded] = useControllableState<string[]>({ value: expandedProp, defaultValue: defaultExpanded ?? [], onChange: onExpandedChange });
  const index = useMemo(() => indexTree(nodes), [nodes]);
  const checked = useMemo(() => new Set(value), [value]);
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const visible = useMemo(() => visibleNodes(nodes, expanded), [nodes, expanded]);
  const [focusedId, setFocusedId] = useState<string>();
  const treeRef = useRef<HTMLUListElement>(null);
  // Branches open on the first render show without unfolding; later toggles animate.
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = true;
  }, []);
  const activeId = focusedId && visible.some((n) => n.id === focusedId) ? focusedId : visible[0]?.id;

  const toggleExpanded = (id: string, open = !expanded.has(id)) => {
    if (open === expanded.has(id)) return;
    setExpanded(open ? [...expandedList, id] : expandedList.filter((x) => x !== id));
  };
  const toggleChecked = (node: CheckboxTreeNode) => {
    if (node.disabled) return;
    setValue(toggleNode(index.leaves.get(node.id) ?? [node], value));
  };
  const focusNode = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    const item = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find((el) => el.dataset.id === id);
    item?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(event);
    const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const id = item?.dataset.id;
    if (event.defaultPrevented || !id) return;
    const at = visible.findIndex((n) => n.id === id);
    const node = visible[at];
    const parent = node?.children?.length ? node : undefined;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const key = rtl && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') ? (event.key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft') : event.key;
    let handled = true;
    if (key === 'ArrowDown') focusNode(visible[at + 1]?.id);
    else if (key === 'ArrowUp') focusNode(visible[at - 1]?.id);
    else if (key === 'Home') focusNode(visible[0]?.id);
    else if (key === 'End') focusNode(visible[visible.length - 1]?.id);
    else if (key === 'ArrowRight') {
      if (parent && !expanded.has(id)) toggleExpanded(id, true);
      else if (parent) focusNode(parent.children?.[0]?.id);
    } else if (key === 'ArrowLeft') {
      if (parent && expanded.has(id)) toggleExpanded(id, false);
      else focusNode(index.parent.get(id));
    } else if (key === ' ' || key === 'Enter') toggleChecked(node);
    else handled = false;
    if (handled) event.preventDefault();
  };

  const renderNodes = (list: CheckboxTreeNode[], level: number): ReactNode =>
    list.map((node, position) => {
      const isParent = !!node.children?.length;
      const open = isParent && expanded.has(node.id);
      const state = nodeState(index.leaves.get(node.id) ?? [node], checked);
      return (
        <li
          key={node.id}
          role="treeitem"
          className="ui-checkbox-tree__item"
          data-id={node.id}
          aria-level={level}
          aria-setsize={list.length}
          aria-posinset={position + 1}
          aria-expanded={isParent ? open : undefined}
          aria-checked={state === 'mixed' ? 'mixed' : state === 'checked'}
          aria-disabled={node.disabled || undefined}
          tabIndex={node.id === activeId ? 0 : -1}
          onFocus={(event) => event.target === event.currentTarget && setFocusedId(node.id)}
        >
          <div
            className="ui-checkbox-tree__row"
            data-state={state}
            onClick={() => {
              focusNode(node.id);
              toggleChecked(node);
            }}
          >
            {isParent ? (
              <span
                className="ui-checkbox-tree__toggle"
                data-open={open || undefined}
                aria-hidden="true"
                onClick={(event) => {
                  event.stopPropagation();
                  focusNode(node.id);
                  toggleExpanded(node.id);
                }}
              >
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
            <FoldGroup open={open} readyRef={readyRef}>
              {renderNodes(node.children!, level + 1)}
            </FoldGroup>
          )}
        </li>
      );
    });

  return (
    <ul
      ref={mergeRefs(treeRef, ref)}
      role="tree"
      aria-multiselectable="true"
      className={cx('ui-checkbox-tree', className)}
      data-size={size}
      data-guides={guides || undefined}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {renderNodes(nodes, 1)}
    </ul>
  );
});
