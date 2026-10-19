/** Pure helpers behind TreeView and CheckboxTree. */

/** A node of any tree: an id and, on a branch, children. */
export interface TreeNodeBase {
  id: string;
  children?: readonly TreeNodeBase[];
  disabled?: boolean;
}

export interface TreeNodeLike extends TreeNodeBase {
  label: string;
  children?: readonly TreeNodeLike[];
  /** Skipped by the keyboard and not focusable, selectable or expandable; announced as dimmed (`aria-disabled`). */
  disabled?: boolean;
}

export interface VisibleNode<N extends TreeNodeBase> {
  node: N;
  /** 1-based, as in aria-level. */
  level: number;
  parentId: string | null;
  hasChildren: boolean;
}

/** Depth-first list of the nodes currently on screen (children only under expanded parents). */
export function flattenVisible<N extends TreeNodeBase>(
  nodes: readonly N[],
  expanded: ReadonlySet<string>,
  level = 1,
  parentId: string | null = null,
): VisibleNode<N>[] {
  const out: VisibleNode<N>[] = [];
  for (const node of nodes) {
    const children = (node.children ?? []) as readonly N[];
    const hasChildren = children.length > 0;
    out.push({ node, level, parentId, hasChildren });
    if (hasChildren && expanded.has(node.id)) out.push(...flattenVisible(children, expanded, level + 1, node.id));
  }
  return out;
}

/** Parent id of every node, expanded or not (null at the root). */
export function parentMap<N extends TreeNodeBase>(
  nodes: readonly N[],
  parentId: string | null = null,
  out = new Map<string, string | null>(),
): Map<string, string | null> {
  for (const node of nodes) {
    out.set(node.id, parentId);
    if (node.children) parentMap(node.children, node.id, out);
  }
  return out;
}

/** Next visible node after `fromIndex` whose label starts with `char` (wraps around). */
export function findByTypeahead<N extends TreeNodeLike>(
  visible: readonly VisibleNode<N>[],
  fromIndex: number,
  char: string,
): number {
  const needle = char.toLowerCase();
  for (let i = 1; i <= visible.length; i++) {
    const index = (fromIndex + i) % visible.length;
    if (visible[index].node.label.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
