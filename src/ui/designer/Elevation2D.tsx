import { useMemo, useState } from 'react'
import type { NodeRegion } from '../../core/build/buildCabinet'
import type { Cabinet, Part } from '../../core/types'
import { useStore } from '../../state/store'
import { describeNode, findNode } from '../../state/tree'
import { CellActions } from './CellActions'

const PADDING = 60

/**
 * Front elevation of one cabinet, drawn straight from the generated parts.
 *
 * This is the editing surface: you click a cell and act on it. Direct manipulation in
 * 3D looks impressive but makes hitting an exact millimetre hard and interior parts
 * hard to even select, so the numbers live here and in the inspector instead.
 */
export function Elevation2D() {
  const parts = useStore((s) => s.build.parts)
  const regions = useStore((s) => s.build.regions)
  const materials = useStore((s) => s.design.materials)
  const cabinets = useStore((s) => s.design.cabinets)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const showDimensions = useStore((s) => s.showDimensions)
  const [hovered, setHovered] = useState<string | null>(null)

  const cabinet = cabinets.find((c) => c.id === selection.cabinetId)

  const cabinetParts = useMemo(
    () =>
      parts
        .filter((p) => p.cabinetId === cabinet?.id)
        // Draw back to front so doors and drawer faces land on top.
        .sort((a, b) => a.box.pos[2] - b.box.pos[2]),
    [parts, cabinet?.id],
  )

  const cellRegions = useMemo(
    () => regions.filter((r) => r.cabinetId === cabinet?.id && r.kind === 'cell'),
    [regions, cabinet?.id],
  )

  if (!cabinet) {
    return (
      <div className="elevation empty-state">
        <p>Select a cabinet to edit it, or add one from the list.</p>
      </div>
    )
  }

  const colors = new Map(materials.map((m) => [m.id, m.color]))
  const viewW = cabinet.width + PADDING * 2
  const viewH = cabinet.height + PADDING * 2

  // The cabinet's local origin is bottom-left, but SVG's Y runs downwards, so
  // everything is drawn through one flip instead of inverting every coordinate.
  const flip = (y: number, h: number) => cabinet.height - y - h

  return (
    <div className="elevation">
      <div className="panel-header">
        <h2>{cabinet.name} — front elevation</h2>
        <span className="muted">
          {cabinet.width} × {cabinet.height} × {cabinet.depth} mm
        </span>
      </div>

      <div className="elevation-canvas">
        <svg viewBox={`${-PADDING} ${-PADDING} ${viewW} ${viewH}`} role="img">
          <rect
            x={-PADDING}
            y={-PADDING}
            width={viewW}
            height={viewH}
            className="elevation-bg"
            onClick={() => select({ cabinetId: cabinet.id, nodeId: cabinet.root.id })}
          />

          {cabinetParts.map((part) => (
            <PartRect key={part.id} part={part} flip={flip} color={colors.get(part.materialId)} />
          ))}

          {cellRegions.map((region) => (
            <CellRect
              key={region.nodeId}
              region={region}
              cabinet={cabinet}
              flip={flip}
              selected={selection.nodeId === region.nodeId}
              hovered={hovered === region.nodeId}
              onHover={setHovered}
              onSelect={() => select({ cabinetId: cabinet.id, nodeId: region.nodeId })}
            />
          ))}

          {showDimensions && <Dimensions cabinet={cabinet} />}
        </svg>
      </div>

      <CellActions />
    </div>
  )
}

function PartRect({
  part,
  flip,
  color,
}: {
  part: Part
  flip: (y: number, h: number) => number
  color?: string
}) {
  const [x, y] = part.box.pos
  const [w, h] = part.box.size
  const selectPart = useStore((s) => s.selectPart)
  return (
    <rect
      x={x}
      y={flip(y, h)}
      width={w}
      height={h}
      fill={color ?? '#c9a87c'}
      stroke="#2b3138"
      strokeWidth={1.5}
      onClick={(event) => {
        // Let the click reach the cell underneath unless it lands on a real panel.
        event.stopPropagation()
        selectPart(part.id)
      }}
    >
      <title>{`${part.label} — ${part.length} × ${part.width} × ${part.thickness}mm`}</title>
    </rect>
  )
}

function CellRect({
  region,
  cabinet,
  flip,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  region: NodeRegion
  cabinet: Cabinet
  flip: (y: number, h: number) => number
  selected: boolean
  hovered: boolean
  onHover: (id: string | null) => void
  onSelect: () => void
}) {
  const { x0, x1, y0, y1 } = region.region
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return null

  const node = findNode(cabinet.root, region.nodeId)
  const label = node ? describeNode(node) : ''
  const fontSize = Math.max(14, Math.min(w, h) / 8)

  return (
    <g
      className={`cell${selected ? ' selected' : ''}${hovered ? ' hovered' : ''}`}
      onPointerEnter={() => onHover(region.nodeId)}
      onPointerLeave={() => onHover(null)}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <rect x={x0} y={flip(y0, h)} width={w} height={h} className="cell-hit" />
      {(hovered || selected) && (
        <text
          x={x0 + w / 2}
          y={flip(y0, h) + h / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={fontSize}
          className="cell-label"
        >
          {label}
        </text>
      )}
    </g>
  )
}

function Dimensions({ cabinet }: { cabinet: Cabinet }) {
  const offset = 26
  const tick = 8
  return (
    <g className="dimensions">
      {/* width, below */}
      <line x1={0} y1={cabinet.height + offset} x2={cabinet.width} y2={cabinet.height + offset} />
      <line
        x1={0}
        y1={cabinet.height + offset - tick}
        x2={0}
        y2={cabinet.height + offset + tick}
      />
      <line
        x1={cabinet.width}
        y1={cabinet.height + offset - tick}
        x2={cabinet.width}
        y2={cabinet.height + offset + tick}
      />
      <text x={cabinet.width / 2} y={cabinet.height + offset - 8} textAnchor="middle">
        {cabinet.width}
      </text>

      {/* height, to the left */}
      <line x1={-offset} y1={0} x2={-offset} y2={cabinet.height} />
      <line x1={-offset - tick} y1={0} x2={-offset + tick} y2={0} />
      <line x1={-offset - tick} y1={cabinet.height} x2={-offset + tick} y2={cabinet.height} />
      <text
        x={-offset - 8}
        y={cabinet.height / 2}
        textAnchor="middle"
        transform={`rotate(-90 ${-offset - 8} ${cabinet.height / 2})`}
      >
        {cabinet.height}
      </text>
    </g>
  )
}
