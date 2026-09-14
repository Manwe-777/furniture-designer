import type { Material } from '../types'
import {
  finishSheet,
  GuillotineSheet,
  isGuillotineSeparable,
  type FitHeuristic,
  type SplitRule,
} from './guillotine'
import type {
  FreeRect,
  MaterialNestResult,
  NestOptions,
  NestPart,
  NestResult,
  Sheet,
} from './types'

/** Small deterministic PRNG so the same design always produces the same cut plan. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type SortOrder = 'area' | 'long-side' | 'length' | 'width' | 'perimeter'

const SORTERS: Record<SortOrder, (a: NestPart, b: NestPart) => number> = {
  area: (a, b) => b.length * b.width - a.length * a.width,
  'long-side': (a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width),
  length: (a, b) => b.length - a.length,
  width: (a, b) => b.width - a.width,
  perimeter: (a, b) => b.length + b.width - (a.length + a.width),
}

const HEURISTICS: FitHeuristic[] = ['bssf', 'baf', 'blsf']
const SPLIT_RULES: SplitRule[] = [
  'shorter-leftover',
  'longer-leftover',
  'shorter-axis',
  'longer-axis',
]

interface PackRun {
  sheets: Sheet[]
  unplaced: NestPart[]
  largestOffcut: FreeRect | null
  strategy: string
}

interface PackConfig {
  heuristic: FitHeuristic
  splitRule: SplitRule
  merge: boolean
  /** Refuse to open more than this many sheets; the attempt fails instead. */
  maxSheets: number
}

function packOnce(
  parts: NestPart[],
  material: Material,
  options: NestOptions,
  config: PackConfig,
  strategy: string,
): PackRun | null {
  const usableLength = material.sheet.length - 2 * options.trim
  const usableWidth = material.sheet.width - 2 * options.trim

  const sheets: GuillotineSheet[] = []
  const unplaced: NestPart[] = []

  const newSheet = () =>
    new GuillotineSheet(
      usableLength,
      usableWidth,
      options.trim,
      options.kerf,
      config.heuristic,
      config.splitRule,
      config.merge,
    )

  for (const part of parts) {
    // Try every open sheet and take the tightest fit, rather than the first sheet
    // that happens to have room — a part dropped into a big empty gap early on can
    // cost a whole sheet later.
    let bestSheet: GuillotineSheet | null = null
    let bestWaste = Infinity
    for (const sheet of sheets) {
      const probe = sheet.probe(part)
      if (probe !== null && probe < bestWaste) {
        bestWaste = probe
        bestSheet = sheet
      }
    }
    if (bestSheet) {
      bestSheet.tryPlace(part)
      continue
    }

    const sheet = newSheet()
    if (sheet.tryPlace(part)) {
      if (sheets.length >= config.maxSheets) return null
      sheets.push(sheet)
    } else {
      // Bigger than a whole sheet — no ordering will ever fix this.
      unplaced.push(part)
    }
  }

  // Merging offcuts can produce a layout no edge-to-edge cut can separate.
  if (config.merge) {
    for (const sheet of sheets) {
      const region = { x: options.trim, y: options.trim, w: usableLength, h: usableWidth }
      if (!isGuillotineSeparable(region, sheet.placements)) return null
    }
  }

  const finished = sheets.map((s, i) =>
    finishSheet(
      s,
      i,
      material.id,
      material.name,
      material.thickness,
      material.sheet.length,
      material.sheet.width,
    ),
  )

  let largestOffcut: FreeRect | null = null
  for (const sheet of finished) {
    for (const rect of sheet.freeRects) {
      if (!largestOffcut || rect.w * rect.h > largestOffcut.w * largestOffcut.h) {
        largestOffcut = rect
      }
    }
  }

  return { sheets: finished, unplaced, largestOffcut, strategy }
}

/** Fewer sheets wins; ties go to the plan that leaves the biggest usable offcut. */
function isBetter(candidate: PackRun | null, best: PackRun | null): boolean {
  if (!candidate) return false
  if (!best) return true
  if (candidate.unplaced.length !== best.unplaced.length) {
    return candidate.unplaced.length < best.unplaced.length
  }
  if (candidate.sheets.length !== best.sheets.length) {
    return candidate.sheets.length < best.sheets.length
  }
  const areaOf = (r: FreeRect | null) => (r ? r.w * r.h : 0)
  return areaOf(candidate.largestOffcut) > areaOf(best.largestOffcut)
}

