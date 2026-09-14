import type {
  Cabinet,
  CellNode,
  DoorContent,
  DrawersContent,
  ShelvesContent,
  Size,
  SplitNode,
  Worktop,
} from '../../core/types'
import { DEFAULT_HOLE_GRID, NO_OMISSIONS, fixed, flex } from '../../core/types'
import { spanSlack } from '../../core/build/span'
import { CheckField, NumberField, SelectField, TextField } from '../components/Field'
import { selectActiveCabinet, selectActiveNode, useStore } from '../../state/store'

export function Inspector() {
  const cabinet = useStore(selectActiveCabinet)
  const worktop = useStore((s) => s.design.worktops.find((w) => w.id === s.selection.worktopId))
  const partId = useStore((s) => s.selection.partId)
  const part = useStore((s) => s.build.parts.find((p) => p.id === partId))

  return (
    <div className="inspector">
      {part && <PartReadout partId={part.id} />}
      {worktop && <WorktopFields worktop={worktop} />}
      {cabinet && !worktop && (
        <>
          <NodeFields />
          <CabinetFields cabinet={cabinet} />
        </>
      )}
      {!cabinet && !worktop && <p className="muted">Nothing selected.</p>}
    </div>
  )
}

function PartReadout({ partId }: { partId: string }) {
  const part = useStore((s) => s.build.parts.find((p) => p.id === partId))
  const material = useStore((s) => s.design.materials.find((m) => m.id === part?.materialId))
  if (!part) return null

  const banded =
    Number(part.edgeBanding.alongLength[0]) +
    Number(part.edgeBanding.alongLength[1]) +
    Number(part.edgeBanding.alongWidth[0]) +
    Number(part.edgeBanding.alongWidth[1])

  return (
    <section className="inspector-section highlight">
      <h3>{part.label}</h3>
      <dl className="readout">
        <div>
          <dt>Cut size</dt>
          <dd className="mono strong">
            {part.length} × {part.width} × {part.thickness} mm
          </dd>
        </div>
        <div>
          <dt>Material</dt>
          <dd>{material?.name ?? part.materialId}</dd>
        </div>
        <div>
          <dt>Banded edges</dt>
          <dd>{banded === 0 ? 'none' : `${banded}`}</dd>
        </div>
        <div>
          <dt>Grain</dt>
          <dd>{material?.hasGrain ? 'along length' : 'no grain'}</dd>
        </div>
      </dl>
    </section>
  )
}

function NodeFields() {
  const node = useStore(selectActiveNode)
  if (!node) return null
  return node.kind === 'split' ? <SplitFields node={node} /> : <CellFields node={node} />
}

function SplitFields({ node }: { node: SplitNode }) {
  const cabinet = useStore(selectActiveCabinet)!
  const region = useStore((s) =>
    s.build.regions.find((r) => r.nodeId === node.id && r.cabinetId === cabinet.id),
  )
  const setChildSize = useStore((s) => s.setChildSize)
  const setDividerThickness = useStore((s) => s.setDividerThickness)
  const select = useStore((s) => s.select)

  const span = region
    ? node.dir === 'v'
      ? region.region.x1 - region.region.x0
      : region.region.y1 - region.region.y0
    : 0
  const slack = spanSlack(node.sizes, span, node.dividerThickness)
  const label = node.dir === 'v' ? 'Column' : 'Row'

  return (
    <section className="inspector-section">
      <h3>
        {node.children.length} {node.dir === 'v' ? 'columns' : 'rows'}
      </h3>
      <NumberField
        label="Divider thickness"
        value={node.dividerThickness}
        min={1}
        onChange={(v) => setDividerThickness(cabinet.id, node.id, v)}
      />
      <p className={`slack ${slack < 0 ? 'error' : ''}`}>
        {span > 0 && (
          <>
            {span}mm span − {node.children.length - 1} divider(s) ={' '}
            <strong>{slack < 0 ? `${slack}mm short` : `${slack}mm to share`}</strong>
          </>
        )}
      </p>

      <div className="size-list">
        {node.sizes.map((size, index) => (
          <SizeRow
            key={node.children[index]?.id ?? index}
            label={`${label} ${index + 1}`}
            size={size}
            fallback={span / node.children.length}
            onChange={(next) => setChildSize(cabinet.id, node.id, index, next)}
            onSelect={() =>
              select({ cabinetId: cabinet.id, nodeId: node.children[index]?.id })
            }
          />
        ))}
      </div>
    </section>
  )
}

