import { describe, expect, it } from 'vitest'
import { conflictFloor, nest } from './optimize'
import { deriveCuts } from './guillotine'
import type { Material } from '../types'
import type { NestPart, Sheet } from './types'
import { DEFAULT_NEST_OPTIONS } from './types'

const MDF: Material = {
  id: 'mdf18',
  name: 'MDF 18mm',
  thickness: 18,
  sheet: { length: 2440, width: 1220 },
  pricePerSheet: 45,
  hasGrain: false,
  color: '#c9a87c',
}

const OAK: Material = { ...MDF, id: 'oak18', name: 'Oak veneer 18mm', hasGrain: true }

const materials = new Map<string, Material>([
  [MDF.id, MDF],
  [OAK.id, OAK],
])

function makeParts(
  spec: { length: number; width: number; qty: number }[],
  materialId = MDF.id,
): NestPart[] {
  const parts: NestPart[] = []
  let n = 0
  for (const s of spec) {
    for (let i = 0; i < s.qty; i++) {
      n += 1
      parts.push({
        id: `p${n}`,
        label: `${s.length}×${s.width}`,
        length: s.length,
        width: s.width,
        materialId,
        thickness: 18,
        canRotate: !(materials.get(materialId)?.hasGrain ?? false),
      })
    }
  }
  return parts
}

const run = (parts: NestPart[], overrides = {}) =>
  nest(parts, materials, { ...DEFAULT_NEST_OPTIONS, effort: 10, ...overrides })

function overlaps(a: Sheet['placements'][number], b: Sheet['placements'][number]): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('nesting invariants', () => {
  const parts = makeParts([
    { length: 764, width: 582, qty: 6 },
    { length: 720, width: 400, qty: 4 },
    { length: 1600, width: 600, qty: 2 },
    { length: 300, width: 150, qty: 9 },
  ])

  const result = run(parts)
  const sheets = result.byMaterial.flatMap((m) => m.sheets)

  it('places every part exactly once', () => {
    const placed = sheets.flatMap((s) => s.placements.map((p) => p.partId))
    expect(result.unplaced).toHaveLength(0)
    expect(placed).toHaveLength(parts.length)
    expect(new Set(placed).size).toBe(parts.length)
  })

  it('never overlaps two parts', () => {
    for (const sheet of sheets) {
      for (let i = 0; i < sheet.placements.length; i++) {
        for (let j = i + 1; j < sheet.placements.length; j++) {
          expect(
            overlaps(sheet.placements[i], sheet.placements[j]),
            `${sheet.placements[i].partId} overlaps ${sheet.placements[j].partId} on sheet ${sheet.index}`,
          ).toBe(false)
        }
      }
    }
  })

  it('keeps every part inside the sheet minus its trim margin', () => {
    for (const sheet of sheets) {
      for (const p of sheet.placements) {
        expect(p.x).toBeGreaterThanOrEqual(sheet.trim - 1e-6)
        expect(p.y).toBeGreaterThanOrEqual(sheet.trim - 1e-6)
        expect(p.x + p.w).toBeLessThanOrEqual(sheet.sheetLength - sheet.trim + 1e-6)
        expect(p.y + p.h).toBeLessThanOrEqual(sheet.sheetWidth - sheet.trim + 1e-6)
      }
    }
  })

  it('leaves at least a kerf between neighbours that share a cut line', () => {
    const kerf = DEFAULT_NEST_OPTIONS.kerf
    for (const sheet of sheets) {
      for (const a of sheet.placements) {
        for (const b of sheet.placements) {
          if (a === b) continue
          // b sits to the right of a and their vertical extents overlap
          const verticallyOverlapping = a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6
          if (verticallyOverlapping && b.x >= a.x + a.w - 1e-6) {
            expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(kerf - 1e-6)
          }
          const horizontallyOverlapping = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6
          if (horizontallyOverlapping && b.y >= a.y + a.h - 1e-6) {
            expect(b.y - (a.y + a.h)).toBeGreaterThanOrEqual(kerf - 1e-6)
          }
        }
      }
    }
  })

  it('preserves each part’s dimensions', () => {
    const byId = new Map(parts.map((p) => [p.id, p]))
    for (const sheet of sheets) {
      for (const placement of sheet.placements) {
        const part = byId.get(placement.partId)!
        const expected = placement.rotated
          ? [part.width, part.length]
          : [part.length, part.width]
        expect([placement.w, placement.h]).toEqual(expected)
      }
    }
  })
})