/**
 * A hard lower bound on the sheet count, from parts that cannot share a sheet.
 *
 * For exactly TWO rectangles in a bin there is always a straight line separating
 * them, so "do these two fit together" is decidable exactly: side by side, or
 * stacked, in either orientation. Any set of parts that pairwise fail that test
 * must each occupy their own sheet — so the size of such a set is a proven minimum,
 * not an estimate. A greedy clique is used, which may understate the bound but can
 * never overstate it.
 */
export function conflictFloor(parts: NestPart[], material: Material, trim: number, kerf: number): number {
  const UL = material.sheet.length - 2 * trim
  const UW = material.sheet.width - 2 * trim

  const fitsAlone = (p: NestPart) =>
    (p.length <= UL && p.width <= UW) || (p.canRotate && p.width <= UL && p.length <= UW)

  const together = (a: NestPart, b: NestPart): boolean => {
    const orientations = (p: NestPart): [number, number][] =>
      p.canRotate && p.length !== p.width
        ? [[p.length, p.width], [p.width, p.length]]
        : [[p.length, p.width]]
    for (const [aw, ah] of orientations(a)) {
      for (const [bw, bh] of orientations(b)) {
        if (aw + kerf + bw <= UL && Math.max(ah, bh) <= UW) return true
        if (Math.max(aw, bw) <= UL && ah + kerf + bh <= UW) return true
      }
    }
    return false
  }

  const clique: NestPart[] = []
  for (const part of [...parts].filter(fitsAlone).sort((a, b) => b.length * b.width - a.length * a.width)) {
    if (clique.every((other) => !together(part, other))) clique.push(part)
  }
  return clique.length
}

/**
 * Pack one material, then try to beat it.
 *
 * A greedy pass gives a starting answer; after that the search stops caring about
 * tidiness and goes after the only number that costs money — the sheet count. It
 * repeatedly asks "can everything fit in one sheet fewer?", with the packer forbidden
 * from opening an extra sheet, and keeps descending until an attempt fails or the
 * proven floor is reached. Sheet count is what you pay for, so that is what the
 * compute is spent on.
 */
function nestMaterial(
  parts: NestPart[],
  material: Material,
  options: NestOptions,
): MaterialNestResult {
  const rng = mulberry32(options.seed)
  const MERGE = [false, true]

  /** One attempt at every deterministic strategy, capped at `maxSheets`. */
  const deterministicPass = (maxSheets: number): PackRun | null => {
    let found: PackRun | null = null
    for (const order of Object.keys(SORTERS) as SortOrder[]) {
      const sorted = [...parts].sort(SORTERS[order])
      for (const heuristic of HEURISTICS) {
        for (const splitRule of SPLIT_RULES) {
          for (const merge of MERGE) {
            const run = packOnce(
              sorted,
              material,
              options,
              { heuristic, splitRule, merge, maxSheets },
              `${order}/${heuristic}/${splitRule}${merge ? '/merge' : ''}`,
            )
            if (isBetter(run, found)) found = run
          }
        }
      }
    }
    return found
  }

  /** Randomised attempts, all capped at `maxSheets`. */
  const randomPass = (maxSheets: number, attempts: number): PackRun | null => {
    let found: PackRun | null = null
    for (let i = 0; i < attempts; i++) {
      const shuffled = [...parts].sort(SORTERS.area)
      // Shuffle within size bands so the big parts still go down first, but their
      // relative order — which is what decides the awkward fits — keeps changing.
      const strength = 1 + Math.floor(rng() * 5)
      for (let j = shuffled.length - 1; j > 0; j--) {
        if (rng() < 0.5) {
          const k = Math.max(0, j - 1 - Math.floor(rng() * strength))
          ;[shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]
        }
      }
      const run = packOnce(
        shuffled,
        material,
        options,
        {
          heuristic: HEURISTICS[Math.floor(rng() * HEURISTICS.length)],
          splitRule: SPLIT_RULES[Math.floor(rng() * SPLIT_RULES.length)],
          merge: rng() < 0.5,
          maxSheets,
        },
        `random#${i}`,
      )
      if (isBetter(run, found)) found = run
      if (found) break // any success at this cap is enough; the descent continues
    }
    return found
  }

  let best = deterministicPass(Infinity) ?? randomPass(Infinity, 1)
  const floor = Math.max(
    1,
    conflictFloor(parts, material, options.trim, options.kerf),
    Math.ceil(
      parts.reduce((sum, p) => sum + p.length * p.width, 0) /
        ((material.sheet.length - 2 * options.trim) * (material.sheet.width - 2 * options.trim)),
    ),
  )

  // Descend one sheet at a time for as long as attempts keep succeeding.
  const budget = 120 + options.effort * 10
  while (best && best.sheets.length > floor) {
    const target = best.sheets.length - 1
    const attempt = deterministicPass(target) ?? randomPass(target, budget)
    if (!attempt) break
    best = attempt
  }

  const result = best ?? {
    sheets: [],
    unplaced: [],
    largestOffcut: null,
    strategy: 'none',
  }

  const sheetArea = material.sheet.length * material.sheet.width
  const totalArea = result.sheets.length * sheetArea
  const usedArea = result.sheets.reduce((sum, s) => sum + s.usedAreaMm2, 0)

  const usableAreaPerSheet =
    (material.sheet.length - 2 * options.trim) * (material.sheet.width - 2 * options.trim)
  const partAreaMm2 = parts.reduce((sum, p) => sum + p.length * p.width, 0)
  const count = result.sheets.length

  return {
    materialId: material.id,
    materialName: material.name,
    sheets: result.sheets,
    unplaced: result.unplaced,
    wastePct: totalArea > 0 ? ((totalArea - usedArea) / totalArea) * 100 : 0,
    largestOffcut: result.largestOffcut,
    yield: {
      partAreaMm2,
      usableAreaPerSheet,
      provenFloorSheets: Math.max(
        usableAreaPerSheet > 0 ? Math.ceil(partAreaMm2 / usableAreaPerSheet) : 0,
        conflictFloor(parts, material, options.trim, options.kerf),
      ),
      areaFloorSheets:
        usableAreaPerSheet > 0 ? Math.ceil(partAreaMm2 / usableAreaPerSheet) : 0,
      utilisationPct:
        count > 0 ? (partAreaMm2 / (count * usableAreaPerSheet)) * 100 : 0,
      utilisationToSaveOneSheet:
        count > 1 ? (partAreaMm2 / ((count - 1) * usableAreaPerSheet)) * 100 : null,
    },
  }
}

