import { describe, expect, it } from 'vitest'
import { buildCabinet } from './build/buildCabinet'
import { materialLookup } from './build/buildDesign'
import { cellWith, newCabinet, newDesign, shelvesContent } from './defaults'
import type { Cabinet, Design, Material, Part } from './types'

const OAK: Material = {
  id: 'oak', name: 'Solid oak 24mm', thickness: 24,
  sheet: { length: 2440, width: 1220 }, pricePerSheet: 0,
  hasGrain: true, color: '#b07a3c', supplied: true,
}

const design: Design = { ...newDesign(), materials: [...newDesign().materials, OAK] }
const mat = materialLookup(design)

const base = (overrides: Partial<Cabinet> = {}) =>
  newCabinet({
    width: 800, height: 720, depth: 400,
    materialId: 'mdf18',
    back: { style: 'none', thickness: 0, rebateDepth: 0 },
    banding: { enabled: false, thickness: 0, compensate: false },
    holeGrid: undefined,
    root: cellWith(shelvesContent(1)),
    ...overrides,
  })

const one = (parts: Part[], role: string) => {
  const found = parts.filter((p) => p.role === role)
  expect(found.length).toBeGreaterThan(0)
  return found[0]
}

describe('per-panel materials', () => {
  it('leaves everything on the cabinet material by default', () => {
    const { parts } = buildCabinet(base(), mat)
    for (const p of parts) expect(p.materialId).toBe('mdf18')
  })

  it('gives just the top a different material', () => {
    const { parts } = buildCabinet(base({ panelMaterials: { top: 'oak' } }), mat)
    expect(one(parts, 'top').materialId).toBe('oak')
    expect(one(parts, 'top').thickness).toBe(24)
    // Everything else stays MDF — this is the bug that made the pedestal gables
    // turn into solid timber when only the desktop was meant to.
    expect(one(parts, 'bottom').materialId).toBe('mdf18')
    expect(one(parts, 'side').materialId).toBe('mdf18')
    expect(one(parts, 'shelf').materialId).toBe('mdf18')
  })

  it('measures the carcass from each face’s own thickness', () => {
    const plain = buildCabinet(base(), mat).parts
    const oakTop = buildCabinet(base({ panelMaterials: { top: 'oak' } }), mat).parts
    // sides-full: the sides run the full height either way...
    expect(one(plain, 'side').length).toBe(720)
    expect(one(oakTop, 'side').length).toBe(720)
    // ...but the interior loses 24mm to the top instead of 18, so the shelf drops.
    const interiorPlain = 720 - 18 - 18
    const interiorOak = 720 - 24 - 18
    expect(one(plain, 'shelf').box.pos[1]).toBeCloseTo(18 + interiorPlain / 2 - 9, 6)
    expect(one(oakTop, 'shelf').box.pos[1]).toBeCloseTo(18 + interiorOak / 2 - 9, 6)
  })

  it('shortens the sides by the real thickness in a topbottom-full carcass', () => {
    const cab = base({ carcass: 'topbottom-full', panelMaterials: { top: 'oak' } })
    // 720 − 24 top − 18 bottom.
    expect(one(buildCabinet(cab, mat).parts, 'side').length).toBe(678)
  })

  it('narrows the top when the sides are a different thickness', () => {
    const cab = base({ panelMaterials: { sides: 'oak' } })
    const { parts } = buildCabinet(cab, mat)
    expect(one(parts, 'side').thickness).toBe(24)
    // 800 − 2 × 24.
    expect(one(parts, 'top').length).toBe(752)
  })

  it('still respects omitted faces', () => {
    const cab = base({
      panelMaterials: { top: 'oak' },
      omit: { left: true, right: false, top: true, bottom: false },
    })
    const { parts } = buildCabinet(cab, mat)
    // Omitted means no panel at all, whatever material it would have been.
    expect(parts.filter((p) => p.role === 'top')).toHaveLength(0)
    expect(parts.filter((p) => p.role === 'side')).toHaveLength(1)
    // The interior runs out to the boundary on both omitted faces.
    expect(one(parts, 'shelf').box.pos[0]).toBe(0)
    expect(one(parts, 'shelf').length).toBe(800 - 18)
  })
})