/**
 * One child's share of a split. "Fill" children absorb whatever is left, which is
 * what makes a cabinet resizable without re-entering every number.
 */
function SizeRow({
  label,
  size,
  fallback,
  onChange,
  onSelect,
}: {
  label: string
  size: Size
  fallback: number
  onChange: (size: Size) => void
  onSelect?: () => void
}) {
  return (
    <div className="size-row">
      <button type="button" className="link" onClick={onSelect} disabled={!onSelect}>
        {label}
      </button>
      <div className="segmented">
        <button
          type="button"
          className={size.mode === 'fixed' ? 'active' : ''}
          onClick={() => onChange(fixed(size.mode === 'fixed' ? size.mm : Math.round(fallback)))}
        >
          Fixed
        </button>
        <button
          type="button"
          className={size.mode === 'flex' ? 'active' : ''}
          onClick={() => onChange(flex(1))}
        >
          Fill
        </button>
      </div>
      {size.mode === 'fixed' ? (
        <NumberField label="" value={size.mm} min={1} onChange={(v) => onChange(fixed(v))} />
      ) : (
        <NumberField
          label=""
          value={size.weight}
          min={0}
          step={0.5}
          suffix="×"
          onChange={(v) => onChange(flex(v))}
        />
      )}
    </div>
  )
}

function CellFields({ node }: { node: CellNode }) {
  const cabinet = useStore(selectActiveCabinet)!
  const setContent = useStore((s) => s.setContent)
  const update = (patch: object) =>
    setContent(cabinet.id, node.id, { ...node.content, ...patch } as never)

  switch (node.content.type) {
    case 'empty':
      return (
        <section className="inspector-section">
          <h3>Open space</h3>
          <p className="muted">Divide it, or fill it with shelves, drawers or a door.</p>
        </section>
      )
    case 'shelves':
      return <ShelfFields content={node.content} update={update} />
    case 'drawers':
      return <DrawerFields content={node.content} update={update} />
    case 'door':
      return <DoorFields content={node.content} update={update} />
  }
}

function ShelfFields({
  content,
  update,
}: {
  content: ShelvesContent
  update: (patch: object) => void
}) {
  const materials = useStore((s) => s.design.materials)
  return (
    <section className="inspector-section">
      <h3>Shelves</h3>
      <NumberField
        label="Number of shelves"
        value={content.count}
        min={0}
        max={40}
        suffix=""
        onChange={(v) => update({ count: v, positions: undefined })}
      />
      <NumberField
        label="Front setback"
        value={content.setback}
        min={0}
        hint="How far the shelf front stops short of the cabinet front"
        onChange={(v) => update({ setback: v })}
      />
      <SelectField
        label="Material"
        value={content.materialId ?? ''}
        options={[{ value: '', label: 'Same as cabinet' }, ...materials.map((m) => ({ value: m.id, label: m.name }))]}
        onChange={(v) => update({ materialId: v || undefined })}
      />
      <CheckField
        label="Fixed (housed into the sides)"
        checked={content.fixed}
        hint="Fixed shelves are glued or screwed in; adjustable ones sit on pins and are counted in the hardware list"
        onChange={(v) => update({ fixed: v })}
      />
      {content.positions && (
        <button type="button" className="link" onClick={() => update({ positions: undefined })}>
          Reset to equal spacing
        </button>
      )}
    </section>
  )
}

function DrawerFields({
  content,
  update,
}: {
  content: DrawersContent
  update: (patch: object) => void
}) {
  return (
    <section className="inspector-section">
      <h3>Drawers</h3>
      <NumberField
        label="Number of drawers"
        value={content.count}
        min={1}
        max={12}
        suffix=""
        onChange={(v) =>
          update({
            count: v,
            heights: Array.from({ length: v }, (_, i) => content.heights[i] ?? flex(1)),
          })
        }
      />
      <NumberField
        label="Slide clearance"
        value={content.slideClearance}
        min={0}
        step={0.1}
        hint="Per side. 12.7mm is standard for ball-bearing runners"
        onChange={(v) => update({ slideClearance: v })}
      />
      <NumberField
        label="Gap around faces"
        value={content.gap}
        min={0}
        step={0.5}
        onChange={(v) => update({ gap: v })}
      />
      <NumberField
        label="Box height reduction"
        value={content.boxHeightReduction}
        min={0}
        hint="How much shorter the drawer box is than its face"
        onChange={(v) => update({ boxHeightReduction: v })}
      />
      <NumberField
        label="Back clearance"
        value={content.boxBackClearance}
        min={0}
        hint="Gap between the back of the box and the cabinet back"
        onChange={(v) => update({ boxBackClearance: v })}
      />

      <div className="size-list">
        {content.heights.slice(0, content.count).map((size, index) => (
          <SizeRow
            key={index}
            label={`Drawer ${index + 1}`}
            size={size}
            fallback={150}
            onChange={(next) => {
              const heights = [...content.heights]
              heights[index] = next
              update({ heights })
            }}
          />
        ))}
      </div>
    </section>
  )
}

