/** One rectangle to be cut out of a sheet. */
export interface NestPart {
  /** Unique per instance — two identical shelves are two NestParts. */
  id: string
  label: string
  /** Grain direction dimension. */
  length: number
  width: number
  materialId: string
  thickness: number
  /** False when the material has grain and the part must keep its orientation. */
  canRotate: boolean
}

export interface Placement {
  partId: string
  label: string
  /** Position of the part's lower-left corner, in sheet coordinates (mm). */
  x: number
  y: number
  /** Placed dimensions: `w` runs along the sheet length, `h` along its width. */
  w: number
  h: number
  rotated: boolean
}

export interface FreeRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CutLine {
  /** 'v' removes material at a constant x, 'h' at a constant y. */
  dir: 'v' | 'h'
  /** Distance from the sheet origin to the near edge of the blade. */
  pos: number
  /** The extent of the cut along the other axis. */
  from: number
  to: number
  /** Recursion depth — all depth-0 cuts are made first. */
  depth: number
}

export interface Sheet {
  index: number
  materialId: string
  materialName: string
  thickness: number
  /** Full sheet size as bought. */
  sheetLength: number
  sheetWidth: number
  /** Usable area after trimming, and its offset from the sheet corner. */
  trim: number
  placements: Placement[]
  freeRects: FreeRect[]
  cuts: CutLine[]
  usedAreaMm2: number
  wastePct: number
}

export interface MaterialNestResult {
  materialId: string
  materialName: string
  sheets: Sheet[]
  unplaced: NestPart[]
  wastePct: number
  /** The biggest single rectangle left over — the piece worth keeping. */
  largestOffcut: FreeRect | null
  /**
   * How close this plan is to the best one that could possibly exist.
   *
   * You buy whole sheets, so "waste %" on its own is not actionable — what matters
   * is whether the sheet COUNT could be lower. `utilisationToSaveOneSheet` is the
   * packing efficiency you would have to hit to drop one sheet; above about 95% no
   * real layout achieves that, so the plan is at its floor and the only way down is
   * to change the parts.
   */
  yield: {
    partAreaMm2: number
    usableAreaPerSheet: number
    /** Absolute floor from area alone — ignores whether the shapes actually fit. */
    areaFloorSheets: number
    /**
     * The largest bound we can actually prove: the area floor, or a set of parts
     * that pairwise cannot share a sheet, whichever is higher. When the plan equals
     * this, it is provably optimal and no algorithm can do better.
     */
    provenFloorSheets: number
    /** Share of the usable area on the sheets bought, as a percentage. */
    utilisationPct: number
    /** Efficiency needed to use one sheet fewer, or null when already on one sheet. */
    utilisationToSaveOneSheet: number | null
  }
}

export interface NestResult {
  byMaterial: MaterialNestResult[]
  totalSheets: number
  totalWastePct: number
  unplaced: NestPart[]
  /** Which strategy won, for reproducibility. */
  strategy: string
}

export interface NestOptions {
  kerf: number
  trim: number
  /** Number of randomised restarts on top of the deterministic strategies. */
  effort: number
  seed: number
}

export const DEFAULT_NEST_OPTIONS: NestOptions = {
  kerf: 3,
  trim: 10,
  effort: 40,
  seed: 12345,
}
