import type { Design, FurnitureNode, Material } from './types'

/**
 * Every place a material id can be referenced, counted.
 *
 * Deleting a material that is still in use would silently fall back to the first
 * material in the list — which means a panel quietly changes thickness and the cut
 * list goes wrong without anything looking broken. So removal is gated on this.
 */
export function countMaterialUsage(design: Design, materialId: string): number {
  let count = 0

  const countNode = (node: FurnitureNode): void => {
    if (node.kind === 'split') {
      if (node.materialId === materialId) count += 1
      for (const child of node.children) countNode(child)
      return
    }
    const content = node.content
    switch (content.type) {
      case 'shelves':
        if (content.materialId === materialId) count += 1
        break
      case 'drawers':
        if (content.boxMaterialId === materialId) count += 1
        if (content.bottomMaterialId === materialId) count += 1
        if (content.faceMaterialId === materialId) count += 1
        break
      case 'door':
        if (content.materialId === materialId) count += 1
        break
      case 'empty':
        break
    }
  }

  for (const cab of design.cabinets) {
    if (cab.materialId === materialId) count += 1
    if (cab.back.materialId === materialId) count += 1
    countNode(cab.root)
  }

  for (const worktop of design.worktops) {
    if (worktop.materialId === materialId) count += 1
  }

  return count
}

const NEW_MATERIAL_COLORS = [
  '#c9a87c',
  '#a8bfa0',
  '#b8a8c8',
  '#c8a8a8',
  '#a8b8c8',
  '#c8c0a0',
]

/** A blank material to edit, with a colour that is not already taken. */
export function newMaterial(existing: Material[]): Material {
  const used = new Set(existing.map((m) => m.color))
  const color = NEW_MATERIAL_COLORS.find((c) => !used.has(c)) ?? NEW_MATERIAL_COLORS[0]

  // Pick an id that does not collide, even after materials have been removed.
  let n = existing.length + 1
  while (existing.some((m) => m.id === `mat${n}`)) n += 1

  return {
    id: `mat${n}`,
    name: 'New material',
    thickness: 15,
    sheet: { length: 2440, width: 1220 },
    pricePerSheet: 0,
    hasGrain: false,
    color,
  }
}
