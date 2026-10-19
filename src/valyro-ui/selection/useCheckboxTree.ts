'use client';

import { useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type RefCallback } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { getDirection, inlineArrowStep } from '../primitives/utils';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { flattenVisible, parentMap, type TreeNodeBase, type VisibleNode } from '../data-display/tree';

/*
 * The behaviour of CheckboxTree without its markup: checked leaves and expanded branches (each controlled or not),
 * a branch's state from its leaves (checked, mixed or unchecked), toggling a branch toggles its enabled leaves, a
 * roving tab stop and the tree keys: ↑/↓, Home / End, → opens a branch and then enters it, ← closes it and then
 * goes to the parent (both mirrored under dir="rtl"), Space / Enter check. CheckboxTree renders with it.
 */

export type CheckboxTreeState = 'checked' | 'unchecked' | 'mixed';

export interface CheckboxTreeOptions<N extends TreeNodeBase = TreeNodeBase> {
  /** Root nodes; a node with `children` is a branch, one without is a leaf. */
  nodes: readonly N[];
  /** Ids of the checked leaves; branches show checked, mixed or unchecked from them. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Ids of the expanded branches. */
  expanded?: string[];
  defaultExpanded?: string[];
  onExpandedChange?: (expanded: string[]) => void;
}

export interface CheckboxTreeHookState<N extends TreeNodeBase = TreeNodeBase> {
  value: string[];
  expanded: string[];
  /** The rows on screen, depth first: children only under expanded branches. */
  visible: VisibleNode<N>[];
  isExpanded: (id: string) => boolean;
  setExpanded: (id: string, open: boolean) => void;
  /** Checked, unchecked or mixed, from the node's leaves. */
  getCheckState: (id: string) => CheckboxTreeState;
  /** Checks every enabled leaf of a node, or clears them when they already are. Ignored on a disabled node. */
  toggle: (id: string) => void;
  /** Moves the tab stop and DOM focus to a node. */
  focus: (id: string) => void;
  /** The `<ul role="tree">` of the root nodes: the keys. Name it with `aria-label`. */
  getTreeProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** A node's `<li>`: role, level, position, aria-checked, aria-expanded, tab stop and its ref. */
  getItemProps: (node: { id: string }, props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement> };
  /** The visible row inside the `<li>` (not its child list): a click focuses the node and toggles it. */
  getRowProps: (node: { id: string }, props?: UserProps) => HTMLAttributes<HTMLElement> & { 'data-state': CheckboxTreeState };
  /** A branch's expand button inside the row (hidden from screen readers: the keys and aria-expanded do the job). */
  getToggleProps: (node: { id: string }, props?: UserProps) => HTMLAttributes<HTMLElement> & { 'data-open'?: true };
  /** The `<ul>` of a branch's children. */
  getGroupProps: (node: { id: string }, props?: UserProps) => HTMLAttributes<HTMLElement>;
}

interface NodeInfo {
  level: number;
  setSize: number;
  posInSet: number;
  disabled: boolean;
  children: readonly TreeNodeBase[];
  /** The leaves under the node (the node itself for a leaf). */
  leaves: TreeNodeBase[];
}

function indexNodes(nodes: readonly TreeNodeBase[], map = new Map<string, NodeInfo>(), level = 1): TreeNodeBase[] {
  return nodes.flatMap((node, index) => {
    const children = node.children ?? [];
    const leaves = children.length ? indexNodes(children, map, level + 1) : [node];
    map.set(node.id, { level, setSize: nodes.length, posInSet: index + 1, disabled: !!node.disabled, children, leaves });
    return leaves;
  });
}

/** Checked, unchecked or mixed, from the node's leaves. */
export function nodeState(leaves: readonly TreeNodeBase[], checked: ReadonlySet<string>): CheckboxTreeState {
  const on = leaves.filter((leaf) => checked.has(leaf.id)).length;
  return on === 0 ? 'unchecked' : on === leaves.length ? 'checked' : 'mixed';
}

/** New checked leaves after toggling a node: all its enabled leaves on, or off when they already are. */
export function toggleNode(leaves: readonly TreeNodeBase[], checked: readonly string[]): string[] {
  const enabled = leaves.filter((leaf) => !leaf.disabled).map((leaf) => leaf.id);
  const set = new Set(checked);
  const allOn = enabled.every((id) => set.has(id));
  enabled.forEach((id) => (allOn ? set.delete(id) : set.add(id)));
  return [...set];
}

