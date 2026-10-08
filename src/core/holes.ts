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
 * How deep to drill into a shelf's edge.
 *
 * What it really has to swallow is however much of the pin stands proud of the
 * side panel, which depends on the pin — so this is a starting point, named in the
 * generated jig source so it can be changed, not a derived number pretending to be
 * one.
 */
export const SHELF_EDGE_DEPTH = 10

/**
 * Where the pin holes go in a shelf's two ENDS.
 *
 * Only needed when the pins are meant to capture the shelf rather than just hold it
 * up. The holes have to agree with the rows already drilled in the side panels, and
 * the only honest way to work that out is to take the side panel's rows and carry
 * them into the shelf's own coordinates — the two parts can disagree about where
 * their front edges are, because a shelf may be set back from the carcass front.
 */
export interface ShelfEdgeHoles {
  partId: string
  cabinetName: string
  label: string
  /** Cut size of the shelf. */
  length: number
  width: number
  thickness: number
  /** Hole centres in each end, measured from the shelf's FRONT edge. */
  rows: number[]
  /** The same rows measured from whichever edge is nearer — what a fence needs. */
  fromNearestEdge: number[]
  diameter: number
  depth: number
  /** Hole centre across the thickness. Half of it, which is the whole point. */
  centre: number
  warnings: string[]
}

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

/**
 * Pin holes in the ENDS of every adjustable shelf.
 *
 * The rows are not invented here — they are read off the side panels that already
 * carry the pins and carried into the shelf's own coordinates, so the two cannot
 * disagree. That matters because a shelf can be set back from the carcass front, in
 * which case 37mm from the side panel's front edge is NOT 37mm from the shelf's.
 */
export function buildShelfEdges(design: Design): ShelfEdgeHoles[] {
  const mat = materialLookup(design)
  const out: ShelfEdgeHoles[] = []

  for (const cab of design.cabinets) {
    const grid = cab.holeGrid
    if (!grid?.enabled || grid.pitch <= 0) continue

    const { parts, regions } = buildCabinet(cab, mat)

    for (const node of flatten(cab.root)) {
      if (node.kind !== 'cell' || node.content.type !== 'shelves') continue
      if (node.content.fixed || node.content.count <= 0) continue

      const region = regions.find((r) => r.nodeId === node.id)?.region
      if (!region) continue

      const sides = boundingPanels(parts, region.x0, region.x1)
      if (!sides.length) continue

      for (const shelf of parts.filter((p) => p.nodeId === node.id && p.role === 'shelf')) {
        const warnings: string[] = []
        const shelfFront = shelf.box.pos[2] + shelf.box.size[2]
        const rows = new Set<number>()

        for (const side of sides) {
          // Both parts band their front edge the same way, or the cut edges this is
          // all measured from are a band thickness apart and the pins will not line
          // up. There is no band thickness on a Part to correct it with, so say so.
          if (side.edgeBanding.alongLength[1] !== shelf.edgeBanding.alongLength[1]) {
            warnings.push(
              `${side.label} and this shelf do not band their front edges the same way, ` +
                `so these rows are out by one banding thickness. Check before drilling.`,
            )
          }

          const sideFront = side.box.pos[2] + side.box.size[2]
          const offset = shelfFront - sideFront
          for (const v of [grid.frontSetback, side.width - grid.backSetback]) {
            if (grid.backSetback <= 0 && v !== grid.frontSetback) continue
            rows.add(mm(v + offset))
          }
        }

        const list = [...rows].sort((a, b) => a - b)
        for (const row of list) {
          if (row < grid.diameter || row > shelf.width - grid.diameter) {
            warnings.push(
              `A row lands ${row}mm from the front edge of a ${shelf.width}mm shelf — ` +
                `off the end of it. The shelf and the side panel do not share a front face.`,
            )
          }
        }
        if (shelf.thickness < grid.diameter + MIN_SHELF_EDGE_WALL * 2) {
          warnings.push(
            `A ${grid.diameter}mm hole centred in a ${shelf.thickness}mm edge leaves ` +
              `${mm((shelf.thickness - grid.diameter) / 2)}mm either side. It will break out.`,
          )
        }

        out.push({
          partId: shelf.id,
          cabinetName: cab.name,
          label: shelf.label,
          length: shelf.length,
          width: shelf.width,
          thickness: shelf.thickness,
          rows: list,
          fromNearestEdge: dedupeNear(
            list.map((r) => mm(Math.min(r, shelf.width - r))),
          ),
          diameter: grid.diameter,
          depth: SHELF_EDGE_DEPTH,
          centre: mm(shelf.thickness / 2),
          warnings: [...new Set(warnings)],
        })
      }
    }
  }

  return out.sort(
    (a, b) => a.cabinetName.localeCompare(b.cabinetName) || a.label.localeCompare(b.label),
  )
}

/** Below this much material either side, a hole in an edge breaks out of the face. */
export const MIN_SHELF_EDGE_WALL = 3

const dedupeNear = (values: number[]): number[] =>
  [...values].sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > 0.5)

/**
 * Shelves of identical size and rows are one drilling setup, not several.
 *
 * Six identical shelves do not need six cards; what you want to know is how many
 * times to repeat the same two cuts.
 */
export function groupShelfEdges(
  edges: ShelfEdgeHoles[],
): { edge: ShelfEdgeHoles; count: number; shelves: string[] }[] {
  const groups = new Map<string, { edge: ShelfEdgeHoles; count: number; shelves: string[] }>()
  for (const edge of edges) {
    const key = `${edge.length}x${edge.width}x${edge.thickness}|${edge.rows.join(',')}`
    const found = groups.get(key)
    if (found) {
      found.count++
      found.shelves.push(`${edge.cabinetName} — ${edge.label}`)
    } else {
      groups.set(key, {
        edge,
        count: 1,
        shelves: [`${edge.cabinetName} — ${edge.label}`],
      })
    }
  }
  return [...groups.values()]
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
