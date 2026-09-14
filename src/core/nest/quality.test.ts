import { describe, expect, it } from 'vitest'
import { GuillotineSheet } from './guillotine'
import { conflictFloor, nest } from './optimize'
import type { NestPart } from './types'
import type { Material } from '../types'

const MDF: Material = {
  id: 'm', name: 'MDF', thickness: 18,
  sheet: { length: 2440, width: 1220 }, pricePerSheet: 45, hasGrain: false, color: '#c9a87c',
}
const materials = new Map([['m', MDF]])
const TRIM = 10
const KERF = 3

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomParts(seed: number, n: number): NestPart[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    label: `p${i}`,
    length: Math.round(200 + r() * 1600),
    width: Math.round(150 + r() * 700),
    materialId: 'm',
    thickness: 18,
    canRotate: true,
  }))
}

/** Plain greedy: area-sorted, first sheet with room, no merging, no descent. */
function greedySheetCount(parts: NestPart[]): number {
  const sheets: GuillotineSheet[] = []
  for (const p of [...parts].sort((a, b) => b.length * b.width - a.length * a.width)) {
    if (sheets.some((s) => s.tryPlace(p))) continue
    const s = new GuillotineSheet(
      MDF.sheet.length - 2 * TRIM, MDF.sheet.width - 2 * TRIM,
      TRIM, KERF, 'bssf', 'shorter-leftover', false,
    )
    if (s.tryPlace(p)) sheets.push(s)
  }
  return sheets.length
}

const INSTANCES = Array.from({ length: 20 }, (_, i) => randomParts(i * 7919 + 13, 12 + i))

/**
 * Packing quality is easy to regress silently — a change can still produce valid,
 * cuttable plans that simply use more sheets, and no correctness test would notice.
 * These lock in the yield.
 */
describe('packing quality', () => {
  it('is never worse than plain greedy on any instance', () => {
    for (const parts of INSTANCES) {
      const smart = nest(parts, materials, { kerf: KERF, trim: TRIM, effort: 20, seed: 12345 })
      expect(smart.totalSheets).toBeLessThanOrEqual(greedySheetCount(parts))
    }
  })

  it('uses meaningfully fewer sheets than greedy in total', () => {
    const greedy = INSTANCES.reduce((sum, p) => sum + greedySheetCount(p), 0)
    const smart = INSTANCES.reduce(
      (sum, p) => sum + nest(p, materials, { kerf: KERF, trim: TRIM, effort: 20, seed: 12345 }).totalSheets,
      0,
    )
    // Measured at ~10% better; allow drift but catch a real regression.
    expect(smart).toBeLessThanOrEqual(greedy * 0.95)
  })

  it('never reports fewer sheets than the proven floor', () => {
    for (const parts of INSTANCES) {
      const result = nest(parts, materials, { kerf: KERF, trim: TRIM, effort: 20, seed: 12345 })
      const floor = Math.max(
        conflictFloor(parts, MDF, TRIM, KERF),
        Math.ceil(
          parts.reduce((s, p) => s + p.length * p.width, 0) /
            ((MDF.sheet.length - 2 * TRIM) * (MDF.sheet.width - 2 * TRIM)),
        ),
      )
      expect(result.totalSheets).toBeGreaterThanOrEqual(floor)
      expect(result.byMaterial[0].yield.provenFloorSheets).toBeLessThanOrEqual(result.totalSheets)
    }
  })

  it('still places every part, and every plan is cuttable', () => {
    for (const parts of INSTANCES) {
      const result = nest(parts, materials, { kerf: KERF, trim: TRIM, effort: 20, seed: 12345 })
      const placed = result.byMaterial.flatMap((m) => m.sheets.flatMap((s) => s.placements))
      expect(placed).toHaveLength(parts.length)
      expect(result.unplaced).toHaveLength(0)
      // Merging offcuts can create layouts a saw cannot separate; every sheet must
      // still decompose into edge-to-edge cuts.
      for (const sheet of result.byMaterial.flatMap((m) => m.sheets)) {
        if (sheet.placements.length > 1) {
          expect(sheet.cuts.length).toBeGreaterThanOrEqual(sheet.placements.length - 1)
        }
      }
    }
  })
})
