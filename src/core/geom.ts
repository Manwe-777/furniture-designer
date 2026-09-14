import type { Box, Transform } from './types'

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
