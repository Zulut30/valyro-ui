'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cx, getDirection, inlineArrowStep, useControllableState } from '../primitives';
import { useFold } from '../primitives/useFold';
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from '../icons';
import { findByTypeahead, flattenVisible } from './tree';
import '../primitives/motion.css';
import './TreeView.css';
import { inertAttr, withRef, cleanupRef } from '../primitives/react-compat';

export interface TreeViewNode {
  id: string;
  label: string;
  /** Defaults to a folder (nodes with children) or file icon. */
  icon?: ReactNode;
  children?: TreeViewNode[];
}

export interface TreeViewProps extends Omit<ComponentPropsWithRef<'ul'>, 'children'> {
  /** Root nodes; nodes with `children` render as expandable branches. */
  nodes: readonly TreeViewNode[];
  /** Ids of expanded nodes. */
  expanded?: string[];
  defaultExpanded?: string[];
  onExpandedChange?: (expanded: string[]) => void;
  /** Id of the selected node. */
  selected?: string | null;
  defaultSelected?: string | null;
  onSelectedChange?: (id: string | null) => void;
  /**
   * A branch unfolds, pushing the rows below down, and folds away again when closed (it stays mounted
   * until it has). `spring`: it opens on a spring. `default`: on the theme's curve and duration.
   */
  animation?: 'default' | 'spring';
}

interface FoldGroupProps {
  open: boolean;
  level: number;
  /** False during the tree's first commit: branches open from the start don't animate. */
  readyRef: RefObject<boolean>;
  spring: boolean;
  children: ReactNode;
}

/** A branch's child list that unfolds and folds (height and fade), mounted until the fold has played. */
function FoldGroup({ open, level, readyRef, spring, children }: FoldGroupProps) {
  const { ref, isMounted, state } = useFold<HTMLUListElement>(open, readyRef, spring);
  if (!isMounted) return null;
  return (
    <ul
      ref={ref}
      role="group"
      className="ui-tree__group"
      data-state={state}
      inert={inertAttr(state === 'closed' || undefined)}
      style={{ '--ui-tree-level': level } as CSSProperties}
    >
      {children}
    </ul>
  );
}

export const TreeView = withRef(function TreeView({
  nodes,
  expanded: expandedProp,
  defaultExpanded = [],
  onExpandedChange,
  selected: selectedProp,
  defaultSelected = null,
  onSelectedChange,
  animation = 'default',
  className,
  onKeyDown,
  ...rest
}: TreeViewProps) {
  const spring = animation === 'spring';
  // Branches open on the first render show without unfolding; later toggles animate.
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = true;
  }, []);
  const [expanded, setExpanded] = useControllableState({
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
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const visible = useMemo(() => flattenVisible(nodes, expandedSet), [nodes, expandedSet]);

  // Roving tabindex: the focused node, else the selected one if visible, else the first node.
  const tabStop =
    visible.find((v) => v.node.id === focusedId)?.node.id ??
    visible.find((v) => v.node.id === selected)?.node.id ??
    visible[0]?.node.id;

  const setOpen = (id: string, open: boolean) => {
    setExpanded((prev) => (open ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  };

  const focusNode = (id: string) => {
    setFocusedId(id);
    itemRefs.current.get(id)?.focus();
  };

  const activate = (id: string, hasChildren: boolean) => {
    setSelected(id);
    setFocusedId(id);
    if (hasChildren) setOpen(id, !expandedSet.has(id));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = visible.findIndex((v) => v.node.id === (event.target as HTMLElement).dataset.nodeId);
    if (index === -1) return;
    const current = visible[index];
    const id = current.node.id;
    const isOpen = expandedSet.has(id);

    // Logical keys: the inline-end arrow (ArrowLeft under dir="rtl") opens and descends, as in the ARIA tree pattern.
    const step = inlineArrowStep(event.key, getDirection(event.currentTarget));
    const key = step === 1 ? 'ArrowRight' : step === -1 ? 'ArrowLeft' : event.key;
    switch (key) {
      case 'ArrowDown':
        if (index < visible.length - 1) focusNode(visible[index + 1].node.id);
        break;
      case 'ArrowUp':
        if (index > 0) focusNode(visible[index - 1].node.id);
        break;
      case 'ArrowRight':
        if (current.hasChildren && !isOpen) setOpen(id, true);
        else if (current.hasChildren) focusNode(visible[index + 1].node.id);
        break;
      case 'ArrowLeft':
        if (current.hasChildren && isOpen) setOpen(id, false);
        else if (current.parentId) focusNode(current.parentId);
        break;
      case 'Home':
        focusNode(visible[0].node.id);
        break;
      case 'End':
        focusNode(visible[visible.length - 1].node.id);
        break;
      case 'Enter':
      case ' ':
        activate(id, current.hasChildren);
        break;
      default: {
        if (event.key.length !== 1 || event.key === ' ') return;
        const match = findByTypeahead(visible, index, event.key);
        if (match !== -1) focusNode(visible[match].node.id);
        break;
      }
    }
    event.preventDefault();
  };

  const renderNodes = (list: readonly TreeViewNode[], level: number): ReactNode =>
    list.map((node, i) => {
      const hasChildren = !!node.children && node.children.length > 0;
      const isOpen = hasChildren && expandedSet.has(node.id);
      const isSelected = selected === node.id;
      const icon = node.icon ?? (hasChildren ? isOpen ? <FolderOpenIcon /> : <FolderIcon /> : <FileIcon />);
      return (
        <li
          key={node.id}
          ref={cleanupRef((el) => {
            if (!el) return;
            itemRefs.current.set(node.id, el);
            return () => {
              if (itemRefs.current.get(node.id) === el) itemRefs.current.delete(node.id);
            };
          })}
          role="treeitem"
          className="ui-tree__item"
          data-node-id={node.id}
          aria-level={level}
          aria-setsize={list.length}
          aria-posinset={i + 1}
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-selected={isSelected}
          tabIndex={node.id === tabStop ? 0 : -1}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocusedId(node.id);
          }}
        >
          <div
            className="ui-tree__row"
            data-selected={isSelected || undefined}
            style={{ '--ui-tree-level': level - 1 } as CSSProperties}
            onClick={() => activate(node.id, hasChildren)}
          >
            <span className="ui-tree__chevron" data-open={isOpen || undefined} aria-hidden="true">
              {hasChildren && <ChevronRightIcon size={14} />}
            </span>
            <span className="ui-tree__icon" data-folder={hasChildren || undefined} aria-hidden="true">
              {icon}
            </span>
            <span className="ui-tree__label" title={node.label}>
              {node.label}
            </span>
          </div>
          {hasChildren && (
            <FoldGroup open={isOpen} level={level} readyRef={readyRef} spring={spring}>
              {renderNodes(node.children ?? [], level + 1)}
            </FoldGroup>
          )}
        </li>
      );
    });

  return (
    <ul
      role="tree"
      className={cx('ui-tree', className)}
      data-motion={spring ? 'spring' : undefined}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {renderNodes(nodes, 1)}
    </ul>
  );
});
