import { describe, expect, it } from 'vitest'
import { buildJoints, countJointHoles, jointsToCsv } from './joints'
import { buildDrilling } from './holes'
import { cellWith, newCabinet, newDesign, shelvesContent } from './defaults'
import { DEFAULT_HOLE_GRID, flex, type Cabinet, type Design, type SplitNode } from './types'
import { newId } from './ids'

const design = (cabs: Cabinet[]): Design => ({ ...newDesign(), cabinets: cabs })

const noBack = { style: 'none', thickness: 0, rebateDepth: 0 } as const
const noBanding = { enabled: false, thickness: 0, compensate: false } as const

/** A run of columns divided by vertical dividers, the shape that exposes the problem. */
const columns = (count: number, dividerThickness: number): SplitNode => ({
  id: newId('n'),
  kind: 'split',
  dir: 'v',
  dividerThickness,
  sizes: Array.from({ length: count }, () => flex(1)),
  children: Array.from({ length: count }, () => cellWith(shelvesContent(1))),
})

const shelfUnit = (overrides: Partial<Cabinet> = {}) =>
  newCabinet({
    name: 'Run',
    width: 2090,
    height: 680,
    depth: 300,
    carcass: 'topbottom-full',
    back: noBack,
    banding: noBanding,
    root: columns(3, 15),
    holeGrid: { ...DEFAULT_HOLE_GRID },
    ...overrides,
  })

