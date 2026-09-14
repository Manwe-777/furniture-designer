import { box, mm, type Region } from '../geom'
import type {
  Axis,
  Box,
  Cabinet,
  CellNode,
  DoorContent,
  EdgeBanding,
  FurnitureNode,
  Material,
  Part,
  PartRole,
  ShelvesContent,
} from '../types'
import { NO_BANDING, NO_OMISSIONS } from '../types'
import { resolveSizes, spanSlack } from './span'
import { buildDrawers } from './buildDrawer'

export interface Warning {
  message: string
  cabinetId?: string
  nodeId?: string
}

/**
 * Where a node ended up inside its cabinet. The 2D elevation needs these to make
 * empty cells clickable — a cell with nothing in it produces no parts, but it is
 * still the thing you click on to put something there.
 */
export interface NodeRegion {
  nodeId: string
  cabinetId: string
  kind: 'split' | 'cell'
  depth: number
  region: Region
}

export interface BuildResult {
  parts: Part[]
  warnings: Warning[]
  regions: NodeRegion[]
  /** Carcass interior floor height — the datum the 32mm hole grid measures from. */
  datumY?: number
}

export type MaterialLookup = (id: string) => Material

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/** Banding on the front edge only — the standard treatment for a carcass panel. */
export const frontBand = (): EdgeBanding => ({
  alongLength: [false, true],
  alongWidth: [false, false],
})

export const allEdgesBand = (): EdgeBanding => ({
  alongLength: [true, true],
  alongWidth: [true, true],
})

export const countBanded = (b: EdgeBanding): number =>
  (b.alongLength[0] ? 1 : 0) +
  (b.alongLength[1] ? 1 : 0) +
  (b.alongWidth[0] ? 1 : 0) +
  (b.alongWidth[1] ? 1 : 0)

export interface PanelSpec {
  role: PartRole
  label: string
  materialId: string
  thickness: number
  /** Local-space box, before the owner's transform. */
  box: Box
  thicknessAxis: Axis
  /** Which of the two remaining axes is the part's `length` (the grain direction). */
  lengthAxis: Axis
  banding?: EdgeBanding
  nodeId?: string
}

/**
 * Collects panels, turning each 3D box into a cut rectangle.
 *
 * The box keeps the FINISHED size (what you see in 3D). `length`/`width` are the
 * CUT size, which is smaller when edge banding is compensated — that difference is
 * exactly the mistake this app exists to prevent.
 */
export class PartCollector {
  readonly parts: Part[] = []
  readonly warnings: Warning[] = []
  readonly regions: NodeRegion[] = []
  /** Height of the carcass interior floor — the datum for the 32mm hole grid. */
  datumY = 0
  private counters = new Map<string, number>()

  constructor(
    private readonly ownerId: string,
    private readonly bandThickness: number,
    private readonly compensate: boolean,
  ) {}

  warn(message: string, nodeId?: string): void {
    this.warnings.push({ message, cabinetId: this.ownerId, nodeId })
  }

  addRegion(node: { id: string; kind: 'split' | 'cell' }, region: Region, depth: number): void {
    this.regions.push({
      nodeId: node.id,
      cabinetId: this.ownerId,
      kind: node.kind,
      depth,
      region,
    })
  }

  add(spec: PanelSpec): Part | undefined {
    const { size } = spec.box
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) {
      this.warn(`${spec.label} has a zero or negative dimension and was skipped`, spec.nodeId)
      return undefined
    }

    const otherAxis: Axis = (['x', 'y', 'z'] as Axis[]).find(
      (a) => a !== spec.thicknessAxis && a !== spec.lengthAxis,
    )!

    const banding = spec.banding ?? NO_BANDING
    let length = size[AXIS_INDEX[spec.lengthAxis]]
    let width = size[AXIS_INDEX[otherAxis]]

    if (this.compensate && this.bandThickness > 0) {
      // An edge running along the length sits at an end of the WIDTH axis, so
      // banding it grows the width — cut it undersize by that much.
      width -= this.bandThickness * (Number(banding.alongLength[0]) + Number(banding.alongLength[1]))
      length -= this.bandThickness * (Number(banding.alongWidth[0]) + Number(banding.alongWidth[1]))
    }

    const n = (this.counters.get(spec.role) ?? 0) + 1
    this.counters.set(spec.role, n)

    const part: Part = {
      id: `${this.ownerId}:${spec.role}:${n}`,
      nodeId: spec.nodeId,
      cabinetId: this.ownerId,
      label: spec.label,
      role: spec.role,
      materialId: spec.materialId,
      thickness: spec.thickness,
      length: mm(length),
      width: mm(width),
      grain: 'length',
      edgeBanding: banding,
      thicknessAxis: spec.thicknessAxis,
      box: spec.box,
    }
    this.parts.push(part)
    return part
  }
}

