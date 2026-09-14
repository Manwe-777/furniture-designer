import { describe, expect, it } from 'vitest'
import { buildCabinet } from './buildCabinet'
import { materialLookup } from './buildDesign'
import {
  MAT_MDF18,
  MAT_MDF6,
  cellWith,
  defaultMaterials,
  drawersContent,
  newCabinet,
  newDesign,
  shelvesContent,
} from '../defaults'
import type { Cabinet, Part } from '../types'
import { fixed, flex } from '../types'

const mat = materialLookup(newDesign())

function build(cab: Cabinet) {
  return buildCabinet(cab, mat)
}

const byRole = (parts: Part[], role: string) => parts.filter((p) => p.role === role)
const one = (parts: Part[], role: string) => {
  const found = byRole(parts, role)
  expect(found).toHaveLength(1)
  return found[0]
}
const cut = (p: Part) => [p.length, p.width]

describe('carcass style', () => {
  const base = () =>
    newCabinet({
      width: 800,
      height: 720,
      depth: 400,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      banding: { enabled: false, thickness: 0, compensate: false },
      root: cellWith({ type: 'empty' }),
    })

  it('sides-full: sides run the full height, top and bottom land between them', () => {
    const { parts } = build(base())
    const sides = byRole(parts, 'side')
    expect(sides).toHaveLength(2)
    // Full height × full depth.
    expect(cut(sides[0])).toEqual([720, 400])
    // 800 − 2 × 18 = 764.
    expect(cut(one(parts, 'top'))).toEqual([764, 400])
    expect(cut(one(parts, 'bottom'))).toEqual([764, 400])
  })

  it('topbottom-full: top and bottom run the full width, sides land between them', () => {
    const { parts } = build({ ...base(), carcass: 'topbottom-full' })
    expect(cut(one(parts, 'top'))).toEqual([800, 400])
    // 720 − 2 × 18 = 684.
    expect(cut(byRole(parts, 'side')[0])).toEqual([684, 400])
  })

  it('every carcass style encloses the same interior, so shelves match', () => {
    const withShelves = (carcass: Cabinet['carcass']) =>
      build({ ...base(), carcass, root: cellWith(shelvesContent(1)) }).parts

    const a = one(withShelves('sides-full'), 'shelf')
    const b = one(withShelves('topbottom-full'), 'shelf')
    expect(cut(a)).toEqual(cut(b))
  })
})

describe('back panel styles', () => {
  const base = () =>
    newCabinet({
      width: 800,
      height: 720,
      depth: 400,
      banding: { enabled: false, thickness: 0, compensate: false },
      root: cellWith(shelvesContent(1)),
    })

  it('none: the carcass keeps its full depth and shelves reach the back', () => {
    const { parts } = build({ ...base(), back: { style: 'none', thickness: 0, rebateDepth: 0 } })
    expect(byRole(parts, 'back')).toHaveLength(0)
    expect(cut(byRole(parts, 'side')[0])).toEqual([720, 400])
    expect(cut(one(parts, 'shelf'))[1]).toBe(400)
  })

  it('overlay: the back covers the whole rear face and pushes the carcass forward', () => {
    const { parts } = build({
      ...base(),
      back: { style: 'overlay', thickness: 6, rebateDepth: 0, materialId: MAT_MDF6 },
    })
    // Full outside dimensions of the cabinet.
    expect(cut(one(parts, 'back'))).toEqual([720, 800])
    // Carcass depth lost one back thickness: 400 − 6.
    expect(cut(byRole(parts, 'side')[0])).toEqual([720, 394])
    expect(cut(one(parts, 'shelf'))[1]).toBe(394)
  })

  it('inset: the back fits the interior opening', () => {
    const { parts } = build({
      ...base(),
      back: { style: 'inset', thickness: 6, rebateDepth: 0, materialId: MAT_MDF6 },
    })
    // 720 − 36 high × 800 − 36 wide.
    expect(cut(one(parts, 'back'))).toEqual([684, 764])
    // Carcass keeps full depth, but the shelf stops at the back panel.
    expect(cut(byRole(parts, 'side')[0])).toEqual([720, 400])
    expect(cut(one(parts, 'shelf'))[1]).toBe(394)
  })

  it('rebate: the back is oversized by the groove depth on every side', () => {
    const { parts } = build({
      ...base(),
      back: { style: 'rebate', thickness: 6, rebateDepth: 9, materialId: MAT_MDF6 },
    })
    // Inset size plus 2 × 9 in both directions.
    expect(cut(one(parts, 'back'))).toEqual([684 + 18, 764 + 18])
    expect(cut(one(parts, 'shelf'))[1]).toBe(394)
  })
})

