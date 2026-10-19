'use client';

import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type RefCallback } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { getDirection, inlineArrowStep } from '../primitives/utils';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { findTypeaheadIndex, useTypeahead } from '../primitives/typeahead';
import { flattenVisible, parentMap, type TreeNodeLike, type VisibleNode } from './tree';

/*
 * The behaviour of TreeView without its markup: expanded and selected nodes (controlled or not), the rows on
 * screen, a roving tab stop and the WAI-ARIA tree keys — arrows (the inline-end arrow opens and descends, also
 * under dir="rtl"), Home / End, `*` (opens the sibling branches), Enter / Space and type-ahead that builds a query
 * and compares labels with the locale's collator ("new y" → "New York", "e" finds "Éclair"), as React Aria does.
 * Disabled nodes are skipped by the keyboard and cannot be focused, selected or expanded. When a branch closes
 * under the focused row (controlled `expanded`), focus moves to its nearest visible ancestor instead of <body>.
 * TreeView renders with it.
 */

export interface TreeViewOptions<N extends TreeNodeLike = TreeNodeLike> {
  /** Root nodes; a node with `children` is a branch. */
  nodes: readonly N[];
  /** Ids of expanded nodes. */
  expanded?: string[];
  defaultExpanded?: string[];
  onExpandedChange?: (expanded: string[]) => void;
  /** Id of the selected node. */
  selected?: string | null;
  defaultSelected?: string | null;
  onSelectedChange?: (id: string | null) => void;
  /** Locale for type-ahead matching (case and accents); default: the browser's. */
  locale?: string;
}

export interface TreeViewState<N extends TreeNodeLike = TreeNodeLike> {
  expanded: string[];
  selected: string | null;
  /** The rows on screen, depth first: children only under expanded branches. */
  visible: VisibleNode<N>[];
  isExpanded: (id: string) => boolean;
  setExpanded: (id: string, open: boolean) => void;
  /** Selects a node and, on a branch, toggles it: what a click or Enter does. Ignored on a disabled node. */
  activate: (id: string) => void;
  /** Moves the tab stop and DOM focus to a node. */
  focus: (id: string) => void;
  /** The `<ul>` of the root nodes: role, keys and the focus tracking. Name it with `aria-label`. */
  getTreeProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement> };
  /** A node's `<li>`: role, level, position, state, tab stop and its ref. */
  getItemProps: (node: { id: string }, props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: RefCallback<HTMLElement> };
  /** The visible row inside the `<li>` (not its child list): a click activates the node. */
  getRowProps: (node: { id: string }, props?: UserProps) => HTMLAttributes<HTMLElement> & { 'data-selected'?: true; 'data-disabled'?: true };
  /** The `<ul>` of a branch's children. */
  getGroupProps: (node: { id: string }, props?: UserProps) => HTMLAttributes<HTMLElement>;
}

interface NodeInfo {
  level: number;
  parentId: string | null;
  hasChildren: boolean;
  setSize: number;
  posInSet: number;
  disabled: boolean;
}

function indexNodes(nodes: readonly TreeNodeLike[], map = new Map<string, NodeInfo>(), level = 1, parentId: string | null = null) {
  nodes.forEach((node, index) => {
    const children = node.children ?? [];
    map.set(node.id, { level, parentId, hasChildren: children.length > 0, setSize: nodes.length, posInSet: index + 1, disabled: !!node.disabled });
    indexNodes(children, map, level + 1, node.id);
  });
  return map;
}

