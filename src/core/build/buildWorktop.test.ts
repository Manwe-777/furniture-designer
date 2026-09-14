import { describe, expect, it } from 'vitest'
import { buildWorktop } from './buildWorktop'
import { materialLookup } from './buildDesign'
import { newDesign, newWorktop } from '../defaults'

const mat = materialLookup(newDesign())
const noBanding = { enabled: false, thickness: 0, compensate: false }

describe('rectangular worktop', () => {
  it('is a single panel at its nominal size', () => {
    const { parts } = buildWorktop(
      newWorktop({ a: { length: 1600, depth: 600 }, banding: noBanding }),
      mat,
    )
    expect(parts).toHaveLength(1)
    expect([parts[0].length, parts[0].width]).toEqual([1600, 600])
  })
})

describe('L-shaped worktop', () => {
  const base = () =>
    newWorktop({
      shape: 'L' as const,
      a: { length: 1600, depth: 600 },
      b: { length: 1400, depth: 600 },
      banding: noBanding,
    })

  it('is two rectangles, never one L-shaped piece', () => {
    const { parts } = buildWorktop({ ...base(), seam: 'a' }, mat)
    expect(parts).toHaveLength(2)
    // Both are plain rectangles, so both can be nested and cut on a saw.
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0)
      expect(p.width).toBeGreaterThan(0)
    }
  })

  it('seam a: leg A takes the corner, leg B is the remainder', () => {
    const { parts } = buildWorktop({ ...base(), seam: 'a' }, mat)
    const [legA, legB] = parts
    expect([legA.length, legA.width]).toEqual([1600, 600])
    // 1400 total − 600 swallowed by leg A's depth.
    expect([legB.length, legB.width]).toEqual([800, 600])
  })

  it('seam b: leg B takes the corner, leg A is the remainder', () => {
    const { parts } = buildWorktop({ ...base(), seam: 'b' }, mat)
    const [legB, legA] = parts
    expect([legB.length, legB.width]).toEqual([1400, 600])
    expect([legA.length, legA.width]).toEqual([1000, 600])
  })

  it('the two pieces tile the L exactly — no gap, no overlap', () => {
    for (const seam of ['a', 'b'] as const) {
      const wt = { ...base(), seam }
      const { parts } = buildWorktop(wt, mat)

      const area = parts.reduce((sum, p) => sum + p.length * p.width, 0)
      // Area of an L = both legs minus the corner square counted twice.
      const expected =
        wt.a.length * wt.a.depth + wt.b.depth * wt.b.length - wt.b.depth * wt.a.depth
      expect(area, `seam ${seam}`).toBe(expected)

      // The boxes must not overlap in plan view.
      const [p, q] = parts.map((part) => ({
        x0: part.box.pos[0],
        x1: part.box.pos[0] + part.box.size[0],
        z0: part.box.pos[2],
        z1: part.box.pos[2] + part.box.size[2],
      }))
      const overlaps = p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1
      expect(overlaps, `seam ${seam} pieces overlap`).toBe(false)
    }
  })

  it('warns when the legs are too short to form an L', () => {
    const { warnings } = buildWorktop(
      { ...base(), seam: 'a', b: { length: 400, depth: 600 } },
      mat,
    )
    expect(warnings.some((w) => w.message.includes('must be longer'))).toBe(true)
  })
})