describe('shelves', () => {
  const base = (extra: Partial<Cabinet> = {}) =>
    newCabinet({
      width: 800,
      height: 720,
      depth: 400,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      banding: { enabled: false, thickness: 0, compensate: false },
      ...extra,
    })

  it('spaces shelves to give equal openings', () => {
    // Grid off: this is about the raw spacing, before any snapping to a hole.
    const { parts } = build(base({ holeGrid: undefined, root: cellWith(shelvesContent(3)) }))
    const shelves = byRole(parts, 'shelf')
    expect(shelves).toHaveLength(3)

    // Interior height 720 − 36 = 684; 3 × 18mm shelves leave 630 over 4 openings.
    const openings: number[] = []
    let cursor = 18 // interior floor
    for (const s of shelves) {
      openings.push(s.box.pos[1] - cursor)
      cursor = s.box.pos[1] + s.box.size[1]
    }
    openings.push(702 - cursor)
    for (const o of openings) expect(o).toBeCloseTo(157.5, 6)
  })

  it('subtracts the front setback from the shelf depth', () => {
    const { parts } = build(
      base({ holeGrid: undefined, root: cellWith({ ...shelvesContent(1), setback: 20 } as never) }),
    )
    expect(cut(one(parts, 'shelf'))).toEqual([764, 380])
  })

  it('honours explicit shelf positions', () => {
    const { parts } = build(
      base({
        // With a hole grid on, an adjustable shelf must land on a hole — so switch
        // it off to check the raw positions are respected.
        holeGrid: undefined,
        root: cellWith({ ...shelvesContent(2), positions: [100, 400] } as never),
      }),
    )
    const shelves = byRole(parts, 'shelf')
    expect(shelves[0].box.pos[1]).toBe(118) // interior floor 18 + 100
    expect(shelves[1].box.pos[1]).toBe(418)
  })

  it('warns instead of emitting nonsense when the shelves cannot fit', () => {
    const { parts, warnings } = build(
      base({ height: 60, root: cellWith(shelvesContent(5)) }),
    )
    expect(byRole(parts, 'shelf')).toHaveLength(0)
    expect(warnings.join(' ')).toBeDefined()
    expect(warnings.some((w) => w.message.includes('do not fit'))).toBe(true)
  })
})

describe('splits', () => {
  const base = (root: Cabinet['root']) =>
    newCabinet({
      width: 800,
      height: 720,
      depth: 400,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      banding: { enabled: false, thickness: 0, compensate: false },
      root,
    })

  it('a fixed column plus two flex columns sums exactly to the interior span', () => {
    const { parts } = build(
      base({
        id: 'split1',
        kind: 'split',
        dir: 'v',
        dividerThickness: 18,
        sizes: [fixed(200), flex(1), flex(1)],
        children: [
          cellWith(shelvesContent(1)),
          cellWith(shelvesContent(1)),
          cellWith(shelvesContent(1)),
        ],
      }),
    )

    const dividers = byRole(parts, 'divider')
    expect(dividers).toHaveLength(2)

    const shelves = byRole(parts, 'shelf')
    expect(shelves).toHaveLength(3)

    // Interior 764 − 2 × 18 dividers = 728 available; 200 fixed leaves 528 split evenly.
    expect(shelves.map((s) => s.length)).toEqual([200, 264, 264])
    // Columns and dividers must tile the interior exactly, with no gap or overlap.
    const total =
      shelves.reduce((sum, s) => sum + s.length, 0) +
      dividers.reduce((sum, d) => sum + d.thickness, 0)
    expect(total).toBe(764)
  })

  it('a horizontal split stacks rows bottom-to-top with a shelf between them', () => {
    const { parts } = build(
      base({
        id: 'split1',
        kind: 'split',
        dir: 'h',
        dividerThickness: 18,
        sizes: [fixed(300), flex(1)],
        children: [cellWith({ type: 'empty' }), cellWith({ type: 'empty' })],
      }),
    )
    const divider = one(parts, 'divider')
    // Interior floor 18 + the 300mm bottom row.
    expect(divider.box.pos[1]).toBe(318)
    expect(cut(divider)).toEqual([764, 400])
  })

  it('warns when fixed children overflow the span', () => {
    const { warnings } = build(
      base({
        id: 'split1',
        kind: 'split',
        dir: 'v',
        dividerThickness: 18,
        sizes: [fixed(600), fixed(600)],
        children: [cellWith({ type: 'empty' }), cellWith({ type: 'empty' })],
      }),
    )
    expect(warnings.some((w) => w.message.includes('does not fit'))).toBe(true)
  })
})

