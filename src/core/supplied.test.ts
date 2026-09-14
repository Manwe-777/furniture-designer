import { describe, expect, it } from 'vitest'
import { buildBom } from './bom'
import { buildCost, buildHardware } from './hardware'
import { buildDesign, materialsById } from './build/buildDesign'
import { nest, toNestParts } from './nest/optimize'
import { DEFAULT_NEST_OPTIONS } from './nest/types'
import { newDesign, newWorktop } from './defaults'
import type { Design, Material } from './types'

const OAK: Material = {
  id: 'oak', name: 'Solid oak 25mm', thickness: 25,
  sheet: { length: 2440, width: 1220 }, pricePerSheet: 0,
  hasGrain: true, color: '#b07a3c', supplied: true,
}

/** A cabinet in MDF plus a worktop bought to size. */
function mixed(): Design {
  const base = newDesign()
  return {
    ...base,
    materials: [...base.materials, OAK],
    worktops: [newWorktop({ name: 'Oak top', materialId: 'oak', a: { length: 1600, depth: 600 } })],
  }
}

const nestOf = (d: Design) => {
  const mats = materialsById(d)
  return nest(toNestParts(buildDesign(d).parts, mats), mats, {
    ...DEFAULT_NEST_OPTIONS, effort: 10,
  })
}

describe('materials supplied to size', () => {
  it('are left out of the nesting', () => {
    const result = nestOf(mixed())
    expect(result.byMaterial.map((m) => m.materialId)).not.toContain('oak')
    // The MDF still gets nested.
    expect(result.totalSheets).toBeGreaterThan(0)
  })

  it('do not change the sheet count', () => {
    const without = nestOf(newDesign()).totalSheets
    expect(nestOf(mixed()).totalSheets).toBe(without)
  })

  it('stay in the bill of materials, with their size', () => {
    const d = mixed()
    const bom = buildBom(buildDesign(d).parts, materialsById(d))
    const oak = bom.rows.filter((r) => r.materialId === 'oak')
    expect(oak).toHaveLength(1)
    expect(oak[0].supplied).toBe(true)
    // The full finished size, not shrunk for edge banding — you order the plank at
    // 1600 x 600 and do not band it.
    expect([oak[0].length, oak[0].width]).toEqual([1600, 600])
  })

  it('claim no sheets of their own', () => {
    const d = mixed()
    const bom = buildBom(buildDesign(d).parts, materialsById(d))
    const oak = bom.byMaterial.find((m) => m.materialId === 'oak')!
    expect(oak.supplied).toBe(true)
    expect(oak.minSheets).toBe(0)
    expect(oak.areaM2).toBeGreaterThan(0)
  })

  it('are excluded from the sheet cost', () => {
    const d = mixed()
    const parts = buildDesign(d).parts
    const bom = buildBom(parts, materialsById(d))
    const cost = buildCost(d, bom, buildHardware(d, parts))
    expect(cost.sheets.map((s) => s.materialId)).not.toContain('oak')
  })

  it('behave normally again when the flag is off', () => {
    const d = mixed()
    d.materials = d.materials.map((m) => (m.id === 'oak' ? { ...m, supplied: false } : m))
    expect(nestOf(d).byMaterial.map((m) => m.materialId)).toContain('oak')
  })
})

describe('edge banding on supplied materials', () => {
  it('never shrinks the cut size, even with banding switched on', () => {
    const d = mixed()
    const worktop = d.worktops[0]
    expect(worktop.banding.enabled && worktop.banding.compensate).toBe(true)
    const bom = buildBom(buildDesign(d).parts, materialsById(d))
    const oak = bom.rows.find((r) => r.materialId === 'oak')!
    expect([oak.length, oak.width]).toEqual([1600, 600])
  })

  it('still compensates sheet materials', () => {
    const d = mixed()
    d.materials = d.materials.map((m) => (m.id === 'oak' ? { ...m, supplied: false } : m))
    const bom = buildBom(buildDesign(d).parts, materialsById(d))
    const oak = bom.rows.find((r) => r.materialId === 'oak')!
    expect([oak.length, oak.width]).toEqual([1598, 598])
  })
})
