'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { cx } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { useFold } from '../primitives/useFold';
import { useLocale } from '../theme/ThemeProvider';
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from '../icons';
import { useTreeView } from './useTreeView';
import '../primitives/motion.css';
import './TreeView.css';
import { inertAttr, withRef } from '../primitives/react-compat';

export interface TreeViewNode {
  id: string;
  label: string;
  /** Defaults to a folder (nodes with children) or file icon. */
  icon?: ReactNode;
  children?: TreeViewNode[];
  /** Skipped by the keyboard and not focusable, selectable or expandable; announced as dimmed (`aria-disabled`). */
  disabled?: boolean;
}

export interface TreeViewProps extends Omit<ComponentPropsWithRef<'ul'>, 'children'> {
  /**
   * Root nodes; nodes with `children` render as expandable branches. Or compose them as children:
   * `TreeView.Item` elements, nested for branches.
   */
  nodes?: readonly TreeViewNode[];
  /** The compound form instead of `nodes`: `TreeView.Item` elements. */
  children?: ReactNode;
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

export interface TreeViewItemProps {
  /** Id of the node, used by `expanded` and `selected`. */
  id: string;
  label: string;
  /** Defaults to a folder (an item with children) or file icon. */
  icon?: ReactNode;
  /** Nested `TreeView.Item` elements: the branch's children. */
  children?: ReactNode;
}

/** A node of the compound form (`TreeView.Item`), nested inside another for a branch. */
export const TreeViewItem = collectionPart<TreeViewItemProps>('TreeView.Item');

function nodesFromParts(children: ReactNode): TreeViewNode[] {
  return partsOf<TreeViewItemProps>(children, TreeViewItem).map(({ props }) => {
    const nested = nodesFromParts(props.children);
    return { id: props.id, label: props.label, icon: props.icon, children: nested.length > 0 ? nested : undefined };
  });
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
  const { ref, isMounted, state, cssFold } = useFold<HTMLUListElement>(open, readyRef, spring);
  if (!isMounted) return null;
  return (
    <ul
      ref={ref}
      role="group"
      className="ui-tree__group"
      data-state={state}
      data-ui-fold={cssFold}
      inert={inertAttr(state === 'closed' || undefined)}
      style={{ '--ui-tree-level': level } as CSSProperties}
    >
      {children}
    </ul>
  );
}

export const TreeView = withRef(function TreeView({
  nodes: nodesProp,
  children,
  expanded,
  defaultExpanded = [],
  onExpandedChange,
  selected,
  defaultSelected = null,
  onSelectedChange,
  animation = 'default',
  className,
  onKeyDown,
  onFocus,
  onBlur,
  ref,
  ...rest
}: TreeViewProps) {
  const nodes = nodesProp ?? nodesFromParts(children);
  const spring = animation === 'spring';
  // Branches open on the first render show without unfolding; later toggles animate.
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = true;
  }, []);
  // The state, tab stop and keys come from the headless hook, so `useTreeView` builds the same tree.
  const locale = useLocale();
  const tree = useTreeView({ nodes, expanded, defaultExpanded, onExpandedChange, selected, defaultSelected, onSelectedChange, locale });

  const renderNodes = (list: readonly TreeViewNode[], level: number): ReactNode =>
    list.map((node) => {
      const hasChildren = !!node.children && node.children.length > 0;
      const isOpen = hasChildren && tree.isExpanded(node.id);
      const icon = node.icon ?? (hasChildren ? isOpen ? <FolderOpenIcon /> : <FolderIcon /> : <FileIcon />);
      return (
        <li key={node.id} className="ui-tree__item" data-node-id={node.id} {...tree.getItemProps(node)}>
          <div
            className="ui-tree__row"
            style={{ '--ui-tree-level': level - 1 } as CSSProperties}
            {...tree.getRowProps(node)}
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
      className={cx('ui-tree', className)}
      data-motion={spring ? 'spring' : undefined}
      {...tree.getTreeProps({ onKeyDown, onFocus, onBlur, ref, ...rest })}
    >
      {renderNodes(nodes, 1)}
    </ul>
  );
}, { Item: TreeViewItem });
