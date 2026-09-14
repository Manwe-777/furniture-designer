import { describe, expect, it } from 'vitest'
import { buildDesign, materialsById } from './build/buildDesign'
import { buildBom } from './bom'
import { buildCost, buildHardware } from './hardware'
import { lDeskDesign, newDesign } from './defaults'
import { applyTransform } from './geom'
import { parseDesign, ProjectParseError, serializeDesign } from './io/project'
import { bomToCsv } from './io/csv'
import { nest, toNestParts } from './nest/optimize'
import { resolveSizes, spanSlack } from './build/span'
import { fixed, flex } from './types'

describe('span resolution', () => {
  it('shares the remainder between flex children after fixed ones take their cut', () => {
    // 1000 span, 2 dividers of 18 = 964 available; 200 fixed leaves 764 over 2.
    expect(resolveSizes([fixed(200), flex(1), flex(1)], 1000, 18)).toEqual([200, 382, 382])
  })

  it('weights flex children', () => {
    expect(resolveSizes([flex(1), flex(3)], 800, 0)).toEqual([200, 600])
  })

  it('always sums to exactly the available span, even when it does not divide evenly', () => {
    const sizes = resolveSizes([flex(1), flex(1), flex(1)], 1000, 18)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(1000 - 2 * 18)
  })

  it('reports a negative slack when fixed children overflow', () => {
    expect(spanSlack([fixed(600), fixed(600)], 1000, 18)).toBeLessThan(0)
  })

  it('splits equally when every weight is zero rather than collapsing', () => {
    expect(resolveSizes([flex(0), flex(0)], 900, 0)).toEqual([450, 450])
  })
})

describe('transforms', () => {
  const b = { pos: [10, 0, 20] as [number, number, number], size: [100, 50, 30] as [number, number, number] }

  it('leaves a box alone at 0°', () => {
    expect(applyTransform(b, { x: 0, y: 0, z: 0, rotY: 0 })).toEqual(b)
  })

  it('swaps the X and Z extents at 90° and 270°', () => {
    const r90 = applyTransform(b, { x: 0, y: 0, z: 0, rotY: 90 })
    expect(r90.size).toEqual([30, 50, 100])
    const r270 = applyTransform(b, { x: 0, y: 0, z: 0, rotY: 270 })
    expect(r270.size).toEqual([30, 50, 100])
  })

  it('preserves size at 180° and mirrors the position', () => {
    const r = applyTransform(b, { x: 0, y: 0, z: 0, rotY: 180 })
    expect(r.size).toEqual(b.size)
    expect(r.pos).toEqual([-110, 0, -50])
  })

  it('four 90° rotations return to the start', () => {
    let box = b
    for (let i = 0; i < 4; i++) box = applyTransform(box, { x: 0, y: 0, z: 0, rotY: 90 })
    expect(box).toEqual(b)
  })

  it('applies translation after rotation', () => {
    const r = applyTransform(b, { x: 1000, y: 5, z: 2000, rotY: 0 })
    expect(r.pos).toEqual([1010, 5, 2020])
  })
})

describe('project round-trip', () => {
  it('survives serialize and parse unchanged', () => {
    const design = lDeskDesign()
    expect(parseDesign(serializeDesign(design))).toEqual(design)
  })

  it('fills in settings that a older file did not have', () => {
    const design = lDeskDesign()
    const raw = JSON.parse(serializeDesign(design))
    delete raw.settings
    delete raw.worktops
    const parsed = parseDesign(JSON.stringify(raw))
    expect(parsed.settings.kerf).toBeGreaterThan(0)
    expect(parsed.worktops).toEqual([])
  })

  it('rejects files that are not designs', () => {
    expect(() => parseDesign('not json')).toThrow(ProjectParseError)
    expect(() => parseDesign('{"hello":1}')).toThrow(ProjectParseError)
  })

  it('refuses a project from a newer schema rather than mangling it', () => {
    const raw = JSON.parse(serializeDesign(newDesign()))
    raw.schemaVersion = 999
    expect(() => parseDesign(JSON.stringify(raw))).toThrow(/newer version/)
  })
})

