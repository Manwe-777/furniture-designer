import type { Axis, Box, Transform } from './types'

/**
 * Round to 0.01mm. Panel maths chains a lot of subtractions and we do not want
 * 581.9999999999999 showing up on a cut list.
 */
export function mm(value: number): number {
  return Math.round(value * 100) / 100
}

/** An interior volume being subdivided, in a cabinet's local space. */
export interface Region {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

export const regionWidth = (r: Region) => r.x1 - r.x0
export const regionHeight = (r: Region) => r.y1 - r.y0
export const regionDepth = (r: Region) => r.z1 - r.z0

export function box(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): Box {
  return {
    pos: [mm(x0), mm(y0), mm(z0)],
    size: [mm(x1 - x0), mm(y1 - y0), mm(z1 - z0)],
  }
}

/**
 * Rotate an axis-aligned box about the local Y axis by a multiple of 90° and then
 * translate it. Because the angle is a right angle multiple the box stays axis
 * aligned; only the X/Z extents swap for 90° and 270°.
 *
 * Y-up right-handed rotation: x' = x·cosθ + z·sinθ, z' = -x·sinθ + z·cosθ.
 */
export function applyTransform(b: Box, t: Transform): Box {
  const [x, y, z] = b.pos
  const [dx, dy, dz] = b.size

  let nx: number
  let nz: number
  let ndx: number
  let ndz: number

  switch (t.rotY) {
    case 0:
      nx = x
      nz = z
      ndx = dx
      ndz = dz
      break
    case 90:
      // corners (x..x+dx, z..z+dz) -> (z..z+dz, -(x+dx)..-x)
      nx = z
      nz = -(x + dx)
      ndx = dz
      ndz = dx
      break
    case 180:
      nx = -(x + dx)
      nz = -(z + dz)
      ndx = dx
      ndz = dz
      break
    case 270:
      nx = -(z + dz)
      nz = x
      ndx = dz
      ndz = dx
      break
  }

  return {
    pos: [mm(nx + t.x), mm(y + t.y), mm(nz + t.z)],
    size: [mm(ndx), mm(dy), mm(ndz)],
  }
}

/**
 * Where a local axis points after a rotation about Y.
 *
 * A part's thickness and length axes are recorded in its cabinet's own frame, but
 * its box is world-placed. Quarter turns swap X and Z, so the axes have to travel
 * with the box or a rotated cabinet ends up with its banding drawn on the wrong
 * edge — the kind of error that looks fine until you compare it with the cut list.
 */
export function rotateAxis(axis: Axis, rotY: Transform['rotY']): Axis {
  if (axis === 'y' || rotY === 0 || rotY === 180) return axis
  return axis === 'x' ? 'z' : 'x'
}

/**
 * The slab of edge banding on one edge of a panel, as a box in the same space.
 *
 * A panel's banded edge is its NARROW face — length × thickness — so the banding
 * covers that whole face rather than being a thin line along it. That is what makes
 * it visible at a glance: the edge reads as a different colour, and you can see at
 * once whether the front edge of a shelf is the one that got it.
 *
 * `side` 0 is the edge at the lower coordinate, 1 the higher, matching EdgeBanding.
 *
 * The slab sits just OUTSIDE the panel, overlapping it by a hair. Banding really is
 * applied to the outside of the cut piece, and drawing it flush instead leaves the
 * two surfaces coplanar — which renders as z-fighting, so the banding appears on
 * some panels and silently vanishes on others.
 */
export function bandingBox(
  box: Box,
  thicknessAxis: Axis,
  lengthAxis: Axis,
  along: 'length' | 'width',
  side: 0 | 1,
  bandThickness: number,
): Box {
  const index: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }
  const other = (['x', 'y', 'z'] as Axis[]).find(
    (a) => a !== thicknessAxis && a !== lengthAxis,
  )!

  // An edge that runs ALONG the length sits at an end of the other axis, and vice
  // versa — the same relationship the banding flags use.
  const axis = along === 'length' ? other : lengthAxis
  const i = index[axis]

  const pos: [number, number, number] = [...box.pos]
  const size: [number, number, number] = [...box.size]

  const overlap = 0.2
  const t = Math.max(bandThickness, overlap * 2)
  size[i] = t
  pos[i] =
    side === 1
      ? box.pos[i] + box.size[i] - overlap
      : box.pos[i] - t + overlap

  return { pos, size }
}