describe('carcass joints', () => {
  it('drills the full-width board, not the panel standing on it', () => {
    const joints = buildJoints(design([shelfUnit()]))
    // topbottom-full: the top and bottom run through, so they are what gets drilled.
    expect(joints.map((j) => j.label).sort()).toEqual(['Bottom', 'Top'])
  })

  it('drills the side when the sides run through instead', () => {
    const joints = buildJoints(
      design([
        shelfUnit({
          carcass: 'sides-full',
          root: cellWith(shelvesContent(0)),
          width: 800,
        }),
      ]),
    )
    expect(joints.map((j) => j.label).sort()).toEqual(['Side (left)', 'Side (right)'])
  })

  it('puts a centre on every upright, including the awkward fractional ones', () => {
    const [top] = buildJoints(design([shelfUnit()])).filter((j) => j.label === 'Top')
    // 2090 wide, 18mm sides, two 15mm dividers: the openings do not come out round.
    expect(top.joints.map((j) => j.centre)).toEqual([9, 700.17, 1389.84, 2081])
    expect(top.joints.map((j) => j.mateThickness)).toEqual([18, 15, 15, 18])
  })

  it('reports how far a centre may wander before the pilot breaks out', () => {
    const [top] = buildJoints(design([shelfUnit()])).filter((j) => j.label === 'Top')
    const divider = top.joints.find((j) => j.mateThickness === 15)!
    // A 5mm pilot in a 15mm edge: 5mm either side.
    expect(divider.tolerance).toBe(5)
    expect(top.joints.find((j) => j.mateThickness === 18)!.tolerance).toBe(6.5)
  })

  it('flags a pilot that cannot stay inside the edge', () => {
    const joints = buildJoints(design([shelfUnit({ root: columns(3, 6) })]))
    const top = joints.find((j) => j.label === 'Top')!
    expect(top.joints.some((j) => j.tolerance < 1)).toBe(true)
    expect(top.warnings.join(' ')).toMatch(/thinner pilot/)
  })

  it('leaves adjustable shelves out — they are fixed to nothing', () => {
    const joints = buildJoints(design([shelfUnit()]))
    expect(joints.flatMap((j) => j.joints).some((j) => j.mateRole === 'shelf')).toBe(false)
  })

  it('fixes a fixed shelf to the panels beside it', () => {
    const fixed = shelfUnit({
      width: 800,
      carcass: 'sides-full',
      root: cellWith({ type: 'shelves', count: 1, setback: 0, fixed: true }),
    })
    const joints = buildJoints(design([fixed]))
    const side = joints.find((j) => j.label === 'Side (left)')!
    expect(side.joints.some((j) => j.mateRole === 'shelf')).toBe(true)
  })

  it('spreads the fixings in from the front and back edges', () => {
    const [top] = buildJoints(design([shelfUnit()])).filter((j) => j.label === 'Top')
    // 300mm deep board, 50mm setback both ends, two fixings per joint.
    expect(top.joints[0].holes.map((h) => h.v)).toEqual([50, 250])
  })

  it('keeps the rear fixing clear of an inset back', () => {
    const joints = buildJoints(
      design([
        shelfUnit({
          back: { style: 'rebate', thickness: 6, rebateDepth: 9, materialId: 'mdf6' },
        }),
      ]),
    )
    const top = joints.find((j) => j.label === 'Top')!
    const rear = Math.max(...top.joints[0].holes.map((h) => h.v))
    // The back and its groove take 15mm off the back edge; nothing may land there.
    expect(top.width - rear).toBeGreaterThan(15)
    expect(top.rebated).toBe(true)
  })

  it('works out the pilot depth from the screw and the board it passes through', () => {
    const [top] = buildJoints(design([shelfUnit()])).filter((j) => j.label === 'Top')
    const hole = top.joints[0].holes[0]
    // A 50mm screw through 18mm, head 2mm into its counterbore: 34mm of reach.
    expect(hole.pilotDepth).toBe(37)
    expect(hole.clearance).toBe(7)
    expect(hole.pilot).toBe(5)
  })

  it('catches a fixing that would be drilled through a shelf-pin hole', () => {
    // Both schedules are worked out independently, so they can collide. Put the
    // fixings on the 37mm pin line, and pick a height where the top's centreline
    // (H - 9) lands exactly on a grid position (50 + 32k) as well.
    const base = newDesign()
    const d: Design = {
      ...base,
      cabinets: [
        shelfUnit({
          carcass: 'sides-full',
          root: cellWith(shelvesContent(1)),
          width: 800,
          height: 667,
        }),
      ],
      settings: { ...base.settings, joints: { ...base.settings.joints, setback: 37 } },
    }
    const joints = buildJoints(d, buildDrilling(d))
    const side = joints.find((j) => j.label === 'Side (left)')!
    const gaps = side.joints.flatMap((j) => j.holes.map((h) => h.pinGap))
    expect(gaps.some((g) => g !== null && g < 2)).toBe(true)
    expect(side.warnings.join(' ')).toMatch(/shelf-pin hole/)
  })

  it('gauges each opening with a part already cut to that length', () => {
    const [top] = buildJoints(design([shelfUnit()])).filter((j) => j.label === 'Top')
    const gaps = top.setOut.filter((s) => s.kind === 'gap')
    expect(gaps).toHaveLength(3)
    // The adjustable shelves are cut to exactly the opening, so they are the gauge.
    expect(gaps.every((g) => g.kind === 'gap' && g.gauge === 'Shelf')).toBe(true)
    expect(top.setOut.filter((s) => s.kind === 'panel')).toHaveLength(4)
  })

  it('alternates panel and opening along the board', () => {
    const [top] = buildJoints(design([shelfUnit()])).filter((j) => j.label === 'Top')
    expect(top.setOut.map((s) => s.kind)).toEqual([
      'panel',
      'gap',
      'panel',
      'gap',
      'panel',
      'gap',
      'panel',
    ])
  })

  it('counts and exports every fixing', () => {
    const joints = buildJoints(design([shelfUnit()]))
    // Two boards, four joints each, two fixings per joint.
    expect(countJointHoles(joints)).toBe(16)
    const csv = jointsToCsv(joints)
    expect(csv.split('\n')).toHaveLength(17)
    expect(csv).toMatch(/1389\.84/)
  })
})