/**
 * Turn a cabinet into its panels.
 *
 * Construction rules applied here, in order:
 *  - plinth (optional) raises the carcass and contributes its own rails
 *  - back style decides how much depth the carcass and the interior lose
 *  - carcass style decides which panels run through the corner joint
 *  - the split tree subdivides the interior, emitting a divider between children
 *  - cell contents (shelves / drawers / door) fill the leaves
 */
export function buildCabinet(cab: Cabinet, mat: MaterialLookup): BuildResult {
  const carcassMat = mat(cab.materialId)
  const t = carcassMat.thickness
  const { width: W, height: H, depth: D } = cab

  const band = cab.banding.enabled ? cab.banding.thickness : 0
  const c = new PartCollector(cab.id, band, cab.banding.enabled && cab.banding.compensate)

  const backMatId = cab.back.materialId ?? cab.materialId
  const tb = cab.back.style === 'none' ? 0 : mat(backMatId).thickness

  const plinthH = cab.plinth?.height ?? 0
  const carcassY0 = plinthH
  const carcassY1 = H

  // An overlay back is screwed onto the rear face, so the carcass itself starts
  // one back-thickness forward. Every other style sits inside the carcass depth.
  const carcassZ0 = cab.back.style === 'overlay' ? tb : 0
  const carcassZ1 = D
  const carcassDepth = carcassZ1 - carcassZ0
  const interiorZ0 = cab.back.style === 'none' ? carcassZ0 : tb

  // Thickness contributed by each face. An omitted face contributes nothing, so
  // the panels that remain — and the interior — run out to the cabinet boundary
  // and meet the neighbouring module's panel there.
  const omit = cab.omit ?? NO_OMISSIONS
  const leftT = omit.left ? 0 : t
  const rightT = omit.right ? 0 : t
  const topT = omit.top ? 0 : t
  const botT = omit.bottom ? 0 : t

  if (
    W - leftT - rightT <= 0 ||
    carcassY1 - carcassY0 - topT - botT <= 0 ||
    carcassDepth <= 0
  ) {
    c.warn('Cabinet is too small for its material thickness')
    return { parts: c.parts, warnings: c.warnings, regions: c.regions }
  }

  // ---- plinth -------------------------------------------------------------
  if (cab.plinth && plinthH > 0) {
    const setback = cab.plinth.setback
    const railZ1 = D - setback
    if (railZ1 - t <= 0) {
      c.warn('Plinth setback is deeper than the cabinet')
    } else {
      c.add({
        role: 'plinth',
        label: 'Plinth side rail',
        materialId: cab.materialId,
        thickness: t,
        box: box(0, t, 0, plinthH, 0, railZ1),
        thicknessAxis: 'x',
        lengthAxis: 'z',
      })
      c.add({
        role: 'plinth',
        label: 'Plinth side rail',
        materialId: cab.materialId,
        thickness: t,
        box: box(W - t, W, 0, plinthH, 0, railZ1),
        thicknessAxis: 'x',
        lengthAxis: 'z',
      })
      c.add({
        role: 'plinth',
        label: 'Plinth front rail',
        materialId: cab.materialId,
        thickness: t,
        box: box(t, W - t, 0, plinthH, railZ1 - t, railZ1),
        thicknessAxis: 'z',
        lengthAxis: 'x',
      })
      c.add({
        role: 'plinth',
        label: 'Plinth back rail',
        materialId: cab.materialId,
        thickness: t,
        box: box(t, W - t, 0, plinthH, 0, t),
        thicknessAxis: 'z',
        lengthAxis: 'x',
      })
    }
  }

  // ---- carcass ------------------------------------------------------------
  if (cab.carcass === 'sides-full') {
    // Sides run the full height; top and bottom land between them.
    if (!omit.left) {
      c.add({
        role: 'side',
        label: 'Side (left)',
        materialId: cab.materialId,
        thickness: t,
        box: box(0, t, carcassY0, carcassY1, carcassZ0, carcassZ1),
        thicknessAxis: 'x',
        lengthAxis: 'y',
        banding: frontBand(),
      })
    }
    if (!omit.right) {
      c.add({
        role: 'side',
        label: 'Side (right)',
        materialId: cab.materialId,
        thickness: t,
        box: box(W - t, W, carcassY0, carcassY1, carcassZ0, carcassZ1),
        thicknessAxis: 'x',
        lengthAxis: 'y',
        banding: frontBand(),
      })
    }
    if (!omit.top) {
      c.add({
        role: 'top',
        label: 'Top',
        materialId: cab.materialId,
        thickness: t,
        box: box(leftT, W - rightT, carcassY1 - t, carcassY1, carcassZ0, carcassZ1),
        thicknessAxis: 'y',
        lengthAxis: 'x',
        banding: frontBand(),
      })
    }
    if (!omit.bottom) {
      c.add({
        role: 'bottom',
        label: 'Bottom',
        materialId: cab.materialId,
        thickness: t,
        box: box(leftT, W - rightT, carcassY0, carcassY0 + t, carcassZ0, carcassZ1),
        thicknessAxis: 'y',
        lengthAxis: 'x',
        banding: frontBand(),
      })
    }
  } else {
    // Top and bottom run the full width; the sides land between them.
    if (!omit.top) {
      c.add({
        role: 'top',
        label: 'Top',
        materialId: cab.materialId,
        thickness: t,
        box: box(0, W, carcassY1 - t, carcassY1, carcassZ0, carcassZ1),
        thicknessAxis: 'y',
        lengthAxis: 'x',
        banding: frontBand(),
      })
    }
    if (!omit.bottom) {
      c.add({
        role: 'bottom',
        label: 'Bottom',
        materialId: cab.materialId,
        thickness: t,
        box: box(0, W, carcassY0, carcassY0 + t, carcassZ0, carcassZ1),
        thicknessAxis: 'y',
        lengthAxis: 'x',
        banding: frontBand(),
      })
    }
    if (!omit.left) {
      c.add({
        role: 'side',
        label: 'Side (left)',
        materialId: cab.materialId,
        thickness: t,
        box: box(0, t, carcassY0 + botT, carcassY1 - topT, carcassZ0, carcassZ1),
        thicknessAxis: 'x',
        lengthAxis: 'y',
        banding: frontBand(),
      })
    }
    if (!omit.right) {
      c.add({
        role: 'side',
        label: 'Side (right)',
        materialId: cab.materialId,
        thickness: t,
        box: box(W - t, W, carcassY0 + botT, carcassY1 - topT, carcassZ0, carcassZ1),
        thicknessAxis: 'x',
        lengthAxis: 'y',
        banding: frontBand(),
      })
    }
  }

  // ---- back ---------------------------------------------------------------
  if (cab.back.style !== 'none') {
    const r = cab.back.style === 'rebate' ? cab.back.rebateDepth : 0
    const isOverlay = cab.back.style === 'overlay'
    // A groove can only be cut into a panel that exists, so an omitted face gets
    // no rebate allowance — the back simply stops at the cabinet boundary.
    const bx0 = isOverlay ? 0 : leftT - (omit.left ? 0 : r)
    const bx1 = isOverlay ? W : W - rightT + (omit.right ? 0 : r)
    const by0 = isOverlay ? carcassY0 : carcassY0 + botT - (omit.bottom ? 0 : r)
    const by1 = isOverlay ? carcassY1 : carcassY1 - topT + (omit.top ? 0 : r)
    c.add({
      role: 'back',
      label: 'Back',
      materialId: backMatId,
      thickness: tb,
      box: box(bx0, bx1, by0, by1, 0, tb),
      thicknessAxis: 'z',
      lengthAxis: 'y',
    })
  }

  // ---- interior -----------------------------------------------------------
  const interior: Region = {
    x0: leftT,
    x1: W - rightT,
    y0: carcassY0 + botT,
    y1: carcassY1 - topT,
    z0: interiorZ0,
    z1: D,
  }

  c.datumY = interior.y0
  walk(cab.root, interior, cab, c, mat, 0)

  return { parts: c.parts, warnings: c.warnings, regions: c.regions, datumY: c.datumY }
}