describe('edge banding compensation', () => {
  it('cuts banded parts undersize so they finish at the nominal dimension', () => {
    const cab = newCabinet({
      width: 800,
      height: 720,
      depth: 400,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      banding: { enabled: true, thickness: 1, compensate: true },
      root: cellWith(shelvesContent(1)),
    })
    const { parts } = build(cab)

    // Front edge banded: the depth is cut 1mm short, the length is untouched.
    expect(cut(one(parts, 'shelf'))).toEqual([764, 399])
    expect(cut(byRole(parts, 'side')[0])).toEqual([720, 399])
    // The 3D box still shows the FINISHED size.
    expect(one(parts, 'shelf').box.size[2]).toBe(400)
  })

  it('leaves cut sizes alone when compensation is off', () => {
    const cab = newCabinet({
      width: 800,
      height: 720,
      depth: 400,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      banding: { enabled: true, thickness: 1, compensate: false },
      root: cellWith(shelvesContent(1)),
    })
    expect(cut(one(build(cab).parts, 'shelf'))).toEqual([764, 400])
  })
})

describe('drawers', () => {
  const cab = () =>
    newCabinet({
      width: 450,
      height: 702,
      depth: 580,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      banding: { enabled: false, thickness: 0, compensate: false },
      root: cellWith(drawersContent(3)),
    })

  it('takes slide clearance off both sides of the drawer box', () => {
    const { parts } = build(cab())
    const sides = byRole(parts, 'drawer-side')
    expect(sides).toHaveLength(6)

    // Opening 450 − 36 = 414; box outer = 414 − 2 × 12.7 = 388.6.
    const fb = byRole(parts, 'drawer-fb')[0]
    // Front/back sit between the 12mm box sides: 388.6 − 24 = 364.6.
    expect(fb.length).toBeCloseTo(364.6, 6)
    expect(byRole(parts, 'drawer-bottom')[0].length).toBeCloseTo(388.6, 6)
  })

  it('stops the box short of the cabinet back and behind the face', () => {
    const { parts } = build(cab())
    // Depth 580 − 18 face − 10 back clearance = 552.
    expect(byRole(parts, 'drawer-side')[0].length).toBe(552)
  })

  it('makes each box shorter than its face by the reduction', () => {
    const { parts } = build(cab())
    const face = byRole(parts, 'drawer-face')[0]
    const side = byRole(parts, 'drawer-side')[0]
    expect(side.width).toBeCloseTo(face.width - 30, 6)
  })

  it('splits the opening into equal faces separated by gaps', () => {
    const { parts } = build(cab())
    const faces = byRole(parts, 'drawer-face')
    expect(faces).toHaveLength(3)
    // Interior height 702 − 36 = 666, minus 4 × 3mm gaps = 654 over 3 faces.
    for (const f of faces) expect(f.width).toBeCloseTo(218, 6)
  })

  it('respects fixed face heights', () => {
    const drawers = { ...drawersContent(3), heights: [fixed(150), flex(1), flex(1)] }
    const { parts } = build({ ...cab(), root: cellWith(drawers as never) })
    const faces = byRole(parts, 'drawer-face')
    expect(faces[0].width).toBe(150)
    expect(faces[1].width).toBeCloseTo(252, 6)
  })
})

describe('plinth', () => {
  it('raises the carcass and adds its own rails', () => {
    const { parts } = build(
      newCabinet({
        width: 800,
        height: 720,
        depth: 400,
        plinth: { height: 100, setback: 50 },
        back: { style: 'none', thickness: 0, rebateDepth: 0 },
        banding: { enabled: false, thickness: 0, compensate: false },
        root: cellWith({ type: 'empty' }),
      }),
    )
    expect(byRole(parts, 'plinth')).toHaveLength(4)
    const side = byRole(parts, 'side')[0]
    // The carcass now starts at 100mm and is 620mm tall.
    expect(side.box.pos[1]).toBe(100)
    expect(side.length).toBe(620)
    // Side rails run from the back to the setback front face.
    expect(byRole(parts, 'plinth')[0].length).toBe(350)
  })
})

describe('material defaults', () => {
  it('uses the cabinet material when a cell does not override it', () => {
    const { parts } = build(
      newCabinet({ materialId: MAT_MDF18, root: cellWith(shelvesContent(1)) }),
    )
    expect(one(parts, 'shelf').materialId).toBe(MAT_MDF18)
    expect(one(parts, 'shelf').thickness).toBe(18)
  })

  it('falls back to a visible placeholder rather than crashing on a bad id', () => {
    const lookup = materialLookup({ ...newDesign(), materials: defaultMaterials() })
    expect(lookup('nope').id).toBe(MAT_MDF18)
  })
})