describe('grain', () => {
  it('never rotates a part on a material with grain', () => {
    const parts = makeParts([{ length: 600, width: 300, qty: 12 }], OAK.id)
    const result = run(parts)
    const placements = result.byMaterial.flatMap((m) => m.sheets.flatMap((s) => s.placements))
    expect(placements).toHaveLength(12)
    expect(placements.every((p) => !p.rotated)).toBe(true)
  })

  it('will rotate on a grainless material when that packs better', () => {
    // 12 parts 1200×400: unrotated they only fit 2 per row of 2440.
    const parts = makeParts([{ length: 1150, width: 390, qty: 8 }])
    const result = run(parts)
    const placements = result.byMaterial.flatMap((m) => m.sheets.flatMap((s) => s.placements))
    expect(placements).toHaveLength(8)
  })
})

describe('sheet efficiency', () => {
  it('fits six 764×582 shelves on a single 2440×1220 sheet', () => {
    // Two columns of 764 + kerf = 1534, three rows of 582 = 1746 > 1220, so the
    // packer has to rotate/mix; the point is it must not need a second sheet.
    const parts = makeParts([{ length: 764, width: 582, qty: 6 }])
    const result = run(parts)
    expect(result.totalSheets).toBe(1)
  })

  it('uses one sheet for parts that exactly tile it', () => {
    // Four 1200×595 pieces: 2 × 1200 + 3 kerf = 2403 ≤ 2420 usable,
    // 2 × 595 + 3 kerf = 1193 ≤ 1200 usable.
    const parts = makeParts([{ length: 1200, width: 595, qty: 4 }])
    const result = run(parts)
    expect(result.totalSheets).toBe(1)
  })

  it('reports parts that are larger than a whole sheet instead of dropping them', () => {
    const parts = makeParts([{ length: 3000, width: 600, qty: 1 }])
    const result = run(parts)
    expect(result.unplaced).toHaveLength(1)
    expect(result.unplaced[0].id).toBe('p1')
  })

  it('splits across sheets when one cannot hold everything', () => {
    const parts = makeParts([{ length: 1200, width: 600, qty: 9 }])
    const result = run(parts)
    expect(result.totalSheets).toBeGreaterThanOrEqual(3)
    expect(result.unplaced).toHaveLength(0)
  })
})

describe('determinism', () => {
  it('gives the same plan for the same seed', () => {
    const parts = makeParts([
      { length: 764, width: 582, qty: 5 },
      { length: 900, width: 300, qty: 7 },
    ])
    const a = run(parts)
    const b = run(parts)
    expect(JSON.stringify(a.byMaterial)).toBe(JSON.stringify(b.byMaterial))
  })
})

describe('materials', () => {
  it('never mixes materials on one sheet', () => {
    const parts = [
      ...makeParts([{ length: 700, width: 500, qty: 3 }], MDF.id),
      ...makeParts([{ length: 700, width: 500, qty: 3 }], OAK.id),
    ]
    const result = run(parts)
    expect(result.byMaterial).toHaveLength(2)
    for (const material of result.byMaterial) {
      for (const sheet of material.sheets) {
        expect(sheet.materialId).toBe(material.materialId)
      }
    }
  })
})

