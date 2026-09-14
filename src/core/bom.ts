import { mm } from './geom'
import type { EdgeBanding, Material, Part, PartRole } from './types'

export interface BomRow {
  key: string
  label: string
  role: PartRole
  materialId: string
  materialName: string
  thickness: number
  /** Cut dimensions, always length ≥ width for display consistency. */
  length: number
  width: number
  quantity: number
  partIds: string[]
  /** Metres of edge banding for ALL parts in this row. */
  bandingMetres: number
  bandedEdges: number
  /** Square metres for all parts in this row. */
  areaM2: number
  /** Bought to size rather than cut from a sheet. */
  supplied: boolean
}

export interface BomSummary {
  rows: BomRow[]
  totalParts: number
  totalAreaM2: number
  totalBandingMetres: number
  /** Per material: area and the theoretical minimum sheet count (ignores offcuts). */
  byMaterial: {
    materialId: string
    materialName: string
    thickness: number
    parts: number
    areaM2: number
    minSheets: number
    supplied: boolean
  }[]
}

/**
 * Cut sizes are rounded to 0.1mm for the list.
 *
 * Geometry is carried at 0.01mm so panels tile their openings exactly, but nobody
 * marks out to a hundredth of a millimetre — and left unrounded, three shelves that
 * differ by 0.01mm from rounding drift show up as two separate lines on the list,
 * which makes it look like they are genuinely different parts.
 */
const cutMm = (value: number): number => Math.round(value * 10) / 10

const bandingKey = (b: EdgeBanding) =>
  `${Number(b.alongLength[0])}${Number(b.alongLength[1])}${Number(b.alongWidth[0])}${Number(b.alongWidth[1])}`

/** Metres of banding on one part. */
export function bandingMetres(p: Part): number {
  const b = p.edgeBanding
  const alongLength = (Number(b.alongLength[0]) + Number(b.alongLength[1])) * p.length
  const alongWidth = (Number(b.alongWidth[0]) + Number(b.alongWidth[1])) * p.width
  return (alongLength + alongWidth) / 1000
}

/** Strip trailing indices so "Drawer 1 side" and "Drawer 2 side" collapse into one row. */
function genericLabel(label: string): string {
  return label.replace(/\s*\d+\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Collapse identical parts into quantities.
 *
 * Two parts are the same line item when they share material, thickness, cut size and
 * banding pattern — the things that decide how you cut them. Their labels may differ
 * (left vs right side), in which case the row takes the generic form.
 */
export function buildBom(parts: Part[], materials: Map<string, Material>): BomSummary {
  const groups = new Map<string, BomRow>()

  for (const p of parts) {
    // Normalise orientation so a 764×582 and a 582×764 of the same panel group
    // together — unless the material has grain, where orientation is meaningful.
    const material = materials.get(p.materialId)
    const hasGrain = material?.hasGrain ?? false
    const [rawLength, rawWidth] =
      hasGrain || p.length >= p.width ? [p.length, p.width] : [p.width, p.length]
    const length = cutMm(rawLength)
    const width = cutMm(rawWidth)

    const key = [
      p.materialId,
      p.thickness,
      length,
      width,
      bandingKey(p.edgeBanding),
      genericLabel(p.label),
    ].join('|')

    const existing = groups.get(key)
    if (existing) {
      existing.quantity += 1
      existing.partIds.push(p.id)
      existing.bandingMetres = mm(existing.bandingMetres + bandingMetres(p))
      existing.areaM2 += (length * width) / 1_000_000
      continue
    }

    groups.set(key, {
      key,
      label: genericLabel(p.label),
      role: p.role,
      materialId: p.materialId,
      materialName: material?.name ?? p.materialId,
      thickness: p.thickness,
      length,
      width,
      quantity: 1,
      partIds: [p.id],
      bandingMetres: mm(bandingMetres(p)),
      bandedEdges:
        Number(p.edgeBanding.alongLength[0]) +
        Number(p.edgeBanding.alongLength[1]) +
        Number(p.edgeBanding.alongWidth[0]) +
        Number(p.edgeBanding.alongWidth[1]),
      areaM2: (length * width) / 1_000_000,
      supplied: material?.supplied ?? false,
    })
  }

  const rows = [...groups.values()].sort(
    (a, b) =>
      b.thickness - a.thickness ||
      a.materialName.localeCompare(b.materialName) ||
      b.length * b.width - a.length * a.width,
  )

  const byMaterialMap = new Map<string, BomSummary['byMaterial'][number]>()
  for (const row of rows) {
    const material = materials.get(row.materialId)
    const sheetArea = material
      ? (material.sheet.length * material.sheet.width) / 1_000_000
      : 0
    const entry = byMaterialMap.get(row.materialId) ?? {
      materialId: row.materialId,
      materialName: row.materialName,
      thickness: row.thickness,
      parts: 0,
      areaM2: 0,
      minSheets: 0,
      supplied: row.supplied,
    }
    entry.parts += row.quantity
    entry.areaM2 += row.areaM2
    // A supplied material has no sheet count — you buy the piece, not a sheet.
    entry.minSheets =
      !row.supplied && sheetArea > 0 ? Math.ceil(entry.areaM2 / sheetArea) : 0
    byMaterialMap.set(row.materialId, entry)
  }

  return {
    rows,
    totalParts: rows.reduce((sum, r) => sum + r.quantity, 0),
    totalAreaM2: rows.reduce((sum, r) => sum + r.areaM2, 0),
    totalBandingMetres: rows.reduce((sum, r) => sum + r.bandingMetres, 0),
    byMaterial: [...byMaterialMap.values()].sort((a, b) => b.thickness - a.thickness),
  }
}
