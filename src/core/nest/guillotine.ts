import type { CutLine, FreeRect, NestPart, Placement, Sheet } from './types'

const EPS = 1e-6

export type FitHeuristic = 'bssf' | 'baf' | 'blsf'
export type SplitRule = 'shorter-leftover' | 'longer-leftover' | 'shorter-axis' | 'longer-axis'

interface Candidate {
  rectIndex: number
  rotated: boolean
  w: number
  h: number
  score: number
}

/**
 * Guillotine bin packing.
 *
 * Guillotine specifically — every cut runs edge to edge across the material — because
 * that is what a panel saw or a track saw physically does. A layout that needs a
 * partial cut cannot be produced on the machines this app is for.
 *
 * Kerf handling: a part FITS if it is no bigger than the free rectangle, but the
 * space it CONSUMES includes one blade width, because the saw destroys that material
 * on the way past. A part that exactly fills a free rectangle needs no kerf, since
 * there is nothing left to separate it from.
 */
export class GuillotineSheet {
  readonly placements: Placement[] = []
  freeRects: FreeRect[]

  constructor(
    readonly usableLength: number,
    readonly usableWidth: number,
    readonly trim: number,
    private readonly kerf: number,
    private readonly heuristic: FitHeuristic,
    private readonly splitRule: SplitRule,
    /** Recombine offcuts that touch, so a part can use two neighbouring gaps. */
    private readonly merge = false,
  ) {
    this.freeRects = [{ x: trim, y: trim, w: usableLength, h: usableWidth }]
  }

  /**
   * Fuse free rectangles that share a full edge with no gap between them.
   *
   * Without this, two offcuts sitting side by side stay separate forever and a part
   * that would span both never fits — the single biggest source of avoidable waste
   * in a plain guillotine packer. Only exactly-touching rectangles are merged: a
   * pair separated by a saw kerf is genuinely not continuous material.
   */
  private mergeFreeRects(): void {
    let merged = true
    while (merged) {
      merged = false
      outer: for (let i = 0; i < this.freeRects.length; i++) {
        for (let j = i + 1; j < this.freeRects.length; j++) {
          const a = this.freeRects[i]
          const b = this.freeRects[j]

          const sameColumn = Math.abs(a.x - b.x) < EPS && Math.abs(a.w - b.w) < EPS
          if (sameColumn) {
            if (Math.abs(a.y + a.h - b.y) < EPS) {
              a.h += b.h
              this.freeRects.splice(j, 1)
              merged = true
              break outer
            }
            if (Math.abs(b.y + b.h - a.y) < EPS) {
              a.y = b.y
              a.h += b.h
              this.freeRects.splice(j, 1)
              merged = true
              break outer
            }
          }

          const sameRow = Math.abs(a.y - b.y) < EPS && Math.abs(a.h - b.h) < EPS
          if (sameRow) {
            if (Math.abs(a.x + a.w - b.x) < EPS) {
              a.w += b.w
              this.freeRects.splice(j, 1)
              merged = true
              break outer
            }
            if (Math.abs(b.x + b.w - a.x) < EPS) {
              a.x = b.x
              a.w += b.w
              this.freeRects.splice(j, 1)
              merged = true
              break outer
            }
          }
        }
      }
    }
  }

  private score(free: FreeRect, w: number, h: number): number {
    const leftoverX = free.w - w
    const leftoverY = free.h - h
    switch (this.heuristic) {
      case 'bssf':
        return Math.min(leftoverX, leftoverY)
      case 'blsf':
        return Math.max(leftoverX, leftoverY)
      case 'baf':
        return free.w * free.h - w * h
    }
  }

  /** Best score this sheet could give the part, or null if it does not fit. */
  probe(part: NestPart): number | null {
    return this.bestCandidate(part)?.score ?? null
  }

