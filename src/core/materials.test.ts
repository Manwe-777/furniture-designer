import { describe, expect, it } from 'vitest'
import { countMaterialUsage, newMaterial } from './materials'
import {
  MAT_MDF6,
  MAT_MDF12,
  MAT_MDF15,
  MAT_MDF18,
  cellWith,
  defaultMaterials,
  drawersContent,
  lDeskDesign,
  newCabinet,
  newDesign,
} from './defaults'
import { flex } from './types'

describe('default materials', () => {
  it('offers 15mm alongside the other thicknesses', () => {
    const thicknesses = defaultMaterials().map((m) => m.thickness)
    expect(thicknesses).toEqual([18, 15, 12, 6])
    expect(defaultMaterials().find((m) => m.id === MAT_MDF15)?.name).toBe('MDF 15mm')
  })
})

describe('material usage', () => {
  it('counts a cabinet carcass and its back separately', () => {
    const design = {
      ...newDesign(),
      cabinets: [
        newCabinet({
          materialId: MAT_MDF18,
          back: { style: 'rebate', thickness: 6, rebateDepth: 9, materialId: MAT_MDF6 },
          root: cellWith({ type: 'empty' }),
        }),
      ],
    }
    expect(countMaterialUsage(design, MAT_MDF18)).toBe(1)
    expect(countMaterialUsage(design, MAT_MDF6)).toBe(1)
    expect(countMaterialUsage(design, MAT_MDF15)).toBe(0)
  })

  it('finds materials used deep inside the split tree', () => {
    const design = {
      ...newDesign(),
      cabinets: [
        newCabinet({
          materialId: MAT_MDF18,
          back: { style: 'none', thickness: 0, rebateDepth: 0 },
          root: {
            id: 'split',
            kind: 'split',
            dir: 'v',
            dividerThickness: 15,
            materialId: MAT_MDF15,
            sizes: [flex(1), flex(1)],
            children: [
              cellWith({
                type: 'shelves',
                count: 2,
                setback: 0,
                fixed: false,
                materialId: MAT_MDF15,
              }),
              cellWith(drawersContent(2)),
            ],
          },
        }),
      ],
    }
    // Once for the dividers, once for the shelves inside the first column.
    expect(countMaterialUsage(design, MAT_MDF15)).toBe(2)
    // The drawer defaults reference 12mm boxes and 6mm bottoms.
    expect(countMaterialUsage(design, MAT_MDF12)).toBe(1)
    expect(countMaterialUsage(design, MAT_MDF6)).toBe(1)
  })

  it('counts worktops', () => {
    const design = lDeskDesign()
    expect(countMaterialUsage(design, MAT_MDF18)).toBeGreaterThan(0)
  })

  it('reports zero for a material nothing references', () => {
    const design = newDesign()
    expect(countMaterialUsage(design, 'nonexistent')).toBe(0)
  })
})

describe('newMaterial', () => {
  it('does not reuse an existing id or colour', () => {
    const existing = defaultMaterials()
    const added = newMaterial(existing)
    expect(existing.map((m) => m.id)).not.toContain(added.id)
    expect(existing.map((m) => m.color)).not.toContain(added.color)
  })

  it('keeps producing distinct ids as materials accumulate', () => {
    let materials = defaultMaterials()
    const ids = new Set(materials.map((m) => m.id))
    for (let i = 0; i < 5; i++) {
      const added = newMaterial(materials)
      expect(ids.has(added.id)).toBe(false)
      ids.add(added.id)
      materials = [...materials, added]
    }
  })
})
