import type { Sheet } from '../../core/nest/types'

/**
 * One sheet, drawn to scale and printable.
 *
 * Cut lines are drawn as dashes over the layout so you can follow the guillotine
 * sequence: every line runs edge to edge across the region it divides, which is
 * exactly what a track saw or panel saw can do.
 */
export function SheetSvg({
  sheet,
  showCuts,
  highlightPartId,
  onSelectPart,
}: {
  sheet: Sheet
  showCuts: boolean
  highlightPartId?: string
  onSelectPart?: (partId: string) => void
}) {
  const margin = 40
  const viewW = sheet.sheetLength + margin * 2
  const viewH = sheet.sheetWidth + margin * 2

  return (
    <svg
      className="sheet-svg"
      style={{ ['--sheet-aspect' as string]: `${viewW} / ${viewH}` }}
      viewBox={`${-margin} ${-margin} ${viewW} ${viewH}`}
      role="img"
      aria-label={`Sheet ${sheet.index + 1} layout`}
    >
      {/* the raw sheet */}
      <rect x={0} y={0} width={sheet.sheetLength} height={sheet.sheetWidth} className="sheet-blank" />
      {/* usable area after trimming the edges */}
      <rect
        x={sheet.trim}
        y={sheet.trim}
        width={sheet.sheetLength - 2 * sheet.trim}
        height={sheet.sheetWidth - 2 * sheet.trim}
        className="sheet-usable"
      />

      {sheet.freeRects.map((rect, i) => (
        <rect
          key={`free${i}`}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          className="sheet-offcut"
        />
      ))}

      {sheet.placements.map((p) => {
        const isHighlighted = p.partId === highlightPartId
        const dims = `${p.w} × ${p.h}`
        const cx = p.x + p.w / 2
        const cy = p.y + p.h / 2

        // The cut size always gets drawn — it is the number you need at the saw.
        // The name and the rotation note only appear if they genuinely fit, so a
        // printed sheet never has labels spilling across their neighbours.
        const dimFont = fitFont(dims, p.w, p.h / 2.6, 46)
        const label = truncate(p.label, 30)
        const labelFont = fitFont(label, p.w, p.h / 3.4, 40)
        const showLabel = labelFont >= 11 && p.h > dimFont + labelFont * 1.6
        const showRotated =
          p.rotated && p.h > dimFont + (showLabel ? labelFont : 0) + dimFont * 1.6

        return (
          <g
            key={p.partId}
            className={`placement${isHighlighted ? ' highlighted' : ''}`}
            onClick={() => onSelectPart?.(p.partId)}
          >
            <rect x={p.x} y={p.y} width={p.w} height={p.h} />
            <title>{`${p.label} — ${dims} mm${p.rotated ? ' (rotated)' : ''}`}</title>
            {showLabel && (
              <text
                x={cx}
                y={cy - dimFont * 0.75}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={labelFont}
              >
                {label}
              </text>
            )}
            <text
              x={cx}
              y={showLabel ? cy + labelFont * 0.4 : cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={dimFont}
              className="dims"
            >
              {dims}
            </text>
            {showRotated && (
              <text
                x={cx}
                y={cy + (showLabel ? labelFont * 0.4 : 0) + dimFont * 1.3}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={dimFont * 0.8}
                className="rotated-note"
              >
                rotated
              </text>
            )}
          </g>
        )
      })}

      {showCuts &&
        sheet.cuts.map((cut, i) => (
          <line
            key={`cut${i}`}
            x1={cut.dir === 'v' ? cut.pos : cut.from}
            y1={cut.dir === 'v' ? cut.from : cut.pos}
            x2={cut.dir === 'v' ? cut.pos : cut.to}
            y2={cut.dir === 'v' ? cut.to : cut.pos}
            className={`cut-line depth-${Math.min(cut.depth, 3)}`}
          />
        ))}

      {/* sheet dimensions */}
      <text x={sheet.sheetLength / 2} y={-12} textAnchor="middle" className="sheet-dim">
        {sheet.sheetLength} mm
      </text>
      <text
        x={-14}
        y={sheet.sheetWidth / 2}
        textAnchor="middle"
        className="sheet-dim"
        transform={`rotate(-90 ${-14} ${sheet.sheetWidth / 2})`}
      >
        {sheet.sheetWidth} mm
      </text>
    </svg>
  )
}

/** Largest font size at which `text` fits inside a box, in SVG user units. */
function fitFont(text: string, maxWidth: number, maxHeight: number, cap: number): number {
  // Monospace digits sit at roughly 0.6em wide; the 0.9 keeps a little padding.
  const byWidth = (maxWidth * 0.9) / Math.max(1, text.length * 0.6)
  return Math.min(cap, byWidth, maxHeight)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