export function useCheckboxTree<N extends TreeNodeBase>({
  nodes,
  value: valueProp,
  defaultValue,
  onValueChange,
  expanded: expandedProp,
  defaultExpanded,
  onExpandedChange,
}: CheckboxTreeOptions<N>): CheckboxTreeHookState<N> {
  const [value, setValue] = useControllableState<string[]>({ value: valueProp, defaultValue: defaultValue ?? [], onChange: onValueChange });
  const [expandedList, setExpandedList] = useControllableState<string[]>({
    value: expandedProp,
    defaultValue: defaultExpanded ?? [],
    onChange: onExpandedChange,
  });
  const info = useMemo(() => {
    const map = new Map<string, NodeInfo>();
    indexNodes(nodes, map);
    return map;
  }, [nodes]);
  const parents = useMemo(() => parentMap(nodes), [nodes]);
  const checked = useMemo(() => new Set(value), [value]);
  const expandedSet = useMemo(() => new Set(expandedList), [expandedList]);
  const visible = useMemo(() => flattenVisible(nodes, expandedSet), [nodes, expandedSet]);
  const [focusedId, setFocusedId] = useState<string>();
  const items = useRef(new Map<string, HTMLElement>());
  // One ref callback per node, so an item's ref does not change on every render.
  const itemRefs = useRef(new Map<string, RefCallback<HTMLElement>>());
  // Roving tabindex: the focused node while it is on screen, else the first row.
  const tabStop = focusedId && visible.some((v) => v.node.id === focusedId) ? focusedId : visible[0]?.node.id;

  const setExpanded = (id: string, open: boolean) => {
    if (open === expandedSet.has(id)) return;
    setExpandedList(open ? [...expandedList, id] : expandedList.filter((x) => x !== id));
  };
  const getCheckState = (id: string) => nodeState(info.get(id)?.leaves ?? [{ id }], checked);
  const toggle = (id: string) => {
    const node = info.get(id);
    if (!node || node.disabled) return;
    setValue(toggleNode(node.leaves, value));
  };
  const focus = (id: string | null | undefined) => {
    if (!id) return;
    setFocusedId(id);
    items.current.get(id)?.focus();
  };
  const itemRef = (id: string) => {
    let ref = itemRefs.current.get(id);
    if (!ref) {
      ref = (node) => {
        if (node) items.current.set(id, node);
        else items.current.delete(id);
      };
      itemRefs.current.set(id, ref);
    }
    return ref;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    let id: string | undefined;
    for (const [key, element] of items.current) if (element === event.target) id = key;
    const at = visible.findIndex((v) => v.node.id === id);
    if (id === undefined || at < 0) return;
    const branch = visible[at].hasChildren;
    // Logical keys: the inline-end arrow (ArrowLeft under dir="rtl") opens and descends.
    const step = inlineArrowStep(event.key, getDirection(event.currentTarget));
    const key = step === 1 ? 'ArrowRight' : step === -1 ? 'ArrowLeft' : event.key;
    let handled = true;
    if (key === 'ArrowDown') focus(visible[at + 1]?.node.id);
    else if (key === 'ArrowUp') focus(visible[at - 1]?.node.id);
    else if (key === 'Home') focus(visible[0]?.node.id);
    else if (key === 'End') focus(visible[visible.length - 1]?.node.id);
    else if (key === 'ArrowRight') {
      if (branch && !expandedSet.has(id)) setExpanded(id, true);
      else if (branch) focus(info.get(id)?.children[0]?.id);
    } else if (key === 'ArrowLeft') {
      if (branch && expandedSet.has(id)) setExpanded(id, false);
      else focus(parents.get(id));
    } else if (key === ' ' || key === 'Enter') toggle(id);
    else handled = false;
    if (handled) event.preventDefault();
  };

  return {
    value,
    expanded: expandedList,
    visible,
    isExpanded: (id) => expandedSet.has(id),
    setExpanded,
    getCheckState,
    toggle,
    focus,
    getTreeProps: (props) => withUserProps({ role: 'tree', 'aria-multiselectable': true, onKeyDown }, props),
    getItemProps: ({ id }, props) => {
      const node = info.get(id);
      const branch = !!node?.children.length;
      const state = getCheckState(id);
      return withUserProps(
        {
          ref: itemRef(id),
          role: 'treeitem',
          'aria-level': node?.level,
          'aria-setsize': node?.setSize,
          'aria-posinset': node?.posInSet,
          'aria-expanded': branch ? expandedSet.has(id) : undefined,
          'aria-checked': state === 'mixed' ? 'mixed' : state === 'checked',
          'aria-disabled': node?.disabled || undefined,
          tabIndex: id === tabStop ? 0 : -1,
          onFocus: (event: { target: unknown; currentTarget: unknown }) => {
            if (event.target === event.currentTarget) setFocusedId(id);
          },
        },
        props,
      );
    },
    getRowProps: ({ id }, props) =>
      withUserProps(
        {
          'data-state': getCheckState(id),
          onClick: () => {
            focus(id);
            toggle(id);
          },
        },
        props,
      ) as never,
    getToggleProps: ({ id }, props) =>
      withUserProps(
        {
          'aria-hidden': true,
          'data-open': expandedSet.has(id) || undefined,
          onClick: (event: { stopPropagation: () => void }) => {
            // The row's click checks the node; this one only opens or closes it.
            event.stopPropagation();
            focus(id);
            setExpanded(id, !expandedSet.has(id));
          },
        },
        props,
      ) as never,
    getGroupProps: (_node, props) => withUserProps({ role: 'group' }, props),
  };
}