  private bestCandidate(part: NestPart): Candidate | null {
    let best: Candidate | null = null

    for (let i = 0; i < this.freeRects.length; i++) {
      const free = this.freeRects[i]

      const orientations: [number, number, boolean][] = [[part.length, part.width, false]]
      if (part.canRotate && part.length !== part.width) {
        orientations.push([part.width, part.length, true])
      }

      for (const [w, h, rotated] of orientations) {
        if (w > free.w + EPS || h > free.h + EPS) continue
        const score = this.score(free, w, h)
        if (!best || score < best.score) best = { rectIndex: i, rotated, w, h, score }
      }
    }
    return best
  }

  tryPlace(part: NestPart): Placement | null {
    const best = this.bestCandidate(part)
    if (!best) return null

    const free = this.freeRects[best.rectIndex]
    const placement: Placement = {
      partId: part.id,
      label: part.label,
      x: free.x,
      y: free.y,
      w: best.w,
      h: best.h,
      rotated: best.rotated,
    }
    this.placements.push(placement)
    this.freeRects.splice(best.rectIndex, 1)
    this.freeRects.push(...this.split(free, best.w, best.h))
    if (this.merge) this.mergeFreeRects()
    return placement
  }

  /**
   * Split what is left of a free rectangle after taking a piece out of its corner.
   * A guillotine cut runs the full length of the rectangle, so there are exactly two
   * ways to divide the remainder and the split rule picks between them.
   */
  private split(free: FreeRect, w: number, h: number): FreeRect[] {
    const restW = free.w - w - this.kerf
    const restH = free.h - h - this.kerf

    let horizontal: boolean
    switch (this.splitRule) {
      case 'shorter-leftover':
        horizontal = restW < restH
        break
      case 'longer-leftover':
        horizontal = restW >= restH
        break
      case 'shorter-axis':
        horizontal = free.w < free.h
        break
      case 'longer-axis':
        horizontal = free.w >= free.h
        break
    }

    const out: FreeRect[] = []
    if (horizontal) {
      // Cut across the full width first: a short strip beside the piece, and the
      // full-width band above it.
      if (restW > EPS) out.push({ x: free.x + w + this.kerf, y: free.y, w: restW, h })
      if (restH > EPS) out.push({ x: free.x, y: free.y + h + this.kerf, w: free.w, h: restH })
    } else {
      if (restW > EPS) out.push({ x: free.x + w + this.kerf, y: free.y, w: restW, h: free.h })
      if (restH > EPS) out.push({ x: free.x, y: free.y + h + this.kerf, w, h: restH })
    }
    return out
  }
}

/**
 * Reconstruct the cut lines for a finished sheet.
 *
 * Rather than trusting the packer's internal bookkeeping, this re-derives the cuts
 * from the final layout: repeatedly find a straight line across the whole region that
 * no part straddles, and recurse on the two halves. Because the layout came from a
 * guillotine packer such a line always exists, so this doubles as a check that the
 * plan really is cuttable.
 */
export function deriveCuts(
  region: FreeRect,
  placements: Placement[],
  depth = 0,
): CutLine[] {
  if (placements.length <= 1) return []

  const straddlesV = (x: number) => placements.some((p) => p.x < x - EPS && p.x + p.w > x + EPS)
  const straddlesH = (y: number) => placements.some((p) => p.y < y - EPS && p.y + p.h > y + EPS)

  const xEdges = [...new Set(placements.map((p) => p.x + p.w))].sort((a, b) => a - b)
  for (const x of xEdges) {
    if (x <= region.x + EPS || x >= region.x + region.w - EPS) continue
    if (straddlesV(x)) continue
    const left = placements.filter((p) => p.x + p.w <= x + EPS)
    const right = placements.filter((p) => p.x > x - EPS)
    if (left.length === 0 || right.length === 0 || left.length + right.length !== placements.length) {
      continue
    }
    return [
      { dir: 'v', pos: x, from: region.y, to: region.y + region.h, depth },
      ...deriveCuts({ ...region, w: x - region.x }, left, depth + 1),
      ...deriveCuts({ ...region, x, w: region.x + region.w - x }, right, depth + 1),
    ]
  }

  const yEdges = [...new Set(placements.map((p) => p.y + p.h))].sort((a, b) => a - b)
  for (const y of yEdges) {
    if (y <= region.y + EPS || y >= region.y + region.h - EPS) continue
    if (straddlesH(y)) continue
    const below = placements.filter((p) => p.y + p.h <= y + EPS)
    const above = placements.filter((p) => p.y > y - EPS)
    if (below.length === 0 || above.length === 0 || below.length + above.length !== placements.length) {
      continue
    }
    return [
      { dir: 'h', pos: y, from: region.x, to: region.x + region.w, depth },
      ...deriveCuts({ ...region, h: y - region.y }, below, depth + 1),
      ...deriveCuts({ ...region, y, h: region.y + region.h - y }, above, depth + 1),
    ]
  }

  return []
}

