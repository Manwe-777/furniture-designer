import { box, mm, type Region } from '../geom'
import type { Cabinet, DrawersContent } from '../types'
import { allEdgesBand, frontBand, type MaterialLookup, type PartCollector } from './buildCabinet'
import { resolveSizes } from './span'

/**
 * A drawer stack inside one cell.
 *
 * The clearances here are the ones that actually bite when you build:
 *  - the box is narrower than the opening by the slide clearance on EACH side
 *    (12.7mm per side is the standard for ball-bearing runners)
 *  - the box is shorter than its face, so the face can overlap the opening
 *  - the box stops short of the cabinet back so it can be pulled right out
 */
export function buildDrawers(
  content: DrawersContent,
  nodeId: string,
  region: Region,
  cab: Cabinet,
  c: PartCollector,
  mat: MaterialLookup,
): void {
  const count = Math.max(0, Math.floor(content.count))
  if (count === 0) return

  const g = content.gap
  const faceMatId = content.faceMaterialId ?? cab.materialId
  const boxMatId = content.boxMaterialId ?? cab.materialId
  const bottomMatId = content.bottomMaterialId ?? cab.back.materialId ?? cab.materialId
  const tf = mat(faceMatId).thickness
  const tbx = mat(boxMatId).thickness
  const tbot = mat(bottomMatId).thickness

  const cellHeight = region.y1 - region.y0
  const opening = region.x1 - region.x0

  // available = cellHeight − (count + 1) × gap
  const heights = resolveSizes(
    content.heights.slice(0, count),
    cellHeight - 2 * g,
    g,
  )

  if (heights.length !== count || heights.some((h) => h <= 0)) {
    c.warn(`${count} drawer faces do not fit in a ${mm(cellHeight)}mm opening`, nodeId)
    return
  }

  const boxOuterWidth = opening - 2 * content.slideClearance
  const boxDepth = region.z1 - region.z0 - tf - content.boxBackClearance

  if (boxOuterWidth <= 2 * tbx || boxDepth <= 2 * tbx) {
    c.warn('Drawer box has no room left after slide clearance and back clearance', nodeId)
    return
  }

  const bx0 = region.x0 + content.slideClearance
  const bz0 = region.z0 + content.boxBackClearance

  let y = region.y0 + g

  for (let i = 0; i < count; i++) {
    const faceH = heights[i]

    c.add({
      role: 'drawer-face',
      label: `Drawer face ${i + 1}`,
      materialId: faceMatId,
      thickness: tf,
      box: box(region.x0 + g, region.x1 - g, y, y + faceH, region.z1 - tf, region.z1),
      thicknessAxis: 'z',
      lengthAxis: 'x',
      banding: allEdgesBand(),
      nodeId,
    })

    const boxH = faceH - content.boxHeightReduction
    if (boxH <= 0) {
      c.warn(`Drawer ${i + 1} face is shorter than the box height reduction`, nodeId)
      y += faceH + g
      continue
    }

    // Centre the box vertically behind its face.
    const by0 = y + content.boxHeightReduction / 2
    const by1 = by0 + boxH

    for (const [label, x0] of [
      ['left', bx0],
      ['right', bx0 + boxOuterWidth - tbx],
    ] as const) {
      c.add({
        role: 'drawer-side',
        label: `Drawer ${i + 1} side (${label})`,
        materialId: boxMatId,
        thickness: tbx,
        box: box(x0, x0 + tbx, by0, by1, bz0, bz0 + boxDepth),
        thicknessAxis: 'x',
        lengthAxis: 'z',
        banding: frontBand(),
        nodeId,
      })
    }

    for (const [label, z0] of [
      ['back', bz0],
      ['front', bz0 + boxDepth - tbx],
    ] as const) {
      c.add({
        role: 'drawer-fb',
        label: `Drawer ${i + 1} ${label}`,
        materialId: boxMatId,
        thickness: tbx,
        box: box(bx0 + tbx, bx0 + boxOuterWidth - tbx, by0, by1, z0, z0 + tbx),
        thicknessAxis: 'z',
        lengthAxis: 'x',
        nodeId,
      })
    }

    c.add({
      role: 'drawer-bottom',
      label: `Drawer ${i + 1} bottom`,
      materialId: bottomMatId,
      thickness: tbot,
      box: box(bx0, bx0 + boxOuterWidth, by0 - tbot, by0, bz0, bz0 + boxDepth),
      thicknessAxis: 'y',
      lengthAxis: 'x',
      nodeId,
    })

    y += faceH + g
  }
}