/**
 * Nest every part onto sheets, one material at a time.
 *
 * Several deterministic strategies are tried (sort order × fit heuristic × split rule)
 * plus a number of seeded random restarts, and the best result wins. The seed is
 * fixed, so re-opening a project gives you back the same layout you already started
 * cutting.
 */
export function nest(
  parts: NestPart[],
  materials: Map<string, Material>,
  options: NestOptions,
): NestResult {
  const groups = new Map<string, NestPart[]>()
  for (const part of parts) {
    const list = groups.get(part.materialId)
    if (list) list.push(part)
    else groups.set(part.materialId, [part])
  }

  const byMaterial: MaterialNestResult[] = []
  const strategies: string[] = []

  for (const [materialId, group] of groups) {
    const material = materials.get(materialId)
    // Supplied materials are bought to size, so there is nothing to nest.
    if (!material || material.supplied) continue
    const result = nestMaterial(group, material, options)
    byMaterial.push(result)
    strategies.push(`${material.name}: ${result.sheets.length} sheet(s)`)
  }

  byMaterial.sort((a, b) => b.sheets.length - a.sheets.length)

  const totalSheets = byMaterial.reduce((sum, m) => sum + m.sheets.length, 0)
  const totalArea = byMaterial.reduce((sum, m) => {
    const material = materials.get(m.materialId)
    if (!material) return sum
    return sum + m.sheets.length * material.sheet.length * material.sheet.width
  }, 0)
  const usedArea = byMaterial.reduce(
    (sum, m) => sum + m.sheets.reduce((s, sheet) => s + sheet.usedAreaMm2, 0),
    0,
  )

  return {
    byMaterial,
    totalSheets,
    totalWastePct: totalArea > 0 ? ((totalArea - usedArea) / totalArea) * 100 : 0,
    unplaced: byMaterial.flatMap((m) => m.unplaced),
    strategy: strategies.join(', '),
  }
}

/** Expand a parts list into individual nestable rectangles. */
export function toNestParts(
  parts: { id: string; label: string; length: number; width: number; materialId: string; thickness: number }[],
  materials: Map<string, Material>,
): NestPart[] {
  return parts.map((p) => ({
    id: p.id,
    label: p.label,
    length: p.length,
    width: p.width,
    materialId: p.materialId,
    thickness: p.thickness,
    canRotate: !(materials.get(p.materialId)?.hasGrain ?? false),
  }))
}