/**
 * Can this layout actually be cut on a panel saw?
 *
 * Merging offcuts lets the packer place a part across what were two separate
 * regions, which can produce a layout no edge-to-edge cut sequence can separate.
 * Rather than reason about when that happens, every candidate layout is checked:
 * recursively look for a full-width or full-height line no part straddles, and
 * confirm the parts come apart one by one.
 */
export function isGuillotineSeparable(region: FreeRect, placements: Placement[]): boolean {
  if (placements.length <= 1) return true

  const xEdges = [...new Set(placements.map((p) => p.x + p.w))].sort((a, b) => a - b)
  for (const x of xEdges) {
    if (x <= region.x + EPS || x >= region.x + region.w - EPS) continue
    if (placements.some((p) => p.x < x - EPS && p.x + p.w > x + EPS)) continue
    const left = placements.filter((p) => p.x + p.w <= x + EPS)
    const right = placements.filter((p) => p.x > x - EPS)
    if (left.length === 0 || right.length === 0) continue
    if (left.length + right.length !== placements.length) continue
    return (
      isGuillotineSeparable({ ...region, w: x - region.x }, left) &&
      isGuillotineSeparable({ ...region, x, w: region.x + region.w - x }, right)
    )
  }

  const yEdges = [...new Set(placements.map((p) => p.y + p.h))].sort((a, b) => a - b)
  for (const y of yEdges) {
    if (y <= region.y + EPS || y >= region.y + region.h - EPS) continue
    if (placements.some((p) => p.y < y - EPS && p.y + p.h > y + EPS)) continue
    const below = placements.filter((p) => p.y + p.h <= y + EPS)
    const above = placements.filter((p) => p.y > y - EPS)
    if (below.length === 0 || above.length === 0) continue
    if (below.length + above.length !== placements.length) continue
    return (
      isGuillotineSeparable({ ...region, h: y - region.y }, below) &&
      isGuillotineSeparable({ ...region, y, h: region.y + region.h - y }, above)
    )
  }

  return false
}

export function finishSheet(
  sheet: GuillotineSheet,
  index: number,
  materialId: string,
  materialName: string,
  thickness: number,
  sheetLength: number,
  sheetWidth: number,
): Sheet {
  const usedAreaMm2 = sheet.placements.reduce((sum, p) => sum + p.w * p.h, 0)
  const sheetArea = sheetLength * sheetWidth
  return {
    index,
    materialId,
    materialName,
    thickness,
    sheetLength,
    sheetWidth,
    trim: sheet.trim,
    placements: sheet.placements,
    freeRects: sheet.freeRects,
    cuts: deriveCuts(
      { x: sheet.trim, y: sheet.trim, w: sheet.usableLength, h: sheet.usableWidth },
      sheet.placements,
    ),
    usedAreaMm2,
    wastePct: sheetArea > 0 ? ((sheetArea - usedAreaMm2) / sheetArea) * 100 : 0,
  }
}