export function useTreeView<N extends TreeNodeLike>({
  nodes,
  expanded: expandedProp,
  defaultExpanded = [],
  onExpandedChange,
  selected: selectedProp,
  defaultSelected = null,
  onSelectedChange,
  locale,
}: TreeViewOptions<N>): TreeViewState<N> {
  const [expanded, setExpandedList] = useControllableState({
    value: expandedProp,
    defaultValue: defaultExpanded,
    onChange: onExpandedChange,
  });
  const [selected, setSelected] = useControllableState({
    value: selectedProp,
    defaultValue: defaultSelected,
    onChange: onSelectedChange,
  });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  // One ref callback per node, so an item's ref does not change on every render.
  const itemRefs = useRef(new Map<string, RefCallback<HTMLElement>>());
  const tree = useRef<HTMLElement | null>(null);
  const treeRef = useRef<RefCallback<HTMLElement>>((element) => {
    tree.current = element;
  });
  // Focus was in the tree when last seen; stays true when the focused row is removed (that blur has no target).
  const hadFocus = useRef(false);
  const typeahead = useTypeahead(locale);

  const info = useMemo(() => indexNodes(nodes), [nodes]);
  const parents = useMemo(() => parentMap(nodes), [nodes]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const visible = useMemo(() => flattenVisible(nodes, expandedSet), [nodes, expandedSet]);
  const enabledId = (id: string | null | undefined) => visible.find((v) => v.node.id === id && !v.node.disabled)?.node.id;

  // Roving tabindex: the focused node, else the selected one if visible, else the first enabled node.
  const tabStop = enabledId(focusedId) ?? enabledId(selected) ?? visible.find((v) => !v.node.disabled)?.node.id;

  // A parent folded from outside (controlled `expanded`) took the focused row with it: focus moves to the nearest
  // visible ancestor instead of dropping to <body>, as in React Aria's collections.
  useEffect(() => {
    if (focusedId === null || visible.some((v) => v.node.id === focusedId)) return;
    let ancestor = parents.get(focusedId) ?? null;
    while (ancestor !== null && !visible.some((v) => v.node.id === ancestor)) ancestor = parents.get(ancestor) ?? null;
    setFocusedId(ancestor);
    const active = typeof document === 'undefined' ? null : document.activeElement;
    const inTree = !!active && !!tree.current?.contains(active);
    if (ancestor !== null && (inTree || (hadFocus.current && (!active || active === document.body)))) {
      items.current.get(ancestor)?.focus();
    }
  }, [visible, focusedId, parents]);

  const setExpanded = (id: string, open: boolean) => {
    setExpandedList((prev) => (open ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  };

  const focus = (id: string) => {
    setFocusedId(id);
    items.current.get(id)?.focus();
  };

  const activate = (id: string) => {
    const node = info.get(id);
    if (node?.disabled) return;
    setSelected(id);
    setFocusedId(id);
    if (node?.hasChildren) setExpanded(id, !expandedSet.has(id));
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

  /** The next enabled visible index after `from` in direction `delta` (no wrap), or -1. */
  const stepEnabled = (from: number, delta: 1 | -1) => {
    for (let i = from + delta; i >= 0 && i < visible.length; i += delta) if (!visible[i].node.disabled) return i;
    return -1;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // The row is the item element itself, or (markup that keeps its own refs) one carrying data-node-id.
    let targetId: string | undefined;
    for (const [id, element] of items.current) if (element === event.target) targetId = id;
    targetId ??= (event.target as { dataset?: { nodeId?: string } }).dataset?.nodeId;
    const index = visible.findIndex((v) => v.node.id === targetId);
    if (index === -1) return;
    const current = visible[index];
    const id = current.node.id;
    const isOpen = expandedSet.has(id);
    const canToggle = current.hasChildren && !current.node.disabled;
    const focusIndex = (i: number) => {
      if (i !== -1) focus(visible[i].node.id);
    };

    // Logical keys: the inline-end arrow (ArrowLeft under dir="rtl") opens and descends, as in the ARIA tree pattern.
    const step = inlineArrowStep(event.key, getDirection(event.currentTarget));
    const key = step === 1 ? 'ArrowRight' : step === -1 ? 'ArrowLeft' : event.key;
    switch (key) {
      case 'ArrowDown':
        focusIndex(stepEnabled(index, 1));
        break;
      case 'ArrowUp':
        focusIndex(stepEnabled(index, -1));
        break;
      case 'ArrowRight':
        if (canToggle && !isOpen) setExpanded(id, true);
        else if (current.hasChildren && isOpen) {
          // Into the branch: its first enabled row.
          const next = stepEnabled(index, 1);
          if (next !== -1 && visible[next].level > current.level) focusIndex(next);
        }
        break;
      case 'ArrowLeft':
        if (canToggle && isOpen) setExpanded(id, false);
        else if (current.parentId) focusIndex(visible.findIndex((v) => v.node.id === current.parentId && !v.node.disabled));
        break;
      case 'Home':
        focusIndex(stepEnabled(-1, 1));
        break;
      case 'End':
        focusIndex(stepEnabled(visible.length, -1));
        break;
      case '*': {
        // APG: expands every sibling branch of the focused row; focus stays where it is.
        const siblings = visible
          .filter((v) => v.parentId === current.parentId && v.hasChildren && !v.node.disabled)
          .map((v) => v.node.id);
        setExpandedList((prev) => [...prev, ...siblings.filter((x) => !prev.includes(x))]);
        break;
      }
      case 'Enter':
        activate(id);
        break;
      default: {
        // Space selects, unless it belongs to a query being typed ("new y").
        if (event.key === ' ' && !typeahead.isTyping()) {
          activate(id);
          break;
        }
        const query = typeahead.type(event);
        if (query === null) return;
        const label = (i: number) => visible[i].node.label;
        const disabled = (i: number) => !!visible[i].node.disabled;
        focusIndex(findTypeaheadIndex(visible.length, query, index, label, typeahead.matches, disabled));
        break;
      }
    }
    event.preventDefault();
  };

  return {
    expanded,
    selected,
    visible,
    isExpanded: (id) => expandedSet.has(id),
    setExpanded,
    activate,
    focus,
    getTreeProps: (props) =>
      withUserProps(
        {
          ref: treeRef.current,
          role: 'tree',
          onKeyDown,
          onFocus: () => {
            hadFocus.current = true;
          },
          onBlur: (event: { relatedTarget: unknown; currentTarget: { contains: (node: Node | null) => boolean } }) => {
            // Focus moved elsewhere on the page; a row that was removed blurs with no target and keeps the flag.
            const next = event.relatedTarget as Node | null;
            if (next && !event.currentTarget.contains(next)) hadFocus.current = false;
          },
        },
        props,
      ) as never,
    getItemProps: ({ id }, props) => {
      const node = info.get(id);
      const disabled = !!node?.disabled;
      return withUserProps(
        {
          ref: itemRef(id),
          role: 'treeitem',
          'aria-level': node?.level,
          'aria-setsize': node?.setSize,
          'aria-posinset': node?.posInSet,
          'aria-expanded': node?.hasChildren ? expandedSet.has(id) : undefined,
          'aria-selected': selected === id,
          'aria-disabled': disabled || undefined,
          tabIndex: disabled ? undefined : id === tabStop ? 0 : -1,
          onFocus: (event: { target: unknown; currentTarget: unknown }) => {
            if (event.target === event.currentTarget) setFocusedId(id);
          },
        },
        props,
      );
    },
    getRowProps: ({ id }, props) => {
      const disabled = !!info.get(id)?.disabled;
      return withUserProps(
        {
          'data-selected': selected === id || undefined,
          'data-disabled': disabled || undefined,
          onClick: disabled ? undefined : () => activate(id),
        },
        props,
      ) as never;
    },
    getGroupProps: (_node, props) => withUserProps({ role: 'group' }, props),
  };
}
