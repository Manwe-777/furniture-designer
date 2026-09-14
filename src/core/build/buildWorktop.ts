import { box, mm } from '../geom'
import type { Worktop } from '../types'
import { allEdgesBand, PartCollector, type BuildResult, type MaterialLookup } from './buildCabinet'

/**
 * Worktops, including the L-shaped desktop.
 *
 * An L is deliberately generated as TWO RECTANGLES butt-joined, never as one
 * L-shaped piece. Cutting an L out of a sheet wastes the inside corner and cannot
 * be produced by a guillotine saw at all, so keeping every part rectangular is what
 * makes the cut plan actually runnable. You choose which leg swallows the corner
 * square via `seam`; the 3D view renders the two pieces flush so it still reads as
 * one continuous surface.
 *
 * Local space: the inside corner is at the origin, leg A runs along +X and leg B
 * runs along +Z.
 */
export function buildWorktop(wt: Worktop, mat: MaterialLookup): BuildResult {
  const material = mat(wt.materialId)
  const t = material.thickness
  const band = wt.banding.enabled ? wt.banding.thickness : 0
  const c = new PartCollector(
    wt.id,
    band,
    wt.banding.enabled && wt.banding.compensate,
    mat,
  )

  if (wt.shape === 'rect') {
    c.add({
      role: 'worktop',
      label: wt.name,
      materialId: wt.materialId,
      thickness: t,
      box: box(0, wt.a.length, 0, t, 0, wt.a.depth),
      thicknessAxis: 'y',
      lengthAxis: wt.a.length >= wt.a.depth ? 'x' : 'z',
      banding: allEdgesBand(),
    })
    return { parts: c.parts, warnings: c.warnings, regions: [] }
  }

  if (wt.seam === 'a') {
    // Leg A takes the corner square; leg B is the remainder beyond A's depth.
    const remainder = wt.b.length - wt.a.depth
    c.add({
      role: 'worktop',
      label: `${wt.name} — leg A`,
      materialId: wt.materialId,
      thickness: t,
      box: box(0, wt.a.length, 0, t, 0, wt.a.depth),
      thicknessAxis: 'y',
      lengthAxis: 'x',
      banding: allEdgesBand(),
    })
    if (remainder <= 0) {
      c.warn(
        `Leg B (${mm(wt.b.length)}mm) must be longer than leg A's depth (${mm(wt.a.depth)}mm) to form an L`,
      )
    } else {
      c.add({
        role: 'worktop',
        label: `${wt.name} — leg B`,
        materialId: wt.materialId,
        thickness: t,
        box: box(0, wt.b.depth, 0, t, wt.a.depth, wt.b.length),
        thicknessAxis: 'y',
        lengthAxis: 'z',
        banding: allEdgesBand(),
      })
    }
  } else {
    // Leg B takes the corner square; leg A is the remainder beyond B's depth.
    const remainder = wt.a.length - wt.b.depth
    c.add({
      role: 'worktop',
      label: `${wt.name} — leg B`,
      materialId: wt.materialId,
      thickness: t,
      box: box(0, wt.b.depth, 0, t, 0, wt.b.length),
      thicknessAxis: 'y',
      lengthAxis: 'z',
      banding: allEdgesBand(),
    })
    if (remainder <= 0) {
      c.warn(
        `Leg A (${mm(wt.a.length)}mm) must be longer than leg B's depth (${mm(wt.b.depth)}mm) to form an L`,
      )
    } else {
      c.add({
        role: 'worktop',
        label: `${wt.name} — leg A`,
        materialId: wt.materialId,
        thickness: t,
        box: box(wt.b.depth, wt.a.length, 0, t, 0, wt.a.depth),
        thicknessAxis: 'y',
        lengthAxis: 'x',
        banding: allEdgesBand(),
      })
    }
  }

  return { parts: c.parts, warnings: c.warnings, regions: [] }
}