function walk(
  node: FurnitureNode,
  region: Region,
  cab: Cabinet,
  c: PartCollector,
  mat: MaterialLookup,
  depth: number,
): void {
  c.addRegion(node, region, depth)

  if (node.kind === 'cell') {
    fillCell(node, region, cab, c, mat)
    return
  }

  const n = node.children.length
  if (n === 0) return

  const dt = node.dividerThickness
  const dividerMatId = node.materialId ?? cab.materialId
  const span = node.dir === 'v' ? region.x1 - region.x0 : region.y1 - region.y0
  const sizes = resolveSizes(node.sizes, span, dt)

  // Fixed children can overflow while still being individually positive, so check
  // the leftover span as well as the resolved sizes.
  if (sizes.some((s) => s <= 0) || spanSlack(node.sizes, span, dt) < 0) {
    c.warn(
      `Split does not fit: ${n} children plus ${n - 1} divider(s) need more than the ${mm(span)}mm available`,
      node.id,
    )
  }

  let cursor = node.dir === 'v' ? region.x0 : region.y0

  for (let i = 0; i < n; i++) {
    const size = Math.max(0, sizes[i])
    const childRegion: Region =
      node.dir === 'v'
        ? { ...region, x0: cursor, x1: cursor + size }
        : { ...region, y0: cursor, y1: cursor + size }

    if (size > 0) walk(node.children[i], childRegion, cab, c, mat, depth + 1)
    cursor += size

    if (i < n - 1) {
      if (node.dir === 'v') {
        c.add({
          role: 'divider',
          label: 'Vertical divider',
          materialId: dividerMatId,
          thickness: dt,
          box: box(cursor, cursor + dt, region.y0, region.y1, region.z0, region.z1),
          thicknessAxis: 'x',
          lengthAxis: 'y',
          banding: frontBand(),
          nodeId: node.id,
        })
      } else {
        c.add({
          role: 'divider',
          label: 'Fixed shelf / divider',
          materialId: dividerMatId,
          thickness: dt,
          box: box(region.x0, region.x1, cursor, cursor + dt, region.z0, region.z1),
          thicknessAxis: 'y',
          lengthAxis: 'x',
          banding: frontBand(),
          nodeId: node.id,
        })
      }
      cursor += dt
    }
  }
}

