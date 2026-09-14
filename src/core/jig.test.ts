import { describe, expect, it } from 'vitest'
import {
  edgeJigFreecadMacro,
  edgeJigScad,
  edgeJigSpec,
  jigFreecadMacro,
  jigScad,
  jigSpecs,
} from './jig'
import { buildDrilling } from './holes'
import { cellWith, newCabinet, newDesign, shelvesContent } from './defaults'
import { DEFAULT_HOLE_GRID, type Cabinet, type Design } from './types'

const design = (cabs: Cabinet[]): Design => ({ ...newDesign(), cabinets: cabs })

const unit = (name: string, depth: number) =>
  newCabinet({
    name,
    width: 800,
    height: 1000,
    depth,
    back: { style: 'none', thickness: 0, rebateDepth: 0 },
    banding: { enabled: false, thickness: 0, compensate: false },
    root: cellWith(shelvesContent(2)),
    holeGrid: { ...DEFAULT_HOLE_GRID },
  })

describe('jig specs', () => {
  it('makes one jig per panel depth, not one per panel', () => {
    const panels = buildDrilling(design([unit('A', 300), unit('B', 300), unit('C', 400)]))
    // Six panels (two sides each) but only two distinct depths.
    expect(panels).toHaveLength(6)
    const specs = jigSpecs(panels)
    expect(specs).toHaveLength(2)
    expect(specs.map((s) => s.panelWidth)).toEqual([300, 400])
    expect(specs[0].panels).toHaveLength(4)
  })

  it('treats depths within a millimetre as the same jig', () => {
    // Edge banding compensation leaves panels at 299 and 299.9 — one jig, not two.
    const banded = newCabinet({
      ...unit('Banded', 300),
      banding: { enabled: true, thickness: 1, compensate: true },
    })
    const specs = jigSpecs(buildDrilling(design([unit('Plain', 300), banded])))
    expect(specs).toHaveLength(1)
  })

  it('carries the grid settings through to the jig', () => {
    const [spec] = jigSpecs(buildDrilling(design([unit('A', 300)])))
    expect(spec.pitch).toBe(32)
    expect(spec.holeDiameter).toBe(5)
    expect(spec.frontSetback).toBe(37)
    // 32mm above the interior floor, which is itself 18mm up from the panel's
    // bottom edge — and the end stop registers on that edge.
    expect(spec.firstHole).toBe(50)
  })

  it('caps how many positions a printed jig carries', () => {
    // A 2m panel has ~60 grid positions; nobody prints a 2m jig.
    const tall = newCabinet({ ...unit('Tall', 300), height: 2000 })
    const [spec] = jigSpecs(buildDrilling(design([tall])))
    expect(spec.start.positions).toBeLessThan(20)
    expect(spec.start.positions).toBeGreaterThan(1)
  })
})

describe('jig source', () => {
  const scad = () => jigScad(jigSpecs(buildDrilling(design([unit('A', 300)])))[0], 'Test')

  it('puts the real numbers into the parameters', () => {
    const s = scad()
    expect(s).toMatch(/pitch\s+=\s+32;/)
    expect(s).toMatch(/hole_d\s+=\s+5;/)

    expect(s).toMatch(/setback\s+=\s+37;/)
    expect(s).toMatch(/first_hole\s+=\s+50;/)
  })

  it('builds a fence and an end stop, and subtracts the holes', () => {
    const s = scad()
    expect(s).toContain('module jig()')
    expect(s).toContain('difference()')
    expect(s).toContain('// fence — hooks a long edge')
    expect(s).toContain('// end stop — only on the START jig')
    expect(s).toContain('jig();')
  })

  it('warns about the two things that ruin a panel', () => {
    const s = scad()
    // The jig's own thickness adds to the bit travel, and 15mm panels are thin.
    expect(s).toContain('DRILL DEPTH')
    expect(s).toContain('plate_t + (the hole depth you want)')
    expect(s).toMatch(/15mm panels/)
  })

  it('fits the printer bed', () => {
    const [spec] = jigSpecs(buildDrilling(design([newCabinet({ ...unit('Tall', 300), height: 2000 })])))
    for (const v of [spec.start, spec.continue]) {
      expect(v.size.length).toBeLessThanOrEqual(spec.bed.length)
      expect(v.size.width).toBeLessThanOrEqual(spec.bed.width)
      // A single row keeps it narrow; both rows would need the full panel depth.
      expect(v.size.width).toBeLessThan(100)
    }
  })

  it('adapts the hole count to a smaller bed', () => {
    const panels = buildDrilling(design([newCabinet({ ...unit('Tall', 300), height: 2000 })]))
    const big = jigSpecs(panels, { length: 250, width: 210 })[0]
    const small = jigSpecs(panels, { length: 120, width: 120 })[0]
    expect(small.start.positions).toBeLessThan(big.start.positions)
    expect(small.start.size.length).toBeLessThanOrEqual(120)
  })

  it('says how far one setup reaches and how to continue', () => {
    const s = scad()
    expect(s).toMatch(/reaches \d+mm of panel per setup/)
    expect(s).toContain('REVERSIBLE')
  })

  it('names the panels it is cut for', () => {
    expect(scad()).toContain('A — Side (left)')
  })
})

