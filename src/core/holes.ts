import { buildCabinet } from './build/buildCabinet'
import { materialLookup } from './build/buildDesign'
import { mm } from './geom'
import type { Cabinet, Design, FurnitureNode, HoleGrid, Part } from './types'

export interface Hole {
  /** Along the panel's length, measured from the bottom edge. */
  u: number
  /** Across the panel's width, measured from the front edge. */
  v: number
  diameter: number
  depth: number
  /** True when the current shelf layout uses this hole. */
  used: boolean
}

export interface PanelDrilling {
  partId: string
  cabinetName: string
  label: string
  /** Cut size of the panel you are about to drill. */
  length: number
  width: number
  thickness: number
  grid: HoleGrid
  /** Distances from the front edge for each row of holes. */
  rows: number[]
  holes: Hole[]
  /** Heights the current shelves sit at, for marking or sanity-checking. */
  shelfHeights: number[]
  /** Every grid position that fits on the panel. */
  gridHeights: number[]
}

const EPS = 0.51

/**
 * Where to drill every shelf-pin hole, panel by panel.
 *
 * Positions are given in the panel's own coordinates — along its length from the
 * bottom edge, across its width from the front edge — because that is how you hold
 * the piece and register a jig against it. Nothing here is measured from the
 * assembled cabinet, which you do not have yet when you are drilling.
 *
 * Only shelf-pin holes are produced. Carcass joint fixings are not included: they
 * are few, and marking them off the panel edges is straightforward.
 */
export function buildDrilling(design: Design): PanelDrilling[] {
  const mat = materialLookup(design)
  const out: PanelDrilling[] = []

  for (const cab of design.cabinets) {
    const grid = cab.holeGrid
    if (!grid?.enabled || grid.pitch <= 0) continue

    const { parts, regions, datumY = 0 } = buildCabinet(cab, mat)

    // Which cells hold adjustable shelves, and how high those shelves sit.
    const shelfHeightsByPanel = new Map<string, Set<number>>()

    for (const node of flatten(cab.root)) {
      if (node.kind !== 'cell' || node.content.type !== 'shelves') continue
      if (node.content.fixed || node.content.count <= 0) continue

      const region = regions.find((r) => r.nodeId === node.id)?.region
      if (!region) continue

      const heights = parts
        .filter((p) => p.nodeId === node.id && p.role === 'shelf')
        .map((p) => p.box.pos[1])
      if (!heights.length) continue

      // The pins live in whatever vertical panels close this cell left and right.
      for (const panel of boundingPanels(parts, region.x0, region.x1)) {
        const set = shelfHeightsByPanel.get(panel.id) ?? new Set<number>()
        for (const h of heights) set.add(h)
        shelfHeightsByPanel.set(panel.id, set)
      }
    }

    for (const [partId, heights] of shelfHeightsByPanel) {
      const panel = parts.find((p) => p.id === partId)
      if (!panel) continue

      const panelBottom = panel.box.pos[1]
      const panelTop = panelBottom + panel.box.size[1]

      const rows = [grid.frontSetback]
      const backRow = panel.width - grid.backSetback
      if (grid.backSetback > 0 && Math.abs(backRow - grid.frontSetback) > 1) {
        rows.push(backRow)
      }

      // The full row of holes you would actually drill, so shelves stay adjustable.
      const gridHeights: number[] = []
      const first = Math.ceil((panelBottom - datumY - grid.origin) / grid.pitch)
      for (let k = Math.max(0, first); ; k++) {
        const y = datumY + grid.origin + k * grid.pitch
        if (y > panelTop) break
        if (y >= panelBottom) gridHeights.push(mm(y - panelBottom))
      }

      const used = new Set([...heights].map((h) => mm(h - panelBottom)))
      const holes: Hole[] = []
      for (const u of gridHeights) {
        for (const v of rows) {
          holes.push({
            u,
            v: mm(v),
            diameter: grid.diameter,
            depth: grid.depth,
            used: [...used].some((x) => Math.abs(x - u) < EPS),
          })
        }
      }

      out.push({
        partId,
        cabinetName: cab.name,
        label: panel.label,
        length: panel.length,
        width: panel.width,
        thickness: panel.thickness,
        grid,
        rows: rows.map(mm),
        holes,
        shelfHeights: [...used].sort((a, b) => a - b),
        gridHeights,
      })
    }
  }

  return out.sort(
    (a, b) => a.cabinetName.localeCompare(b.cabinetName) || a.label.localeCompare(b.label),
  )
}

/** Vertical panels whose inner face closes the cell at x0 or x1. */
function boundingPanels(parts: Part[], x0: number, x1: number): Part[] {
  return parts.filter((p) => {
    if (p.thicknessAxis !== 'x') return false
    const left = p.box.pos[0]
    const right = left + p.box.size[0]
    return Math.abs(right - x0) < EPS || Math.abs(left - x1) < EPS
  })
}

function flatten(node: FurnitureNode): FurnitureNode[] {
  return node.kind === 'split'
    ? [node, ...node.children.flatMap(flatten)]
    : [node]
}

/** Total holes to drill, for a quick sense of the job ahead. */
export function countHoles(panels: PanelDrilling[]): { total: number; used: number } {
  return {
    total: panels.reduce((sum, p) => sum + p.holes.length, 0),
    used: panels.reduce((sum, p) => sum + p.holes.filter((h) => h.used).length, 0),
  }
}

export function drillingToCsv(panels: PanelDrilling[]): string {
  const rows = panels.flatMap((panel) =>
    panel.holes.map((h) => [
      panel.cabinetName,
      panel.label,
      `${panel.length}x${panel.width}x${panel.thickness}`,
      h.u,
      h.v,
      h.diameter,
      h.depth,
      h.used ? 'shelf here' : 'spare',
    ]),
  )
  const header = [
    'Cabinet',
    'Panel',
    'Cut size (mm)',
    'From bottom edge (mm)',
    'From front edge (mm)',
    'Drill dia (mm)',
    'Depth (mm)',
    'Note',
  ]
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(escape).join(',')).join('\n')
}

export function unusedCabinets(design: Design): Cabinet[] {
  return design.cabinets.filter((c) => !c.holeGrid?.enabled)
}
