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
    // Their rule is one format per PIECE, not per order, and banding is set per
    // cabinet here — so every piece already has exactly one. Different tape on the
    // desk than on the shelving is perfectly legal; you just have to buy both.
    out.push({
      severity: 'warning',
      message: `Two banding formats in this order (${[...thicknesses].join('mm and ')}mm) — legal, since the one-format rule is per piece, but order both.`,
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

/**
 * One block of the order — a material and its rows, in the shop's column layout.
 *
 * Built once and rendered either as a worksheet or as CSV, so the two exports cannot
 * drift apart. The CSV exists so the rows can be pasted straight into the shop's own
 * template from a spreadsheet.
 */
export interface OrderBlock {
  title: string
  rows: CellValue[][]
  columnWidths?: number[]
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

/** One block per material actually cut from sheets, plus the supplied parts. */
export function cutOrderBlocks(design: Design, bom: BomSummary): OrderBlock[] {
  const blocks: OrderBlock[] = design.materials
    .filter((m) => !m.supplied && bom.rows.some((r) => r.materialId === m.id))
    .map((m) => {
      const sheet = materialSheet(design, bom, m)
      return { title: sheet.name, rows: sheet.rows, columnWidths: sheet.columnWidths }
    })

  const supplied = bom.rows.filter((r) => r.supplied)
  if (supplied.length > 0) {
    // Listed, but clearly apart from the order — these are bought to size elsewhere
    // and must not reach the saw.
    blocks.push({
      title: 'NO CORTAR (provisto)',
      rows: [
        ['PIEZAS PROVISTAS — NO INCLUIR EN EL CORTE'],
        [],
        ['Cant', '1° med', '2° med', 'Material', 'Descripción'],
        ...supplied.map((r) => [r.quantity, r.length, r.width, r.materialName, r.label]),
      ],
      columnWidths: [6, 12, 12, 22, 30],
    })
  }

  return blocks
}

/** One worksheet per block. */
export function buildCutOrder(design: Design, bom: BomSummary): Blob {
  return buildXlsx(
    cutOrderBlocks(design, bom).map((b) => ({
      name: b.title,
      rows: b.rows,
      columnWidths: b.columnWidths,
    })),
  )
}

/**
 * The same order as CSV — identical columns, so it can be opened in a spreadsheet
 * and pasted into the shop's template without rearranging anything. Blocks are
 * separated by a blank line, since a CSV has no tabs.
 */
export function cutOrderToCsv(design: Design, bom: BomSummary): string {
  const escape = (v: CellValue): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  return cutOrderBlocks(design, bom)
    .map((block) => block.rows.map((row) => row.map(escape).join(',')).join('\n'))
    .join('\n\n')
}