describe('FreeCAD macro', () => {
  const macro = () =>
    jigFreecadMacro(jigSpecs(buildDrilling(design([unit('A', 300)])))[0], 'Test')

  it('carries the same numbers as the OpenSCAD version', () => {
    const scad = jigScad(jigSpecs(buildDrilling(design([unit('A', 300)])))[0], 'Test')
    const py = macro()
    for (const [scadName, pyName] of [
      ['pitch', 'pitch'],
      ['hole_d', 'hole_d'],
      ['setback', 'setback'],
      ['first_hole', 'first_hole'],
    ]) {
      const fromScad = scad.match(new RegExp(`${scadName}\\s+=\\s+([\\d.]+);`))?.[1]
      const fromPy = py.match(new RegExp(`${pyName}\\s+=\\s+([\\d.]+)`))?.[1]
      expect(fromPy, pyName).toBe(fromScad)
    }
  })

  it('builds the solid and can export an STL', () => {
    const s = macro()
    expect(s).toContain('import FreeCAD as App')
    expect(s).toContain('Part.makeBox')
    expect(s).toContain('Part.makeCylinder')
    expect(s).toContain('body.cut(')
    expect(s).toContain('EXPORT_STL')
    expect(s).toContain('Mesh.export')
  })

  it('keeps the drill depth warning', () => {
    expect(macro()).toContain('DRILL DEPTH')
  })
})

describe('the two pieces', () => {
  const spec = () => jigSpecs(buildDrilling(design([newCabinet({ ...unit('Tall', 300), height: 2000 })])))[0]

  it('only the start jig has an end stop', () => {
    const s = spec()
    expect(jigScad(s, 'T', 'start')).toMatch(/end_stop\s+=\s+true;/)
    expect(jigScad(s, 'T', 'continue')).toMatch(/end_stop\s+=\s+false;/)
    expect(jigFreecadMacro(s, 'T', 'start')).toMatch(/end_stop\s+=\s+True/)
    expect(jigFreecadMacro(s, 'T', 'continue')).toMatch(/end_stop\s+=\s+False/)
  })

  it('the continuation jig fits more holes, having no dead length', () => {
    const s = spec()
    expect(s.continue.positions).toBeGreaterThan(s.start.positions)
    expect(s.continue.reachMm).toBeGreaterThan(s.start.reachMm)
  })

  it('explains why both are needed', () => {
    for (const variant of ['start', 'continue'] as const) {
      const text = jigScad(spec(), 'T', variant)
      expect(text).toContain('YOU NEED BOTH PIECES')
      expect(text).toContain('lifts the jig clear of the work')
    }
  })

  it('both still fit the bed', () => {
    const s = spec()
    for (const v of [s.start, s.continue]) {
      expect(v.size.length).toBeLessThanOrEqual(s.bed.length)
    }
  })
})

describe('edge jig', () => {
  it('centres the hole on the panel, not on the slack slot', () => {
    const spec = edgeJigSpec(18, 8, 50)
    // The slot is wider than the panel so the jig slides on; the hole must still
    // measure half the PANEL from the reference wall, or the two mating holes miss.
    expect(edgeJigScad(spec, 'T')).toContain('panel_t / 2')
    expect(edgeJigScad(spec, 'T')).not.toContain('slot_w / 2,')
    expect(edgeJigFreecadMacro(spec, 'T')).toContain('panel_t / 2.0')
  })

  it('sizes itself from the panel thickness', () => {
    const thin = edgeJigSpec(15, 8, 50)
    const thick = edgeJigSpec(25, 8, 50)
    expect(thick.size.width).toBeGreaterThan(thin.size.width)
    expect(edgeJigScad(thin, 'T')).toMatch(/panel_t\s+=\s+15;/)
  })

  it('is small enough to print without thinking about it', () => {
    const spec = edgeJigSpec(18, 8, 50)
    expect(spec.size.length).toBeLessThan(spec.bed.length)
    expect(spec.size.width).toBeLessThan(spec.bed.width)
  })

  it('says it is not for shelf pins or confirmats', () => {
    const s = edgeJigScad(edgeJigSpec(18, 8, 50), 'T')
    expect(s).toContain('NOT for shelf pins')
    expect(s).toContain('CHECK THIS against your minifix bolt')
  })

  it('carries the bit diameter through both formats', () => {
    for (const d of [5, 8, 10]) {
      const spec = edgeJigSpec(18, d, 50)
      expect(edgeJigScad(spec, 'T')).toMatch(new RegExp(`bit_d\\s+=\\s+${d};`))
      expect(edgeJigFreecadMacro(spec, 'T')).toMatch(new RegExp(`bit_d\\s+=\\s+${d}\\.0`))
    }
  })
})