function fillCell(
  node: CellNode,
  region: Region,
  cab: Cabinet,
  c: PartCollector,
  mat: MaterialLookup,
): void {
  switch (node.content.type) {
    case 'empty':
      return
    case 'shelves':
      addShelves(node.content, node.id, region, cab, c, mat)
      return
    case 'door':
      addDoor(node.content, node.id, region, cab, c, mat)
      return
    case 'drawers':
      buildDrawers(node.content, node.id, region, cab, c, mat)
      return
  }
}

function addShelves(
  content: ShelvesContent,
  nodeId: string,
  region: Region,
  cab: Cabinet,
  c: PartCollector,
  mat: MaterialLookup,
): void {
  const count = Math.max(0, Math.floor(content.count))
  if (count === 0) return

  const matId = content.materialId ?? cab.materialId
  const ts = content.thickness ?? mat(matId).thickness
  const cellHeight = region.y1 - region.y0
  const z1 = region.z1 - content.setback

  if (cellHeight - count * ts <= 0) {
    c.warn(`${count} shelves do not fit in a ${mm(cellHeight)}mm opening`, nodeId)
    return
  }

  // Equal openings between the shelves unless explicit positions were given.
  const opening = (cellHeight - count * ts) / (count + 1)
  const grid = cab.holeGrid

  let lastSnapped = -Infinity
  for (let i = 0; i < count; i++) {
    const offset = content.positions?.[i] ?? (i + 1) * opening + i * ts
    let y0 = region.y0 + offset

    // Land the shelf on a hole so one jig drills every panel in the project.
    // Fixed shelves are housed into the sides, not sitting on pins, so they keep
    // their exact position.
    if (grid?.enabled && !content.fixed && grid.pitch > 0) {
      const steps = Math.round((y0 - c.datumY - grid.origin) / grid.pitch)
      let snapped = c.datumY + grid.origin + steps * grid.pitch
      // Keep it inside the opening, and never put two shelves on the same hole.
      while (snapped <= lastSnapped || snapped < region.y0) snapped += grid.pitch
      while (snapped + ts > region.y1 && snapped - grid.pitch > lastSnapped) {
        snapped -= grid.pitch
      }
      if (snapped >= region.y0 && snapped + ts <= region.y1) {
        y0 = mm(snapped)
        lastSnapped = snapped
      }
    }
    c.add({
      role: 'shelf',
      label: content.fixed ? 'Fixed shelf' : 'Shelf',
      materialId: matId,
      thickness: ts,
      box: box(region.x0, region.x1, y0, y0 + ts, region.z0, z1),
      thicknessAxis: 'y',
      lengthAxis: 'x',
      banding: frontBand(),
      nodeId,
    })
  }
}

function addDoor(
  content: DoorContent,
  nodeId: string,
  region: Region,
  cab: Cabinet,
  c: PartCollector,
  mat: MaterialLookup,
): void {
  const matId = content.materialId ?? cab.materialId
  const td = mat(matId).thickness
  const g = content.gap
  c.add({
    role: 'door',
    label: `Door (${content.hinge} hinge)`,
    materialId: matId,
    thickness: td,
    box: box(
      region.x0 + g,
      region.x1 - g,
      region.y0 + g,
      region.y1 - g,
      region.z1 - td,
      region.z1,
    ),
    thicknessAxis: 'z',
    lengthAxis: 'y',
    banding: allEdgesBand(),
    nodeId,
  })
}
