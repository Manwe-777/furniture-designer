import type { BomSummary } from '../bom'
import type { Design, Material } from '../types'
import { buildXlsx, type CellValue, type Sheet } from './xlsx'

/**
 * The cutting order in the layout the board shop asks for.
 *
 * Columns follow the Placas Bariloche "LISTADO DE CORTE" sheet, which maps onto the
 * app's model exactly: their "1° med (sentido veta)" is our grain-direction `length`,
 * and their four tapacanto columns are our four per-edge banding flags. One worksheet
 * per material, because their form has a single MATERIAL field.
 *
 * Their rules, which the checks below enforce:
 *  - minimum piece the machine can cut: 70mm
 *  - minimum piece it can edge-band: 150mm
 *  - one banding format per piece
 *  - sizes are FINAL, banding included — the shop does the compensation
 */
export const CUT_MIN = 70
export const BAND_MIN = 150

export interface OrderWarning {
  severity: 'error' | 'warning'
  message: string
}

const MARK = 'X'

export function cutOrderWarnings(design: Design, bom: BomSummary): OrderWarning[] {
  const out: OrderWarning[] = []

  // The shop treats the size you give as the finished size with banding on, so
  // compensating here as well makes every banded part a banding-thickness undersize.
  const compensating = design.cabinets.filter(
    (c) => c.banding.enabled && c.banding.compensate,
  )
  const worktops = design.worktops.filter((w) => w.banding.enabled && w.banding.compensate)
  if (compensating.length || worktops.length) {
    out.push({
      severity: 'error',
      message: `The shop applies banding to the size you give, so cut-size compensation must be off. Still on for: ${[
        ...compensating.map((c) => c.name),
        ...worktops.map((w) => w.name),
      ].join(', ')}.`,
    })
  }

  const thicknesses = new Set(
    [
      ...design.cabinets.filter((c) => c.banding.enabled).map((c) => c.banding.thickness),
      ...design.worktops.filter((w) => w.banding.enabled).map((w) => w.banding.thickness),
    ].filter(Boolean),
  )
  if (thicknesses.size > 1) {
    out.push({
      severity: 'warning',
      message: `Only one banding format per piece is allowed, and this design uses ${[...thicknesses].join('mm, ')}mm.`,
    })
  }

  for (const row of bom.rows) {
    if (row.supplied) continue
    if (row.length < CUT_MIN || row.width < CUT_MIN) {
      out.push({
        severity: 'error',
        message: `${row.label} is ${row.length} × ${row.width}mm — below the ${CUT_MIN}mm the machine can cut.`,
      })
    }
    if (row.bandedEdges > 0 && (row.length < BAND_MIN || row.width < BAND_MIN)) {
      out.push({
        severity: 'warning',
        message: `${row.label} is ${row.length} × ${row.width}mm — below the ${BAND_MIN}mm needed to machine-band it.`,
      })
    }
  }

  return out
}

function materialSheet(
  design: Design,
  bom: BomSummary,
  material: Material,
): Sheet {
  const rows = bom.rows.filter((r) => r.materialId === material.id)
  const banding = design.cabinets.find((c) => c.banding.enabled)?.banding.thickness ?? 0

  const head: CellValue[][] = [
    ['LISTADO DE CORTE'],
    ['CLIENTE:', design.name],
    ['MATERIAL:', `${material.name} (${material.thickness}mm)`],
    ['PLACA:', `${material.sheet.length} x ${material.sheet.width} mm`],
    [],
    [
      'Cant',
      '1° med (sentido veta)',
      '2° med',
      'ESPESOR CANTO',
      '1° MED A',
      '1° MED B',
      '2° MED A',
      '2° MED B',
      'Observaciones',
    ],
  ]

  const body: CellValue[][] = rows.map((r) => {
    const b = r.edgeBanding
    return [
      r.quantity,
      r.length,
      r.width,
      r.bandedEdges > 0 ? banding : '',
      b.alongLength[0] ? MARK : '',
      b.alongLength[1] ? MARK : '',
      b.alongWidth[0] ? MARK : '',
      b.alongWidth[1] ? MARK : '',
      r.label,
    ]
  })

  const totalPieces = rows.reduce((sum, r) => sum + r.quantity, 0)
  const foot: CellValue[][] = [
    [],
    ['TOTAL PIEZAS', totalPieces],
    [
      'Nota',
      'Medidas finales con canto incluido. Sentido de veta en la 1° medida.',
    ],
  ]

  return {
    name: material.name.slice(0, 31),
    rows: [...head, ...body, ...foot],
    columnWidths: [6, 22, 10, 14, 10, 10, 10, 10, 30],
  }
}

/** One worksheet per material actually cut from sheets. */
export function buildCutOrder(design: Design, bom: BomSummary): Blob {
  const sheets = design.materials
    .filter((m) => !m.supplied && bom.rows.some((r) => r.materialId === m.id))
    .map((m) => materialSheet(design, bom, m))

  const supplied = bom.rows.filter((r) => r.supplied)
  if (supplied.length > 0) {
    // Listed, but on their own tab and clearly not part of the order — these are
    // bought to size elsewhere and must not reach the saw.
    sheets.push({
      name: 'NO CORTAR (provisto)',
      rows: [
        ['PIEZAS PROVISTAS — NO INCLUIR EN EL CORTE'],
        [],
        ['Cant', '1° med', '2° med', 'Material', 'Descripción'],
        ...supplied.map((r) => [r.quantity, r.length, r.width, r.materialName, r.label]),
      ],
      columnWidths: [6, 12, 12, 22, 30],
    })
  }

  return buildXlsx(sheets)
}