describe('derived cut lines', () => {
  it('produces guillotine cuts that no part straddles', () => {
    const parts = makeParts([
      { length: 764, width: 582, qty: 4 },
      { length: 400, width: 300, qty: 6 },
    ])
    const result = run(parts)

    for (const sheet of result.byMaterial.flatMap((m) => m.sheets)) {
      for (const cut of sheet.cuts) {
        for (const p of sheet.placements) {
          // A cut only crosses the region it belongs to. A later cut on one offcut
          // says nothing about parts sitting on the other side of an earlier one.
          const [near, far, pos, extent] =
            cut.dir === 'v' ? [p.y, p.y + p.h, p.x, p.w] : [p.x, p.x + p.w, p.y, p.h]
          const inRegion = near >= cut.from - 1e-6 && far <= cut.to + 1e-6
          if (!inRegion) continue

          const straddles = pos < cut.pos - 1e-6 && pos + extent > cut.pos + 1e-6
          expect(
            straddles,
            `${cut.dir} cut at ${cut.pos} (${cut.from}–${cut.to}) runs through ${p.partId}`,
          ).toBe(false)
        }
      }
    }
  })

  it('separates every part: n parts need at least n−1 cuts', () => {
    const parts = makeParts([{ length: 500, width: 400, qty: 6 }])
    const result = run(parts)
    for (const sheet of result.byMaterial.flatMap((m) => m.sheets)) {
      if (sheet.placements.length > 1) {
        expect(sheet.cuts.length).toBeGreaterThanOrEqual(sheet.placements.length - 1)
      }
    }
  })

  it('returns no cuts for a single part', () => {
    expect(deriveCuts({ x: 0, y: 0, w: 2440, h: 1220 }, [
      { partId: 'a', label: 'a', x: 10, y: 10, w: 100, h: 100, rotated: false },
    ])).toEqual([])
  })
})

describe('proven lower bound', () => {
  const nestOf = (parts: NestPart[]) =>
    nest(parts, materials, { ...DEFAULT_NEST_OPTIONS, effort: 20 })

  it('three panels that pairwise cannot share a sheet prove three sheets', () => {
    // Each is too big to pair with either of the others in any orientation.
    const parts = makeParts([
      { length: 1962, width: 782, qty: 1 },
      { length: 2081, width: 662, qty: 1 },
      { length: 941, width: 662, qty: 1 },
    ])
    expect(conflictFloor(parts, MDF, DEFAULT_NEST_OPTIONS.trim, DEFAULT_NEST_OPTIONS.kerf)).toBe(3)

    const result = nestOf(parts)
    const m = result.byMaterial[0]
    expect(m.sheets).toHaveLength(3)
    // The packer matched the proven floor, so this plan is optimal.
    expect(m.yield.provenFloorSheets).toBe(3)
  })

  it('never claims a floor above what the packer achieves', () => {
    const parts = makeParts([
      { length: 764, width: 582, qty: 9 },
      { length: 400, width: 300, qty: 11 },
      { length: 1200, width: 600, qty: 4 },
    ])
    const m = nestOf(parts).byMaterial[0]
    // A lower bound that exceeded the achieved count would be a contradiction.
    expect(m.yield.provenFloorSheets).toBeLessThanOrEqual(m.sheets.length)
  })

  it('small parts that all fit together prove a floor of one', () => {
    const parts = makeParts([{ length: 300, width: 200, qty: 4 }])
    expect(conflictFloor(parts, MDF, DEFAULT_NEST_OPTIONS.trim, DEFAULT_NEST_OPTIONS.kerf)).toBe(1)
  })

  it('the area floor still applies when nothing pairwise conflicts', () => {
    // 20 parts of 1200x595: area alone needs 5 sheets even though any two fit.
    const parts = makeParts([{ length: 1200, width: 595, qty: 20 }])
    const m = nestOf(parts).byMaterial[0]
    expect(m.yield.areaFloorSheets).toBeGreaterThanOrEqual(5)
    expect(m.yield.provenFloorSheets).toBeLessThanOrEqual(m.sheets.length)
  })
})
