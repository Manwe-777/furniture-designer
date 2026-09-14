import { describe, expect, it } from 'vitest'
import { buildDrilling, countHoles, drillingToCsv } from './holes'
import { buildDesign, designBounds } from './build/buildDesign'
import { cellWith, newCabinet, newDesign, shelvesContent } from './defaults'
import { DEFAULT_HOLE_GRID, type Cabinet, type Design } from './types'

const withCabinet = (cab: Cabinet): Design => ({ ...newDesign(), cabinets: [cab] })

const base = (overrides: Partial<Cabinet> = {}) =>
  newCabinet({
    name: 'Unit',
    width: 800,
    height: 1000,
    depth: 300,
    back: { style: 'none', thickness: 0, rebateDepth: 0 },
    banding: { enabled: false, thickness: 0, compensate: false },
    root: cellWith(shelvesContent(3)),
    holeGrid: { ...DEFAULT_HOLE_GRID },
    ...overrides,
  })

describe('snapping shelves to the grid', () => {
  it('puts every shelf on a hole', () => {
    const design = withCabinet(base())
    const { parts } = buildDesign(design)
    const shelves = parts.filter((p) => p.role === 'shelf')
    expect(shelves).toHaveLength(3)

    // Interior floor is the datum: carcass bottom (0) + 18mm bottom panel.
    const datum = 18
    for (const shelf of shelves) {
      const above = shelf.box.pos[1] - datum - DEFAULT_HOLE_GRID.origin
      expect(above % DEFAULT_HOLE_GRID.pitch).toBeCloseTo(0, 6)
    }
  })

  it('never puts two shelves on the same hole', () => {
    const design = withCabinet(base({ height: 500, root: cellWith(shelvesContent(4)) }))
    const heights = buildDesign(design)
      .parts.filter((p) => p.role === 'shelf')
      .map((p) => p.box.pos[1])
    expect(new Set(heights).size).toBe(heights.length)
  })

  it('keeps every shelf inside its opening', () => {
    const design = withCabinet(base())
    const { parts } = buildDesign(design)
    for (const shelf of parts.filter((p) => p.role === 'shelf')) {
      expect(shelf.box.pos[1]).toBeGreaterThanOrEqual(18)
      expect(shelf.box.pos[1] + shelf.box.size[1]).toBeLessThanOrEqual(1000 - 18)
    }
  })

  it('leaves fixed shelves exactly where they were put', () => {
    const shelf = (fixed: boolean) =>
      cellWith({ type: 'shelves' as const, count: 1, setback: 0, fixed, positions: [301] })
    const loose = withCabinet(base({ root: shelf(false) }))
    const fixed = withCabinet(base({ root: shelf(true) }))
    const at = (d: Design) =>
      buildDesign(d).parts.find((p) => p.role === 'shelf')!.box.pos[1]
    // Adjustable snaps to the grid; housed stays put.
    expect(at(loose)).not.toBe(319)
    expect(at(fixed)).toBe(319)
  })

  it('does not change the cabinet envelope — the wall limits still hold', () => {
    const off = withCabinet(base({ holeGrid: undefined }))
    const on = withCabinet(base())
    expect(designBounds(buildDesign(on).parts)).toEqual(designBounds(buildDesign(off).parts))
  })

  it('does nothing when the grid is switched off', () => {
    const design = withCabinet(base({ holeGrid: { ...DEFAULT_HOLE_GRID, enabled: false } }))
    const heights = buildDesign(design)
      .parts.filter((p) => p.role === 'shelf')
      .map((p) => p.box.pos[1])
    // Equal spacing puts these at fractional positions no grid would produce.
    expect(heights.some((h) => (h - 18 - 32) % 32 !== 0)).toBe(true)
  })
})

describe('drilling schedule', () => {
  it('drills both sides of the cabinet', () => {
    const panels = buildDrilling(withCabinet(base()))
    expect(panels.map((p) => p.label).sort()).toEqual(['Side (left)', 'Side (right)'])
  })

  it('measures holes from the panel bottom and front edges', () => {
    const [panel] = buildDrilling(withCabinet(base()))
    // Two rows: 37 from the front, and 37 from the back of a 300 deep panel.
    expect(panel.rows).toEqual([37, 263])
    for (const hole of panel.holes) {
      expect(hole.u).toBeGreaterThanOrEqual(0)
      expect(hole.u).toBeLessThanOrEqual(panel.length)
      expect(hole.v).toBeGreaterThanOrEqual(0)
      expect(hole.v).toBeLessThanOrEqual(panel.width)
    }
  })

  it('drills a full row, marking the ones a shelf uses', () => {
    const [panel] = buildDrilling(withCabinet(base()))
    // Far more holes than shelves, so the shelves stay adjustable.
    expect(panel.gridHeights.length).toBeGreaterThan(panel.shelfHeights.length)
    expect(panel.shelfHeights).toHaveLength(3)
    for (const h of panel.shelfHeights) {
      expect(panel.gridHeights.some((g) => Math.abs(g - h) < 0.51)).toBe(true)
    }
    const used = panel.holes.filter((h) => h.used)
    expect(used).toHaveLength(panel.shelfHeights.length * panel.rows.length)
  })

  it('spaces the grid holes exactly one pitch apart', () => {
    const [panel] = buildDrilling(withCabinet(base()))
    for (let i = 1; i < panel.gridHeights.length; i++) {
      expect(panel.gridHeights[i] - panel.gridHeights[i - 1]).toBeCloseTo(32, 6)
    }
  })

  it('drills one row when the back setback is zero', () => {
    const design = withCabinet(base({ holeGrid: { ...DEFAULT_HOLE_GRID, backSetback: 0 } }))
    expect(buildDrilling(design)[0].rows).toEqual([37])
  })

  it('includes the dividers of a split, not just the cabinet sides', () => {
    const design = withCabinet(
      base({
        root: {
          id: 'split',
          kind: 'split',
          dir: 'v',
          dividerThickness: 18,
          sizes: [{ mode: 'flex', weight: 1 }, { mode: 'flex', weight: 1 }],
          children: [cellWith(shelvesContent(2)), cellWith(shelvesContent(2))],
        },
      }),
    )
    const panels = buildDrilling(design)
    expect(panels.some((p) => p.label.includes('divider'))).toBe(true)
    // Sides plus the shared divider.
    expect(panels).toHaveLength(3)
  })

  it('produces nothing without a grid, and nothing for fixed shelves', () => {
    expect(buildDrilling(withCabinet(base({ holeGrid: undefined })))).toEqual([])
    const allFixed = withCabinet(
      base({ root: cellWith({ type: 'shelves', count: 3, setback: 0, fixed: true }) }),
    )
    expect(buildDrilling(allFixed)).toEqual([])
  })

  it('exports a CSV line per hole', () => {
    const panels = buildDrilling(withCabinet(base()))
    const lines = drillingToCsv(panels).trim().split('\n')
    expect(lines).toHaveLength(countHoles(panels).total + 1)
    expect(lines[0]).toContain('From bottom edge')
  })
})