/**
 * The end-to-end check: the L-desk from the designer all the way to a cut plan.
 * If this passes, the whole pipeline agrees with itself.
 */
describe('L-desk end to end', () => {
  const design = lDeskDesign()
  const { parts, warnings } = buildDesign(design)
  const materials = materialsById(design)
  const bom = buildBom(parts, materials)

  it('builds without warnings', () => {
    expect(warnings).toEqual([])
  })

  it('produces the expected panels for the drawer pedestal', () => {
    const find = (label: string) => bom.rows.find((r) => r.label === label)

    // Carcass 450 × 702 × 580 in 18mm, rebated 6mm back, 1mm banding compensated.
    // Sides: full height × depth, less 1mm off the banded front edge.
    expect(find('Side (left)')).toMatchObject({ length: 702, width: 579 })
    // Top/bottom: 450 − 2 × 18 = 414 wide.
    expect(find('Top')).toMatchObject({ length: 579, width: 414 })
    // Back sits in a 9mm groove, so it is oversize by 9 on every side.
    expect(find('Back')).toMatchObject({ length: 684, width: 432 })
  })

  it('accounts for slide clearance in the drawer boxes', () => {
    const side = bom.rows.find((r) => r.label === 'Drawer side (left)')
    const back = bom.rows.find((r) => r.label === 'Drawer back')
    // Opening 414 − 2 × 12.7 = 388.6 outer; less two 12mm sides = 364.6.
    expect(back?.length).toBeCloseTo(364.6, 6)
    // Depth 580 − 6 back − 18 face − 10 clearance = 546.
    expect(side?.length).toBe(546)
  })

  it('cuts the L worktop as two rectangles', () => {
    const tops = bom.rows.filter((r) => r.role === 'worktop')
    expect(tops).toHaveLength(2)
    expect(tops.map((t) => [t.length, t.width])).toEqual(
      expect.arrayContaining([
        [1598, 598],
        [798, 598],
      ]),
    )
  })

  it('collapses identical parts into quantities', () => {
    const shelves = bom.rows.find((r) => r.label === 'Shelf')
    expect(shelves?.quantity).toBe(2)
    expect(bom.totalParts).toBe(parts.length)
  })

  it('costs the hardware the drawers and shelves actually need', () => {
    const hardware = buildHardware(design, parts)
    const item = (name: string) => hardware.find((h) => h.name.startsWith(name))
    // Two adjustable shelves × 4 pins.
    expect(item('Shelf pins')?.quantity).toBe(8)
    expect(item('Drawer slide pairs')?.quantity).toBe(3)
    expect(item('Handles')?.quantity).toBe(3)

    const cost = buildCost(design, bom, hardware)
    expect(cost.grandTotal).toBeGreaterThan(0)
    expect(cost.grandTotal).toBeCloseTo(
      cost.sheetsTotal + cost.hardwareTotal + cost.bandingTotal,
      6,
    )
  })

  it('nests every part onto sheets with nothing left over', () => {
    const result = nest(toNestParts(parts, materials), materials, {
      kerf: design.settings.kerf,
      trim: design.settings.sheetTrim,
      effort: 20,
      seed: 12345,
    })
    expect(result.unplaced).toEqual([])

    const placed = result.byMaterial.flatMap((m) => m.sheets.flatMap((s) => s.placements))
    expect(placed).toHaveLength(parts.length)

    // Every placement must correspond to a real part at its real cut size.
    const byId = new Map(parts.map((p) => [p.id, p]))
    for (const placement of placed) {
      const part = byId.get(placement.partId)
      expect(part, `${placement.partId} is not a part of the design`).toBeDefined()
      const expected = placement.rotated
        ? [part!.width, part!.length]
        : [part!.length, part!.width]
      expect([placement.w, placement.h]).toEqual(expected)
    }
  })

  it('exports a CSV with one line per distinct part', () => {
    const csv = bomToCsv(bom.rows)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(bom.rows.length + 1)
    expect(lines[0]).toMatch(/^Part,Material,/)
  })
})
