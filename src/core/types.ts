/**
 * Core domain types. Pure data — no React, no three.js, no DOM.
 *
 * Units are millimetres throughout. Coordinates are Y-up (three.js convention):
 *   +X = right, +Y = up, +Z = towards the viewer (the FRONT of the furniture).
 *
 * A cabinet's local space has its origin at the bottom-left-BACK corner, so the
 * cabinet occupies x∈[0,W], y∈[0,H], z∈[0,D] and its front face is at z = D.
 */

export type Axis = 'x' | 'y' | 'z'

/** An axis-aligned box stored as its minimum corner plus extents (not a centre). */
export interface Box {
  /** Minimum corner [x, y, z]. */
  pos: [number, number, number]
  /** Extents [dx, dy, dz], all positive. */
  size: [number, number, number]
}

export interface Material {
  id: string
  name: string
  /** Sheet thickness in mm. */
  thickness: number
  /** Raw sheet size as sold. `length` is the grain direction for grained materials. */
  sheet: { length: number; width: number }
  pricePerSheet: number
  /** MDF has no grain, so parts may be rotated freely when nesting. Veneer/ply does. */
  hasGrain: boolean
  /**
   * Not cut from sheets — a solid timber plank, a glass shelf, a stone top,
   * something bought to size.
   *
   * Parts in this material are left out of the nesting entirely and never counted
   * towards sheets, but they stay in the bill of materials with their dimensions,
   * because you still have to order the thing. This lives on the material rather
   * than on individual parts on purpose: "does not come off a sheet" is a fact
   * about the stuff, and a per-part flag could disagree with the material it
   * claimed to be.
   */
  supplied?: boolean
  /** Display colour in the 3D and 2D views. */
  color: string
}

/**
 * Which edges of a part's cut rectangle carry edge banding.
 *
 * A part is a rectangle of `length` × `width`. It has two edges that RUN ALONG its
 * length (each `length` mm long, sitting at the low and high ends of the width axis)
 * and two that run along its width. Index 0 is the edge at the lower coordinate,
 * index 1 the higher one.
 *
 * Banding an `alongLength` edge adds material to the `width` dimension, so cut-size
 * compensation subtracts from `width` — and vice versa.
 */
export interface EdgeBanding {
  alongLength: [boolean, boolean]
  alongWidth: [boolean, boolean]
}

export const NO_BANDING: EdgeBanding = {
  alongLength: [false, false],
  alongWidth: [false, false],
}

export type PartRole =
  | 'side'
  | 'top'
  | 'bottom'
  | 'shelf'
  | 'divider'
  | 'back'
  | 'worktop'
  | 'door'
  | 'drawer-face'
  | 'drawer-side'
  | 'drawer-fb'
  | 'drawer-bottom'
  | 'plinth'

/**
 * One physical rectangular panel. This is the single currency of the whole app:
 * the 3D view renders `box`, the BOM groups by cut size, the nester packs
 * `length` × `width`.
 */
export interface Part {
  /** Stable across rebuilds, so selection survives an edit. */
  id: string
  /** The design node that produced this part, for selection round-tripping. */
  nodeId?: string
  cabinetId?: string
  label: string
  role: PartRole
  materialId: string
  thickness: number
  /** Cut dimensions. For grained materials `length` runs with the grain. */
  length: number
  width: number
  grain: 'length' | 'none'
  edgeBanding: EdgeBanding
  /** Which local axis the thickness runs along — tells you how the panel lies. */
  thicknessAxis: Axis
  /**
   * Which axis the `length` runs along. Needed to locate the banded edges in space:
   * `alongLength` edges sit at the two ends of the remaining axis, and without this
   * you would have to guess from the measurements, which is ambiguous on a panel
   * that happens to be square.
   */
  lengthAxis: Axis
  /** World-placed bounding box, after the owner's transform is applied. */
  box: Box
}

/** A child's share of a split: either an exact size, or a weighted share of the rest. */
export type Size = { mode: 'fixed'; mm: number } | { mode: 'flex'; weight: number }

export const flex = (weight = 1): Size => ({ mode: 'flex', weight })
export const fixed = (mm: number): Size => ({ mode: 'fixed', mm })

/** 'v' = vertical dividers producing columns; 'h' = horizontal dividers producing rows. */
export type SplitDir = 'v' | 'h'

export interface SplitNode {
  id: string
  kind: 'split'
  dir: SplitDir
  dividerThickness: number
  /** Material for the dividers; falls back to the cabinet material. */
  materialId?: string
  children: FurnitureNode[]
  /** Parallel to `children`. */
  sizes: Size[]
}

export interface CellNode {
  id: string
  kind: 'cell'
  content: Content
}

export type FurnitureNode = SplitNode | CellNode

export type Content = EmptyContent | ShelvesContent | DrawersContent | DoorContent

export interface EmptyContent {
  type: 'empty'
}

export interface ShelvesContent {
  type: 'shelves'
  count: number
  thickness?: number
  materialId?: string
  /** How far the shelf front stops short of the cabinet front face. */
  setback: number
  /**
   * Explicit bottom-face heights above the cell floor, one per shelf. When absent
   * the shelves are spaced to give equal openings.
   */
  positions?: number[]
  /** Fixed shelves are housed into the sides; adjustable ones sit on pins. */
  fixed: boolean
}

