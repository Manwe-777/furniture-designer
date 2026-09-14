import { applyTransform } from '../geom'
import type { Design, Material, Part } from '../types'
import { buildCabinet, type BuildResult, type MaterialLookup } from './buildCabinet'
import { buildWorktop } from './buildWorktop'

const FALLBACK_MATERIAL: Material = {
  id: '__missing__',
  name: 'Missing material',
  thickness: 18,
  sheet: { length: 2440, width: 1220 },
  pricePerSheet: 0,
  hasGrain: false,
  color: '#ff3b6b',
}

export function materialLookup(design: Design): MaterialLookup {
  const byId = new Map(design.materials.map((m) => [m.id, m]))
  return (id) => byId.get(id) ?? design.materials[0] ?? FALLBACK_MATERIAL
}

export function materialsById(design: Design): Map<string, Material> {
  return new Map(design.materials.map((m) => [m.id, m]))
}

/**
 * The single source of truth: a design becomes a flat list of world-placed parts.
 *
 * The 3D view renders these boxes, the BOM groups them, and the nester packs their
 * cut rectangles. Because geometry is computed exactly once, those three views can
 * never disagree with each other.
 */
export function buildDesign(design: Design): BuildResult {
  const mat = materialLookup(design)
  const parts: Part[] = []
  const warnings: BuildResult['warnings'] = []
  const regions: BuildResult['regions'] = []

  for (const cab of design.cabinets) {
    const result = buildCabinet(cab, mat)
    warnings.push(...result.warnings)
    regions.push(...result.regions)
    for (const part of result.parts) {
      parts.push({ ...part, box: applyTransform(part.box, cab.transform) })
    }
  }

  for (const wt of design.worktops) {
    const result = buildWorktop(wt, mat)
    warnings.push(...result.warnings)
    for (const part of result.parts) {
      parts.push({ ...part, box: applyTransform(part.box, wt.transform) })
    }
  }

  return { parts, warnings, regions }
}

/** World-space bounds of every part, for framing the camera. */
export function designBounds(parts: Part[]): { min: [number, number, number]; max: [number, number, number] } {
  if (parts.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p.box.pos[i])
      max[i] = Math.max(max[i], p.box.pos[i] + p.box.size[i])
    }
  }
  return { min, max }
}
