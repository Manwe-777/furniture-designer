import { describe, expect, it } from 'vitest'
import { bandingBox, rotateAxis } from './geom'
import { buildDesign } from './build/buildDesign'
import { cellWith, newCabinet, newDesign, shelvesContent } from './defaults'
import type { Box, Design } from './types'

const box: Box = { pos: [0, 0, 0], size: [800, 18, 300] }

describe('locating a banded edge', () => {
  // A horizontal panel: thickness up Y, length along X, so width runs along Z.
  it('puts an alongLength edge at an end of the width axis', () => {
    const front = bandingBox(box, 'y', 'x', 'length', 1, 2)
    // Full length, full thickness, 2mm deep just beyond the far end of Z.
    expect(front.size).toEqual([800, 18, 2])
    expect(front.pos[2]).toBeCloseTo(299.8, 6)

    const back = bandingBox(box, 'y', 'x', 'length', 0, 2)
    expect(back.pos[2]).toBeCloseTo(-1.8, 6)
  })

  it('puts an alongWidth edge at an end of the length axis', () => {
    const right = bandingBox(box, 'y', 'x', 'width', 1, 2)
    expect(right.size).toEqual([2, 18, 300])
    expect(right.pos[0]).toBeCloseTo(799.8, 6)
  })

  it('sits outside the panel, overlapping it just enough to avoid a gap', () => {
    // Flush would be coplanar with the panel face and z-fight; a clean gap would
    // look like the banding is floating.
    const b = bandingBox(box, 'y', 'x', 'length', 1, 3)
    const panelFace = box.pos[2] + box.size[2]
    expect(b.pos[2]).toBeLessThan(panelFace)
    expect(b.pos[2] + b.size[2]).toBeGreaterThan(panelFace)
  })

  it('covers the whole narrow face, not a line along it', () => {
    // The banded face is length x thickness — that is what makes it visible.
    const b = bandingBox(box, 'y', 'x', 'length', 1, 2)
    expect(b.size[0]).toBe(800)
    expect(b.size[1]).toBe(18)
  })

  it('stays visible on a panel thinner than the banding itself', () => {
    const thin: Box = { pos: [0, 0, 0], size: [800, 18, 1] }
    expect(bandingBox(thin, 'y', 'x', 'length', 1, 5).size[2]).toBe(5)
  })
})

describe('axes follow a rotated cabinet', () => {
  it('swaps x and z on a quarter turn', () => {
    expect(rotateAxis('x', 90)).toBe('z')
    expect(rotateAxis('z', 90)).toBe('x')
    expect(rotateAxis('x', 270)).toBe('z')
    expect(rotateAxis('y', 90)).toBe('y')
  })

  it('leaves them alone at 0 and 180', () => {
    expect(rotateAxis('x', 0)).toBe('x')
    expect(rotateAxis('x', 180)).toBe('x')
  })

  it('keeps the banded edge on the front face after rotating the cabinet', () => {
    const make = (rotY: 0 | 90): Design => ({
      ...newDesign(),
      cabinets: [
        newCabinet({
          width: 800, height: 900, depth: 300,
          back: { style: 'none', thickness: 0, rebateDepth: 0 },
          root: cellWith(shelvesContent(1)),
          transform: { x: 0, y: 0, z: 0, rotY },
        }),
      ],
    })

    const shelfOf = (d: Design) => buildDesign(d).parts.find((p) => p.role === 'shelf')!
    const straight = shelfOf(make(0))
    const turned = shelfOf(make(90))

    // Unrotated the shelf's depth runs along Z; turned a quarter, along X.
    expect(straight.lengthAxis).toBe('x')
    expect(turned.lengthAxis).toBe('z')

    // The front edge is banded in both cases, and the banding slab must be thin on
    // whichever axis the depth now runs along.
    const bandOf = (p: typeof straight) =>
      bandingBox(p.box, p.thicknessAxis, p.lengthAxis, 'length', 1, 3)
    expect(bandOf(straight).size[2]).toBe(3)
    expect(bandOf(turned).size[0]).toBe(3)
  })
})