describe('omitted panels (modules that share a panel with a neighbour)', () => {
  const base = (omit: Partial<Cabinet['omit']> = {}) =>
    newCabinet({
      width: 800,
      height: 720,
      depth: 400,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      banding: { enabled: false, thickness: 0, compensate: false },
      root: cellWith(shelvesContent(1)),
      omit: { left: false, right: false, top: false, bottom: false, ...omit },
    })

  it('does not cut a panel for an omitted face', () => {
    const { parts } = build(base({ left: true }))
    const sides = byRole(parts, 'side')
    expect(sides).toHaveLength(1)
    expect(sides[0].label).toBe('Side (right)')
  })

  it('grows the remaining panels into the space the missing one left', () => {
    const closed = build(base()).parts
    const openLeft = build(base({ left: true })).parts

    // sides-full: top spans between the sides, so losing one gains its thickness.
    expect(cut(one(closed, 'top'))[0]).toBe(764)
    expect(cut(one(openLeft, 'top'))[0]).toBe(782)
    // The shelf inside grows by the same 18mm and now reaches the neighbour's panel.
    expect(cut(one(closed, 'shelf'))[0]).toBe(764)
    expect(cut(one(openLeft, 'shelf'))[0]).toBe(782)
  })

  it('starts the interior at the cabinet boundary on an omitted face', () => {
    const { parts } = build(base({ left: true }))
    expect(one(parts, 'shelf').box.pos[0]).toBe(0)
    // The right-hand side panel is still in place, so the shelf stops short there.
    expect(one(parts, 'shelf').box.pos[0] + one(parts, 'shelf').box.size[0]).toBe(782)
  })

  it('handles an omitted top and bottom', () => {
    const { parts } = build(base({ top: true, bottom: true }))
    expect(byRole(parts, 'top')).toHaveLength(0)
    expect(byRole(parts, 'bottom')).toHaveLength(0)
    // Sides still run the full height; the shelf now spans the whole opening.
    expect(cut(byRole(parts, 'side')[0])).toEqual([720, 400])
    expect(one(parts, 'shelf').box.pos[1]).toBeGreaterThan(0)
  })

  it('topbottom-full: an omitted top makes the sides taller', () => {
    const closed = build({ ...base(), carcass: 'topbottom-full' }).parts
    const openTop = build({ ...base({ top: true }), carcass: 'topbottom-full' }).parts
    // 720 − 2 × 18 closed, 720 − 18 with no top to land under.
    expect(cut(byRole(closed, 'side')[0])[0]).toBe(684)
    expect(cut(byRole(openTop, 'side')[0])[0]).toBe(702)
  })

  it('does not rebate the back into a panel that is not there', () => {
    const withBack = (omit: Partial<Cabinet['omit']>) =>
      build({
        ...base(omit),
        back: { style: 'rebate', thickness: 6, rebateDepth: 9, materialId: MAT_MDF6 },
      }).parts

    // Closed: interior opening plus 9mm of groove on all four sides.
    expect(cut(one(withBack({}), 'back'))).toEqual([702, 782])
    // Left omitted: the back reaches the boundary there, with no groove allowance.
    expect(cut(one(withBack({ left: true }), 'back'))).toEqual([702, 791])
  })

  it('warns rather than emitting nonsense when every face is omitted and nothing fits', () => {
    const { warnings } = build({
      ...base({ left: true, right: true, top: true, bottom: true }),
      width: 10,
      height: 10,
    })
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('two modules sharing one panel cut that panel exactly once', () => {
    // A closed 800mm module, then a 600mm module butted against its right side.
    const left = build(base()).parts
    const right = build({ ...base({ left: true }), width: 600 }).parts

    const sides = [...byRole(left, 'side'), ...byRole(right, 'side')]
    // Three panels for two modules, not four — the middle one is shared.
    expect(sides).toHaveLength(3)

    // The right module's shelf spans its full width bar its own right-hand panel.
    expect(cut(one(right, 'shelf'))[0]).toBe(600 - 18)
    // Placed at x = 800 the two interiors meet exactly at the shared panel's face.
    const sharedFace = 800
    const leftShelf = one(left, 'shelf')
    expect(leftShelf.box.pos[0] + leftShelf.box.size[0]).toBe(sharedFace - 18)
    expect(800 + one(right, 'shelf').box.pos[0]).toBe(sharedFace)
  })
})