export interface DrawersContent {
  type: 'drawers'
  count: number
  /** Face heights, parallel to the drawer stack bottom-to-top. */
  heights: Size[]
  /** Per-side clearance for the runners (12.7mm for standard ball-bearing slides). */
  slideClearance: number
  /** Gap around each drawer face. */
  gap: number
  /** How much shorter the drawer box is than its face. */
  boxHeightReduction: number
  /** Clearance between the back of the drawer box and the cabinet back. */
  boxBackClearance: number
  boxMaterialId?: string
  bottomMaterialId?: string
  faceMaterialId?: string
}

export interface DoorContent {
  type: 'door'
  hinge: 'left' | 'right'
  /** Gap around the door within its opening. */
  gap: number
  materialId?: string
}

export type BackStyle = 'none' | 'overlay' | 'inset' | 'rebate'

export interface BackSpec {
  style: BackStyle
  thickness: number
  /** How deep the groove is cut into the carcass, for `rebate`. */
  rebateDepth: number
  materialId?: string
}

/** Which panels run through the carcass corner joint. */
export type CarcassStyle = 'sides-full' | 'topbottom-full'

/**
 * Faces where this cabinet contributes no panel of its own, because the module it
 * butts against supplies it.
 *
 * The cabinet still occupies its full width/height — an omitted face just has no
 * material of this module's on it, so the remaining panels and the interior run
 * right out to that boundary and meet the neighbour's panel. Place two modules
 * directly adjacent and the shared panel gets cut exactly once.
 */
export interface OmitPanels {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

export const NO_OMISSIONS: OmitPanels = {
  left: false,
  right: false,
  top: false,
  bottom: false,
}

export interface Transform {
  x: number
  y: number
  z: number
  rotY: 0 | 90 | 180 | 270
}

export const IDENTITY: Transform = { x: 0, y: 0, z: 0, rotY: 0 }

export interface BandingSpec {
  enabled: boolean
  thickness: number
  /** Cut parts undersize so the banded panel finishes at its nominal size. */
  compensate: boolean
}

/**
 * The 32mm system: a row of identical holes at a fixed pitch, drilled in every
 * vertical panel from a common datum.
 *
 * It is an open de-facto standard (5mm pins, 32mm pitch, 37mm from the front edge),
 * which is why every parametric drilling jig you can download already assumes it.
 * The point is not the numbers — it is that once every shelf lands on the same grid,
 * one jig registered off one edge drills the whole project, with no per-panel
 * measuring and no chance of a shelf that rocks because two holes disagree.
 */
export interface HoleGrid {
  enabled: boolean
  /** Spacing between hole centres. 32mm is the standard. */
  pitch: number
  /** Height of the first hole above the carcass interior floor. */
  origin: number
  /** Pin hole diameter — 5mm takes a standard shelf pin. */
  diameter: number
  /** How deep to drill. Must not go through the panel. */
  depth: number
  /** Distance from the panel's FRONT edge to the front row of holes. */
  frontSetback: number
  /** Distance from the BACK edge to the rear row. Zero means a single row. */
  backSetback: number
}

export const DEFAULT_HOLE_GRID: HoleGrid = {
  enabled: true,
  pitch: 32,
  origin: 32,
  diameter: 5,
  depth: 12,
  frontSetback: 37,
  backSetback: 37,
}

export interface Cabinet {
  id: string
  name: string
  /** Overall outside dimensions, including any plinth in `height`. */
  width: number
  height: number
  depth: number
  materialId: string
  carcass: CarcassStyle
  back: BackSpec
  /** Faces left to a neighbouring module. Absent means a fully closed carcass. */
  omit?: OmitPanels
  /**
   * Per-panel material overrides. Anything absent uses `materialId`.
   *
   * A carcass is not always one material: a cabinet in MDF can carry a solid timber
   * top, or a thicker bottom. Each panel takes its own material's thickness, and the
   * interior is measured from whatever each face actually contributes — so a 24mm top
   * on an 18mm carcass shortens the sides by 24mm, not 18mm.
   */
  panelMaterials?: {
    top?: string
    bottom?: string
    sides?: string
  }
  /**
   * Shelf-pin hole grid. Absent means no grid — shelves sit wherever the spacing
   * puts them, which is how designs made before this existed keep their positions.
   */
  holeGrid?: HoleGrid
  plinth?: { height: number; setback: number }
  banding: BandingSpec
  root: FurnitureNode
  transform: Transform
}

export interface Worktop {
  id: string
  name: string
  shape: 'rect' | 'L'
  materialId: string
  /** Leg A runs along +X. `depth` is measured along Z from the origin corner. */
  a: { length: number; depth: number }
  /** Leg B runs along +Z. `depth` is measured along X. Ignored for `rect`. */
  b: { length: number; depth: number }
  /** Which leg is cut as the full-corner piece; the other gets the remainder. */
  seam: 'a' | 'b'
  banding: BandingSpec
  transform: Transform
}

export interface HardwarePrices {
  shelfPin: number
  jointFixing: number
  drawerSlidePair: number
  hinge: number
  handle: number
  edgeBandingPerMetre: number
}

export interface DesignSettings {
  /** Saw blade width, removed by every cut. */
  kerf: number
  /** Unusable margin trimmed off each sheet edge. */
  sheetTrim: number
  hardware: HardwarePrices
}

export interface Design {
  schemaVersion: number
  name: string
  materials: Material[]
  cabinets: Cabinet[]
  worktops: Worktop[]
  settings: DesignSettings
}

export const SCHEMA_VERSION = 1