function DoorFields({
  content,
  update,
}: {
  content: DoorContent
  update: (patch: object) => void
}) {
  return (
    <section className="inspector-section">
      <h3>Door</h3>
      <SelectField
        label="Hinge side"
        value={content.hinge}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ]}
        onChange={(v) => update({ hinge: v })}
      />
      <NumberField
        label="Gap"
        value={content.gap}
        min={0}
        step={0.5}
        onChange={(v) => update({ gap: v })}
      />
    </section>
  )
}

function CabinetFields({ cabinet }: { cabinet: Cabinet }) {
  const update = useStore((s) => s.updateCabinet)
  const materials = useStore((s) => s.design.materials)
  const set = (patch: Partial<Cabinet>) => update(cabinet.id, patch)

  return (
    <section className="inspector-section">
      <h3>Cabinet</h3>
      <TextField label="Name" value={cabinet.name} onChange={(v) => set({ name: v })} />
      <div className="field-row">
        <NumberField label="Width" value={cabinet.width} min={50} onChange={(v) => set({ width: v })} />
        <NumberField label="Height" value={cabinet.height} min={50} onChange={(v) => set({ height: v })} />
        <NumberField label="Depth" value={cabinet.depth} min={50} onChange={(v) => set({ depth: v })} />
      </div>

      <SelectField
        label="Material"
        value={cabinet.materialId}
        options={materials.map((m) => ({ value: m.id, label: m.name }))}
        onChange={(v) => set({ materialId: v })}
      />
      <SelectField
        label="Carcass joint"
        value={cabinet.carcass}
        hint="Which panel runs through the corner — it decides whether the sides or the top and bottom are cut full size"
        options={[
          { value: 'sides-full', label: 'Sides run full height' },
          { value: 'topbottom-full', label: 'Top & bottom run full width' },
        ]}
        onChange={(v) => set({ carcass: v })}
      />

      <h4>Panel materials</h4>
      <p className="muted small">
        Each face can override the cabinet material — a solid timber top on an MDF
        carcass, say. Each takes its own thickness, so a 24mm top shortens the sides by
        24mm.
      </p>
      {(
        [
          ['top', 'Top'],
          ['bottom', 'Bottom'],
          ['sides', 'Sides'],
        ] as const
      ).map(([face, label]) => (
        <SelectField
          key={face}
          label={label}
          value={cabinet.panelMaterials?.[face] ?? ''}
          options={[
            { value: '', label: 'Same as cabinet' },
            ...materials.map((m) => ({ value: m.id, label: m.name })),
          ]}
          onChange={(v) =>
            set({
              panelMaterials: { ...cabinet.panelMaterials, [face]: v || undefined },
            })
          }
        />
      ))}

      <h4>Panels</h4>
      <p className="muted small">
        Untick a face this module shares with the one beside it. The panel is left out
        of the cut list and the remaining panels grow to meet the neighbour's.
      </p>
      <div className="panel-toggles">
        {(
          [
            ['left', 'Left side'],
            ['right', 'Right side'],
            ['top', 'Top'],
            ['bottom', 'Bottom'],
          ] as const
        ).map(([face, label]) => {
          const omit = cabinet.omit ?? NO_OMISSIONS
          return (
            <CheckField
              key={face}
              label={label}
              checked={!omit[face]}
              onChange={(present) => set({ omit: { ...omit, [face]: !present } })}
            />
          )
        })}
      </div>

      <h4>Shelf pin holes</h4>
      <CheckField
        label="Put shelves on a 32mm grid"
        checked={!!cabinet.holeGrid?.enabled}
        hint="The open cabinetmaking standard. Every shelf lands on the same hole pattern, so one drilling jig does every panel and the shelves stay adjustable."
        onChange={(v) =>
          set({ holeGrid: { ...(cabinet.holeGrid ?? DEFAULT_HOLE_GRID), enabled: v } })
        }
      />
      {cabinet.holeGrid?.enabled && (
        <>
          <div className="field-row">
            <NumberField
              label="Pitch"
              value={cabinet.holeGrid.pitch}
              min={1}
              onChange={(v) => set({ holeGrid: { ...cabinet.holeGrid!, pitch: v } })}
            />
            <NumberField
              label="First hole"
              value={cabinet.holeGrid.origin}
              min={0}
              hint="Height of the first hole above the inside floor"
              onChange={(v) => set({ holeGrid: { ...cabinet.holeGrid!, origin: v } })}
            />
            <NumberField
              label="Pin ⌀"
              value={cabinet.holeGrid.diameter}
              min={1}
              step={0.5}
              onChange={(v) => set({ holeGrid: { ...cabinet.holeGrid!, diameter: v } })}
            />
          </div>
          <div className="field-row">
            <NumberField
              label="Depth"
              value={cabinet.holeGrid.depth}
              min={1}
              onChange={(v) => set({ holeGrid: { ...cabinet.holeGrid!, depth: v } })}
            />
            <NumberField
              label="Front row"
              value={cabinet.holeGrid.frontSetback}
              min={0}
              hint="Distance from the front edge. 37mm is standard."
              onChange={(v) => set({ holeGrid: { ...cabinet.holeGrid!, frontSetback: v } })}
            />
            <NumberField
              label="Back row"
              value={cabinet.holeGrid.backSetback}
              min={0}
              hint="Distance from the back edge. Zero drills a single row."
              onChange={(v) => set({ holeGrid: { ...cabinet.holeGrid!, backSetback: v } })}
            />
          </div>
        </>
      )}

      <h4>Back panel</h4>
      <SelectField
        label="Style"
        value={cabinet.back.style}
        options={[
          { value: 'none', label: 'No back' },
          { value: 'overlay', label: 'Overlay (screwed on the outside)' },
          { value: 'inset', label: 'Inset (inside the carcass)' },
          { value: 'rebate', label: 'Rebated (in a groove)' },
        ]}
        onChange={(v) => set({ back: { ...cabinet.back, style: v } })}
      />
      {cabinet.back.style !== 'none' && (
        <>
          <SelectField
            label="Back material"
            value={cabinet.back.materialId ?? ''}
            options={[
              { value: '', label: 'Same as cabinet' },
              ...materials.map((m) => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => set({ back: { ...cabinet.back, materialId: v || undefined } })}
          />
          {cabinet.back.style === 'rebate' && (
            <NumberField
              label="Rebate depth"
              value={cabinet.back.rebateDepth}
              min={0}
              hint="How deep the groove is cut into the carcass — the back is made oversize by this much on every side"
              onChange={(v) => set({ back: { ...cabinet.back, rebateDepth: v } })}
            />
          )}
        </>
      )}

      <h4>Plinth</h4>
      <CheckField
        label="Raise on a plinth"
        checked={!!cabinet.plinth}
        onChange={(v) => set({ plinth: v ? { height: 100, setback: 50 } : undefined })}
      />
      {cabinet.plinth && (
        <div className="field-row">
          <NumberField
            label="Height"
            value={cabinet.plinth.height}
            min={10}
            onChange={(v) => set({ plinth: { ...cabinet.plinth!, height: v } })}
          />
          <NumberField
            label="Setback"
            value={cabinet.plinth.setback}
            min={0}
            onChange={(v) => set({ plinth: { ...cabinet.plinth!, setback: v } })}
          />
        </div>
      )}

      <h4>Edge banding</h4>
      <CheckField
        label="Band the front edges"
        checked={cabinet.banding.enabled}
        onChange={(v) => set({ banding: { ...cabinet.banding, enabled: v } })}
      />
      {cabinet.banding.enabled && (
        <>
          <NumberField
            label="Banding thickness"
            value={cabinet.banding.thickness}
            min={0}
            step={0.1}
            onChange={(v) => set({ banding: { ...cabinet.banding, thickness: v } })}
          />
          <CheckField
            label="Cut parts undersize to compensate"
            checked={cabinet.banding.compensate}
            hint="Subtracts the banding thickness from the cut size so the finished panel lands on its nominal dimension"
            onChange={(v) => set({ banding: { ...cabinet.banding, compensate: v } })}
          />
        </>
      )}

      <h4>Position</h4>
      <div className="field-row">
        <NumberField
          label="X"
          value={cabinet.transform.x}
          onChange={(v) => set({ transform: { ...cabinet.transform, x: v } })}
        />
        <NumberField
          label="Y"
          value={cabinet.transform.y}
          onChange={(v) => set({ transform: { ...cabinet.transform, y: v } })}
        />
        <NumberField
          label="Z"
          value={cabinet.transform.z}
          onChange={(v) => set({ transform: { ...cabinet.transform, z: v } })}
        />
      </div>
      <SelectField
        label="Rotation"
        value={String(cabinet.transform.rotY)}
        options={[
          { value: '0', label: '0°' },
          { value: '90', label: '90°' },
          { value: '180', label: '180°' },
          { value: '270', label: '270°' },
        ]}
        onChange={(v) =>
          set({ transform: { ...cabinet.transform, rotY: Number(v) as 0 | 90 | 180 | 270 } })
        }
      />
    </section>
  )
}

function WorktopFields({ worktop }: { worktop: Worktop }) {
  const update = useStore((s) => s.updateWorktop)
  const materials = useStore((s) => s.design.materials)
  const set = (patch: Partial<Worktop>) => update(worktop.id, patch)

  return (
    <section className="inspector-section">
      <h3>Worktop</h3>
      <TextField label="Name" value={worktop.name} onChange={(v) => set({ name: v })} />
      <SelectField
        label="Shape"
        value={worktop.shape}
        options={[
          { value: 'rect', label: 'Rectangle' },
          { value: 'L', label: 'L-shape' },
        ]}
        onChange={(v) => set({ shape: v })}
      />
      <SelectField
        label="Material"
        value={worktop.materialId}
        options={materials.map((m) => ({ value: m.id, label: m.name }))}
        onChange={(v) => set({ materialId: v })}
      />

      <h4>{worktop.shape === 'L' ? 'Leg A (runs along X)' : 'Size'}</h4>
      <div className="field-row">
        <NumberField
          label="Length"
          value={worktop.a.length}
          min={50}
          onChange={(v) => set({ a: { ...worktop.a, length: v } })}
        />
        <NumberField
          label="Depth"
          value={worktop.a.depth}
          min={50}
          onChange={(v) => set({ a: { ...worktop.a, depth: v } })}
        />
      </div>

      {worktop.shape === 'L' && (
        <>
          <h4>Leg B (runs along Z)</h4>
          <div className="field-row">
            <NumberField
              label="Length"
              value={worktop.b.length}
              min={50}
              onChange={(v) => set({ b: { ...worktop.b, length: v } })}
            />
            <NumberField
              label="Depth"
              value={worktop.b.depth}
              min={50}
              onChange={(v) => set({ b: { ...worktop.b, depth: v } })}
            />
          </div>
          <SelectField
            label="Seam"
            value={worktop.seam}
            hint="Which leg is cut as the full piece through the corner. The other leg is the remainder — both stay rectangular so they can be nested and cut on a saw."
            options={[
              { value: 'a', label: 'Leg A takes the corner' },
              { value: 'b', label: 'Leg B takes the corner' },
            ]}
            onChange={(v) => set({ seam: v })}
          />
        </>
      )}

      <h4>Position</h4>
      <div className="field-row">
        <NumberField
          label="X"
          value={worktop.transform.x}
          onChange={(v) => set({ transform: { ...worktop.transform, x: v } })}
        />
        <NumberField
          label="Y"
          value={worktop.transform.y}
          onChange={(v) => set({ transform: { ...worktop.transform, y: v } })}
        />
        <NumberField
          label="Z"
          value={worktop.transform.z}
          onChange={(v) => set({ transform: { ...worktop.transform, z: v } })}
        />
      </div>
      <SelectField
        label="Rotation"
        value={String(worktop.transform.rotY)}
        options={[
          { value: '0', label: '0°' },
          { value: '90', label: '90°' },
          { value: '180', label: '180°' },
          { value: '270', label: '270°' },
        ]}
        onChange={(v) =>
          set({ transform: { ...worktop.transform, rotY: Number(v) as 0 | 90 | 180 | 270 } })
        }
      />
    </section>
  )
}
