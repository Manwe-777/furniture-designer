import type { CellNode, FurnitureNode, SplitNode } from '../core/types'

/** Depth-first search for a node by id. */
export function findNode(root: FurnitureNode, id: string): FurnitureNode | null {
  if (root.id === id) return root
  if (root.kind === 'split') {
    for (const child of root.children) {
      const found = findNode(child, id)
      if (found) return found
    }
  }
  return null
}

export function findParent(root: FurnitureNode, id: string): SplitNode | null {
  if (root.kind !== 'split') return null
  for (const child of root.children) {
    if (child.id === id) return root
    const found = findParent(child, id)
    if (found) return found
  }
  return null
}

/** Replace one node in the tree, rebuilding only the path down to it. */
export function replaceNode(
  root: FurnitureNode,
  id: string,
  replacement: (node: FurnitureNode) => FurnitureNode,
): FurnitureNode {
  if (root.id === id) return replacement(root)
  if (root.kind !== 'split') return root
  return {
    ...root,
    children: root.children.map((child) => replaceNode(child, id, replacement)),
  }
}

/** All nodes, parents before children — the order the tree panel renders them in. */
export function flattenNodes(
  root: FurnitureNode,
  depth = 0,
): { node: FurnitureNode; depth: number }[] {
  const out = [{ node: root, depth }]
  if (root.kind === 'split') {
    // Render bottom-up splits top-down so the list matches what you see on screen.
    const children = root.dir === 'h' ? [...root.children].reverse() : root.children
    for (const child of children) out.push(...flattenNodes(child, depth + 1))
  }
  return out
}

export function isCell(node: FurnitureNode): node is CellNode {
  return node.kind === 'cell'
}

export function isSplit(node: FurnitureNode): node is SplitNode {
  return node.kind === 'split'
}

export function describeNode(node: FurnitureNode): string {
  if (node.kind === 'split') {
    return node.dir === 'v'
      ? `${node.children.length} columns`
      : `${node.children.length} rows`
  }
  switch (node.content.type) {
    case 'empty':
      return 'Open space'
    case 'shelves':
      return `${node.content.count} ${node.content.count === 1 ? 'shelf' : 'shelves'}`
    case 'drawers':
      return `${node.content.count} drawer${node.content.count === 1 ? '' : 's'}`
    case 'door':
      return 'Door'
  }
}
