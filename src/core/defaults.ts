import { newId } from './ids'
import type {
  BandingSpec,
  Cabinet,
  CellNode,
  Content,
  Design,
  DesignSettings,
  Material,
  Worktop,
} from './types'
import { DEFAULT_HOLE_GRID, SCHEMA_VERSION, flex } from './types'

export const MAT_MDF18 = 'mdf18'
export const MAT_MDF15 = 'mdf15'
export const MAT_MDF12 = 'mdf12'
export const MAT_MDF6 = 'mdf6'

export function defaultMaterials(): Material[] {
  return [
    {
      id: MAT_MDF18,
      name: 'MDF 18mm',
      thickness: 18,
      sheet: { length: 2440, width: 1220 },
      pricePerSheet: 45,
      hasGrain: false,
      color: '#c9a87c',
    },
    {
      id: MAT_MDF15,
      name: 'MDF 15mm',
      thickness: 15,
      sheet: { length: 2440, width: 1220 },
      pricePerSheet: 38,
      hasGrain: false,
      color: '#d2b489',
    },
    {
      id: MAT_MDF12,
      name: 'MDF 12mm',
      thickness: 12,
      sheet: { length: 2440, width: 1220 },
      pricePerSheet: 32,
      hasGrain: false,
      color: '#d9bf99',
    },
    {
      id: MAT_MDF6,
      name: 'MDF 6mm (backs)',
      thickness: 6,
      sheet: { length: 2440, width: 1220 },
      pricePerSheet: 18,
      hasGrain: false,
      color: '#b08e63',
    },
  ]
}

export function defaultSettings(): DesignSettings {
  return {
    kerf: 3,
    sheetTrim: 10,
    hardware: {
      shelfPin: 0.15,
      jointFixing: 0.12,
      drawerSlidePair: 8.5,
      hinge: 2.4,
      handle: 4,
      edgeBandingPerMetre: 1.2,
    },
  }
}

export const defaultBanding = (): BandingSpec => ({
  enabled: true,
  thickness: 1,
  compensate: true,
})

export const emptyCell = (): CellNode => ({
  id: newId('n'),
  kind: 'cell',
  content: { type: 'empty' },
})

export const cellWith = (content: Content): CellNode => ({
  id: newId('n'),
  kind: 'cell',
  content,
})

export const shelvesContent = (count = 3): Content => ({
  type: 'shelves',
  count,
  setback: 0,
  fixed: false,
})

export const drawersContent = (count = 3): Content => ({
  type: 'drawers',
  count,
  heights: Array.from({ length: count }, () => flex(1)),
  slideClearance: 12.7,
  gap: 3,
  boxHeightReduction: 30,
  boxBackClearance: 10,
  boxMaterialId: MAT_MDF12,
  bottomMaterialId: MAT_MDF6,
})

export function newCabinet(overrides: Partial<Cabinet> = {}): Cabinet {
  return {
    id: newId('cab'),
    name: 'Cabinet',
    width: 800,
    height: 720,
    depth: 400,
    materialId: MAT_MDF18,
    carcass: 'sides-full',
    back: { style: 'rebate', thickness: 6, rebateDepth: 9, materialId: MAT_MDF6 },
    banding: defaultBanding(),
    holeGrid: { ...DEFAULT_HOLE_GRID },
    root: cellWith(shelvesContent(3)),
    transform: { x: 0, y: 0, z: 0, rotY: 0 },
    ...overrides,
  }
}

export function newWorktop(overrides: Partial<Worktop> = {}): Worktop {
  return {
    id: newId('wt'),
    name: 'Worktop',
    shape: 'rect',
    materialId: MAT_MDF18,
    a: { length: 1600, depth: 600 },
    b: { length: 1400, depth: 600 },
    seam: 'a',
    banding: defaultBanding(),
    transform: { x: 0, y: 720, z: 0, rotY: 0 },
    ...overrides,
  }
}

/** A single shelf unit — what you get when you start from scratch. */
export function newDesign(): Design {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled design',
    materials: defaultMaterials(),
    cabinets: [newCabinet({ name: 'Shelf unit', height: 1200, depth: 300 })],
    worktops: [],
    settings: defaultSettings(),
  }
}

/**
 * The worked example: an L-shaped desk built from two pedestals and an L worktop.
 *
 * Leg A runs 1600mm along +X, leg B runs 1400mm back along +Z, both 600mm deep.
 * The left pedestal carries drawers, the right one shelves.
 */
export function lDeskDesign(): Design {
  const worktopThickness = 18
  const pedestalHeight = 720 - worktopThickness

  const drawers = newCabinet({
    name: 'Drawer pedestal',
    width: 450,
    height: pedestalHeight,
    depth: 580,
    root: cellWith(drawersContent(3)),
    transform: { x: 40, y: 0, z: 10, rotY: 0 },
  })

  const shelves = newCabinet({
    name: 'Shelf pedestal',
    width: 450,
    height: pedestalHeight,
    depth: 580,
    root: cellWith(shelvesContent(2)),
    transform: { x: 1110, y: 0, z: 10, rotY: 0 },
  })

  const worktop = newWorktop({
    name: 'L desktop',
    shape: 'L',
    a: { length: 1600, depth: 600 },
    b: { length: 1400, depth: 600 },
    seam: 'a',
    transform: { x: 0, y: pedestalHeight, z: 0, rotY: 0 },
  })

  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'L-shaped desk',
    materials: defaultMaterials(),
    cabinets: [drawers, shelves],
    worktops: [worktop],
    settings: defaultSettings(),
  }
}
