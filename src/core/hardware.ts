import type { BomSummary } from './bom'
import type { Design, FurnitureNode, Part } from './types'

export interface HardwareItem {
  name: string
  quantity: number
  unit: string
  unitPrice: number
  total: number
}

export interface CostSummary {
  hardware: HardwareItem[]
  hardwareTotal: number
  sheets: { materialId: string; materialName: string; sheets: number; pricePerSheet: number; total: number }[]
  sheetsTotal: number
  bandingTotal: number
  grandTotal: number
}

/** One fixing per this many mm of joint, with a sensible minimum per joint. */
const FIXING_SPACING = 200
const MIN_FIXINGS_PER_JOINT = 2

const fixingsFor = (jointLength: number) =>
  Math.max(MIN_FIXINGS_PER_JOINT, Math.ceil(jointLength / FIXING_SPACING))

function walkContent(node: FurnitureNode, visit: (node: FurnitureNode) => void): void {
  visit(node)
  if (node.kind === 'split') for (const child of node.children) walkContent(child, visit)
}

/**
 * Hardware counts derived from the design tree and the generated parts.
 *
 * Counts come from the tree (which knows a shelf is adjustable and therefore needs
 * pins), while joint fixings come from the parts (which know how long each joint is).
 */
export function buildHardware(design: Design, parts: Part[]): HardwareItem[] {
  const prices = design.settings.hardware
  let shelfPins = 0
  let slidePairs = 0
  let hinges = 0
  let handles = 0

  for (const cab of design.cabinets) {
    walkContent(cab.root, (node) => {
      if (node.kind !== 'cell') return
      const content = node.content
      if (content.type === 'shelves' && !content.fixed) {
        shelfPins += content.count * 4
      } else if (content.type === 'drawers') {
        slidePairs += content.count
        handles += content.count
      } else if (content.type === 'door') {
        // Tall doors need a third hinge.
        hinges += cab.height > 900 ? 3 : 2
        handles += 1
      }
    })
  }

  // Joint fixings: every panel that lands between two others is fixed at both ends.
  let fixings = 0
  for (const p of parts) {
    if (p.role === 'top' || p.role === 'bottom' || p.role === 'divider') {
      fixings += 2 * fixingsFor(p.width)
    }
  }

  const backPerimeterFixings = parts
    .filter((p) => p.role === 'back')
    .reduce((sum, p) => sum + Math.ceil((2 * (p.length + p.width)) / 150), 0)

  const items: HardwareItem[] = [
    { name: 'Shelf pins', quantity: shelfPins, unit: 'ea', unitPrice: prices.shelfPin, total: 0 },
    {
      name: 'Carcass fixings (screws / dowels)',
      quantity: fixings + backPerimeterFixings,
      unit: 'ea',
      unitPrice: prices.jointFixing,
      total: 0,
    },
    {
      name: 'Drawer slide pairs',
      quantity: slidePairs,
      unit: 'pair',
      unitPrice: prices.drawerSlidePair,
      total: 0,
    },
    { name: 'Hinges', quantity: hinges, unit: 'ea', unitPrice: prices.hinge, total: 0 },
    { name: 'Handles', quantity: handles, unit: 'ea', unitPrice: prices.handle, total: 0 },
  ]

  for (const item of items) item.total = item.quantity * item.unitPrice
  return items.filter((item) => item.quantity > 0)
}

/**
 * Total material cost. `sheetCounts` comes from the nester when a cut plan has been
 * run; otherwise the area-based minimum from the BOM is used, which under-counts
 * because it ignores offcuts.
 */
export function buildCost(
  design: Design,
  bom: BomSummary,
  hardware: HardwareItem[],
  sheetCounts?: Map<string, number>,
): CostSummary {
  const sheets = bom.byMaterial
    .filter((m) => !m.supplied)
    .map((m) => {
      const material = design.materials.find((x) => x.id === m.materialId)
      const count = sheetCounts?.get(m.materialId) ?? m.minSheets
      const pricePerSheet = material?.pricePerSheet ?? 0
      return {
        materialId: m.materialId,
        materialName: m.materialName,
        sheets: count,
        pricePerSheet,
        total: count * pricePerSheet,
      }
    })

  const hardwareTotal = hardware.reduce((sum, h) => sum + h.total, 0)
  const sheetsTotal = sheets.reduce((sum, s) => sum + s.total, 0)
  const bandingTotal = bom.totalBandingMetres * design.settings.hardware.edgeBandingPerMetre

  return {
    hardware,
    hardwareTotal,
    sheets,
    sheetsTotal,
    bandingTotal,
    grandTotal: hardwareTotal + sheetsTotal + bandingTotal,
  }
}
