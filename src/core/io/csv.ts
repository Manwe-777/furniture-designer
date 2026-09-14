import type { BomRow } from '../bom'
import type { Sheet } from '../nest/types'

function escape(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const toCsv = (header: string[], rows: (string | number)[][]): string =>
  [header, ...rows].map((row) => row.map(escape).join(',')).join('\n')

/** One line per distinct part, with a quantity — the list you take to the saw. */
export function bomToCsv(rows: BomRow[]): string {
  return toCsv(
    ['Part', 'Material', 'Thickness (mm)', 'Length (mm)', 'Width (mm)', 'Qty', 'Banded edges', 'Banding (m)'],
    rows.map((r) => [
      r.label,
      r.materialName,
      r.thickness,
      r.length,
      r.width,
      r.quantity,
      r.bandedEdges,
      r.bandingMetres.toFixed(2),
    ]),
  )
}

/** One line per placed piece, with where it sits on which sheet. */
export function cutPlanToCsv(sheets: Sheet[]): string {
  return toCsv(
    ['Sheet', 'Material', 'Part', 'X (mm)', 'Y (mm)', 'Width (mm)', 'Height (mm)', 'Rotated'],
    sheets.flatMap((sheet) =>
      sheet.placements.map((p) => [
        sheet.index + 1,
        sheet.materialName,
        p.label,
        p.x,
        p.y,
        p.w,
        p.h,
        p.rotated ? 'yes' : 'no',
      ]),
    ),
  )
}
