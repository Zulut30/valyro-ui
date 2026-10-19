/** Pure helpers behind TreeView. */

export interface TreeNodeLike {
  id: string;
  label: string;
  children?: readonly TreeNodeLike[];
}

export interface VisibleNode<N extends TreeNodeLike> {
  node: N;
  /** 1-based, as in aria-level. */
  level: number;
  parentId: string | null;
  hasChildren: boolean;
}

/** Depth-first list of the nodes currently on screen (children only under expanded parents). */
export function flattenVisible<N extends TreeNodeLike>(
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
