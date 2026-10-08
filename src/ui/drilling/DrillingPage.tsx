import { useMemo, useState } from 'react'
import {
  buildDrilling,
  buildShelfEdges,
  countHoles,
  groupShelfEdges,
  unusedCabinets,
  type PanelDrilling,
  type ShelfEdgeHoles,
} from '../../core/holes'
import { buildJoints, countJointHoles, type PanelJoints } from '../../core/joints'
import {
  MIN_EDGE_WALL,
  confirmatJigFreecadMacro,
  confirmatJigScad,
  confirmatJigSpecs,
  edgeJigFreecadMacro,
  edgeJigScad,
  endJigFreecadMacro,
  endJigScad,
  endJigSpecs,
  jigFreecadMacro,
  jigScad,
  jigSpecs,
  shelfPinEdgeJigSpecs,
} from '../../core/jig'
import { useStore } from '../../state/store'
import { download } from '../download'

type Format = 'FCMacro' | 'scad'

/**
 * One thing to print.
 *
 * Every jig in here is generated from the design, so the list is exactly the parts
 * this project needs and nothing else. It is one flat list on purpose: split across
 * a section each, five jigs that all describe themselves as "a hole this far from a
 * fence" are impossible to tell apart, and the one number that distinguishes them
 * gets lost in the prose around it.
 */
interface Printable {
  id: string
  /** Download name, so a folder of these says what each one is. */
  file: string
  name: string
  /** The hole it makes, in the words of the job rather than of the jig. */
  drills: string
  /** The numbers that distinguish this one from the others. */
  numbers: string
  /**
   * True when every number on it comes from the 32mm system rather than from a
   * choice made for this project. Worth saying: those numbers are the same on any
   * jig you could buy, and the others are not.
   */
  standard: boolean
  /** Display names of the parts it drills, for matching a board to a jig. */
  serves: string[]
  size: { length: number; width: number; height: number }
  warning?: string
  source: (format: Format) => string
}

/**
 * The parts a jig is for, by name.
 *
 * Naming them by size — "the 299mm side panels" — is no use at the bench, because
 * nobody knows which board in the stack is 299 until they measure it. A name is
 * something you can match against the cards below and against the 3D view.
 */
function Serves({ names }: { names: string[] }) {
  const counted = names.reduce(
    (acc, n) => acc.set(n, (acc.get(n) ?? 0) + 1),
    new Map<string, number>(),
  )
  const rows = [...counted].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))

  if (rows.length <= 3) {
    return <span className="muted small">{rows.join(' · ')}</span>
  }
  return (
    <details className="serves">
      <summary className="muted small">{rows.length} parts</summary>
      <ul className="muted small">
        {rows.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  )
}

export function DrillingPage() {
  const design = useStore((s) => s.design)
  const selectPart = useStore((s) => s.selectPart)
  const setTab = useStore((s) => s.setTab)
  const [format, setFormat] = useState<Format>('FCMacro')

  const panels = useMemo(() => buildDrilling(design), [design])
  const joints = useMemo(() => buildJoints(design, panels), [design, panels])
  const counts = countHoles(panels)
  const jointCount = countJointHoles(joints)
  const without = unusedCabinets(design)
  const jigs = useMemo(() => jigSpecs(panels), [panels])
  const faceJigs = useMemo(
    () => confirmatJigSpecs(joints, design.settings.joints),
    [joints, design.settings.joints],
  )
  const cornerJigs = useMemo(
    () => endJigSpecs(joints, design.settings.joints),
    [joints, design.settings.joints],
  )

  // Shelves only need holes in their ends when the pins are meant to capture them.
  // The rows come off the side panels the shelf sits between, not from the grid, so
  // a shelf set back from the carcass front still lines up.
  const shelfEdges = useMemo(() => groupShelfEdges(buildShelfEdges(design)), [design])
  const shelfJigs = useMemo(() => shelfPinEdgeJigSpecs(shelfEdges), [shelfEdges])
  const shelfCount = shelfEdges.reduce((n, g) => n + g.count, 0)

  const printables = useMemo((): Printable[] => {
    const out: Printable[] = []

    for (const jig of jigs) {
      for (const variant of ['start', 'continue'] as const) {
        const v = jig[variant]
        out.push({
          id: `pin-${jig.panelWidth}-${variant}`,
          file: `jig-shelf-pins-${variant}-${jig.panelWidth}mm`,
          name: `Shelf pins — ${variant === 'start' ? 'start' : 'continue'}`,
          drills: 'Pin rows up the inside face',
          numbers:
            `⌀${jig.holeDiameter}mm at ${jig.frontSetback}mm from the front edge, every ` +
            `${jig.pitch}mm · ${v.positions} positions, reaches ${v.reachMm}mm` +
            (variant === 'start'
              ? ` · end stop, first hole at ${jig.firstHole}mm`
              : ' · no end stop, pins into the last hole drilled'),
          size: v.size,
          standard: true,
          serves: jig.panels,
          source: (f) =>
            f === 'scad'
              ? jigScad(jig, design.name, variant)
              : jigFreecadMacro(jig, design.name, variant),
        })
      }
    }

    for (const jig of cornerJigs) {
      out.push({
        id: `end-${jig.fromEnd}-${jig.holes.join()}`,
        file: `jig-carcass-ends-${jig.fromEnd}mm`,
        name: 'Carcass fixings — board ends',
        drills: 'Confirmats down through the board into the upright at its end',
        numbers:
          `⌀${jig.clearance}mm, ${jig.fromEnd}mm from the end, ${jig.holes.join('/')}mm from ` +
          `the front edge · end stop + fence, no marking`,
        size: jig.size,
        standard: false,
        serves: jig.panels,
        source: (f) =>
          f === 'scad' ? endJigScad(jig, design.name) : endJigFreecadMacro(jig, design.name),
      })
    }

    for (const jig of faceJigs) {
      out.push({
        id: `mid-${jig.holes.join()}`,
        file: `jig-carcass-mid-board-${jig.holes.join('-')}mm`,
        name: 'Carcass fixings — mid-board',
        drills: 'Confirmats down through the board into a divider mid-span',
        numbers:
          `⌀${jig.clearance}mm, ${jig.holes.join('/')}mm from the front edge · sight slot, ` +
          `lines up with your pencil mark`,
        size: jig.size,
        standard: false,
        serves: jig.panels,
        source: (f) =>
          f === 'scad'
            ? confirmatJigScad(jig, design.name)
            : confirmatJigFreecadMacro(jig, design.name),
      })
    }

    for (const jig of shelfJigs) {
      out.push({
        id: `shelf-${jig.panelThickness}`,
        file: `jig-shelf-ends-${jig.panelThickness}mm`,
        name: 'Shelf pins — shelf ends',
        drills: 'Pin holes in both ends',
        numbers:
          `⌀${jig.holeDiameter}mm at ${jig.holes.join('/')}mm from the front edge — the same ` +
          `setback as the side panels — centred at ${jig.panelThickness / 2}mm, ${jig.depth}mm deep`,
        size: jig.size,
        standard: true,
        serves: jig.panels,
        warning:
          jig.wall < MIN_EDGE_WALL
            ? `Only ${jig.wall}mm either side of the hole. It will break out of a ${jig.panelThickness}mm edge.`
            : undefined,
        source: (f) =>
          f === 'scad' ? edgeJigScad(jig, design.name) : edgeJigFreecadMacro(jig, design.name),
      })
    }

    return out
  }, [jigs, cornerJigs, faceJigs, shelfJigs, design.name])

  /**
   * Every board that needs drilling, by cut size, with the jigs that do it.
   *
   * This is the lookup you actually need standing over a stack of cut MDF: you do
   * not know which board is which until you have one in your hands, and then the
   * only things you know about it are two measurements. So the table is keyed on
   * those, and it answers the question you have next — which jigs, how many holes.
   */
  const boards = useMemo(() => {
    const byName = new Map<
      string,
      {
        name: string
        size: string
        sort: number
        /** A set: identical parts share a name and would each add the same line. */
        ops: Set<string>
        jigs: number[]
        count: number
      }
    >()

    const touch = (name: string, length: number, width: number, thickness: number) => {
      const found = byName.get(name)
      if (found) return found
      const row = {
        name,
        size: `${length} × ${width} × ${thickness}`,
        sort: length,
        ops: new Set<string>(),
        jigs: [] as number[],
        count: 0,
      }
      byName.set(name, row)
      return row
    }

    for (const p of panels) {
      const row = touch(`${p.cabinetName} — ${p.label}`, p.length, p.width, p.thickness)
      row.count++
      row.ops.add(`${p.holes.length} pin holes`)
    }
    for (const j of joints) {
      const row = touch(`${j.cabinetName} — ${j.label}`, j.length, j.width, j.thickness)
      if (!panels.some((p) => p.partId === j.partId)) row.count++
      const n = j.joints.reduce((sum, x) => sum + x.holes.length, 0)
      row.ops.add(`${n} carcass fixings`)
    }
    for (const g of shelfEdges) {
      const e = g.edge
      const row = touch(`${e.cabinetName} — ${e.label}`, e.length, e.width, e.thickness)
      row.count += g.count
      row.ops.add('4 pin holes in the ends')
    }

    printables.forEach((item, i) => {
      for (const name of new Set(item.serves)) {
        const row = byName.get(name)
        if (row && !row.jigs.includes(i + 1)) row.jigs.push(i + 1)
      }
    })

    return [...byName.values()].sort((a, b) => b.sort - a.sort || a.name.localeCompare(b.name))
  }, [panels, joints, shelfEdges, printables])

  const jointsByPart = useMemo(
    () => new Map(joints.map((j) => [j.partId, j])),
    [joints],
  )
  const go = (partId: string) => {
    selectPart(partId)
    setTab('designer')
  }

  return (
    <div className="page drilling-page">
      <aside className="page-side left">
        <section className="inspector-section">
          <h3>Jigs to print</h3>
          <p className="muted small">
            Everything this project needs, and nothing it does not. Each one is cut for
            the panels listed in its own header — print all {printables.length}.
          </p>
          <label className="field-inline small">
            <span className="muted">Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              <option value="FCMacro">FreeCAD macro</option>
              <option value="scad">OpenSCAD</option>
            </select>
          </label>
          {printables.length === 0 && (
            <p className="muted small">
              Nothing to print yet. Turn on “Shelf pin holes” for a cabinet in the
              designer and give it some shelves.
            </p>
          )}
          <ol className="print-list">
            {printables.map((item, i) => (
              <li key={item.id}>
                <div className="print-head">
                  <strong className="small">
                    <span className="print-num mono">{i + 1}</span>
                    {item.name}
                  </strong>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        `${item.file}.${format}`,
                        item.source(format),
                        'text/plain',
                      )
                    }
                  >
                    Download
                  </button>
                </div>
                <span className="small">{item.drills}</span>
                <Serves names={item.serves} />
                <span className="muted small">{item.numbers}</span>
                {item.warning && <span className="small warn-text">{item.warning}</span>}
                <span className="muted small mono">
                  {item.size.length} × {item.size.width} × {item.size.height} mm
                </span>
              </li>
            ))}
          </ol>
          <p className="muted small">
            <strong>FreeCAD:</strong> Macro → Macros… → create, paste, Execute, then
            File → Export → STL. <strong>OpenSCAD:</strong> open, F6, export. Every
            dimension is a named parameter at the top of the file, and the header says
            which panels it is for and how to hold it.
          </p>
        </section>

        <section className="inspector-section">
          <h3>Shelf pin holes</h3>
          <dl className="readout">
            <div>
              <dt>Panels to drill</dt>
              <dd className="mono strong">{panels.length}</dd>
            </div>
            <div>
              <dt>Holes</dt>
              <dd className="mono">{counts.total}</dd>
            </div>
            <div>
              <dt>Shelves resting</dt>
              <dd className="mono">{counts.used}</dd>
            </div>
          </dl>
          <p className="muted small">
            Drill the whole row, not only the holes a shelf uses today — the spares cost
            nothing now and are what make the shelves adjustable later.
          </p>
          {shelfCount > 0 && (
            <p className="muted small">
              The shelves themselves need no holes to rest on pins. If you want the pins
              to <strong>capture</strong> them,{' '}
              {shelfCount === 1 ? '1 shelf gets' : `${shelfCount} shelves get`} holes in
              both ends — see the cards below.
            </p>
          )}

          {without.length > 0 && (
            <div className="warning-box">
              <strong>No hole grid on:</strong>
              <ul>
                {without.map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
              <span className="small">
                Turn on “Shelf pin holes” for these in the designer to put their shelves
                on the grid too.
              </span>
            </div>
          )}
        </section>

        <section className="inspector-section">
          <h3>Carcass fixings</h3>
          <dl className="readout">
            <div>
              <dt>Boards to drill</dt>
              <dd className="mono strong">{joints.length}</dd>
            </div>
            <div>
              <dt>Fixings</dt>
              <dd className="mono">{jointCount}</dd>
            </div>
          </dl>
          <p className="muted small">
            {design.settings.joints.name} through a board and on into the edge of
            whatever stands against it, clearance and pilot in one pass. Positions along
            the board are listed for checking, not for measuring — set out by standing
            the parts on the board.
          </p>
          <div className="button-row">
            <button type="button" onClick={() => window.print()}>
              Print the schedule
            </button>
          </div>
        </section>
      </aside>

      <div className="page-main drilling-list">
        {boards.length > 0 && (
          <figure className="panel-card">
            <figcaption>
              <strong>Which board is this?</strong>
              <span className="muted small">
                measure two edges, find the row
              </span>
            </figcaption>
            <table className="joint-table small">
              <thead>
                <tr>
                  <th>Cut size</th>
                  <th>Part</th>
                  <th>Drill</th>
                  <th>Jigs</th>
                </tr>
              </thead>
              <tbody>
                {boards.map((b) => (
                  <tr key={b.name}>
                    <td className="mono strong">{b.size}</td>
                    <td>
                      {b.name}
                      {b.count > 1 && <span className="muted"> ×{b.count}</span>}
                    </td>
                    <td className="muted">{[...b.ops].join(' · ')}</td>
                    <td className="mono">{b.jigs.sort((x, y) => x - y).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Jig numbers are the list on the left, top to bottom.
            </p>
          </figure>
        )}
        {panels.length === 0 && joints.length === 0 && (
          <p className="muted empty-state">
            No holes yet. Turn on “Shelf pin holes” for a cabinet in the designer, and
            give it some adjustable shelves.
          </p>
        )}
        {panels.map((panel) => (
          <PanelCard
            key={panel.partId}
            panel={panel}
            joints={jointsByPart.get(panel.partId)}
            onSelect={() => go(panel.partId)}
          />
        ))}
        {joints
          .filter((j) => !panels.some((p) => p.partId === j.partId))
          .map((joint) => (
            <JointCard key={joint.partId} joint={joint} onSelect={() => go(joint.partId)} />
          ))}
        {shelfEdges.map((group) => (
          <ShelfEdgeCard
            key={group.edge.partId}
            edge={group.edge}
            count={group.count}
            onSelect={() => go(group.edge.partId)}
          />
        ))}
      </div>
    </div>
  )
}

function PanelCard({
  panel,
  joints,
  onSelect,
}: {
  panel: PanelDrilling
  joints?: PanelJoints
  onSelect: () => void
}) {
  const { grid } = panel
  return (
    <figure className="panel-card">
      <figcaption>
        <button type="button" className="link strong" onClick={onSelect}>
          {panel.cabinetName} — {panel.label}
        </button>
        <span className="muted mono">
          {panel.length} × {panel.width} × {panel.thickness} mm
        </span>
      </figcaption>

      <p className="muted small">
        {panel.holes.length} holes · ⌀{grid.diameter}mm · {grid.depth}mm deep · first hole{' '}
        {panel.gridHeights[0]}mm from the bottom edge, then every {grid.pitch}mm
      </p>
      <p className="muted small">
        {panel.rows.length === 2 ? (
          <>
            Two rows: {grid.frontSetback}mm from the front edge, {grid.backSetback}mm from
            the back edge. Same setting both times — drill one row, flip the jig end for
            end, drill the other.
          </>
        ) : (
          <>One row, {grid.frontSetback}mm from the front edge.</>
        )}
      </p>

      <PanelDiagram panel={panel} joints={joints} />

      {joints && <JointDetail joint={joints} />}

      <details>
        <summary className="muted small">Hole heights from the bottom edge</summary>
        <p className="mono small hole-list">
          {panel.gridHeights.map((h) => (
            <span
              key={h}
              className={panel.shelfHeights.some((s) => Math.abs(s - h) < 0.51) ? 'used' : ''}
            >
              {h}
            </span>
          ))}
        </p>
        <p className="muted small">Highlighted heights are where a shelf sits.</p>
      </details>
    </figure>
  )
}

/**
 * Pin holes in a shelf's two ends.
 *
 * Drawn looking down on the shelf lying flat, so the two ends are the left and
 * right edges and the holes sit in them — which is how you will hold it to clamp
 * the jig on.
 */
function ShelfEdgeCard({
  edge,
  count,
  onSelect,
}: {
  edge: ShelfEdgeHoles
  count: number
  onSelect: () => void
}) {
  const pad = edge.width / 6
  const font = edge.width / 14
  const r = Math.max(edge.diameter, edge.width / 34)

  return (
    <figure className="panel-card">
      <figcaption>
        <button type="button" className="link strong" onClick={onSelect}>
          {edge.cabinetName} — {edge.label}
          {count > 1 && <span className="tag">×{count}</span>}
        </button>
        <span className="muted mono">
          {edge.length} × {edge.width} × {edge.thickness} mm
        </span>
      </figcaption>
      <p className="muted small">
        Four holes per shelf — two in each end. ⌀{edge.diameter}mm, {edge.depth}mm deep,
        centred at {edge.centre}mm on the {edge.thickness}mm edge,{' '}
        {edge.rows.join(' and ')}mm from the front edge.
      </p>
      {edge.warnings.map((w) => (
        <p key={w} className="small warn-text">
          {w}
        </p>
      ))}

      <svg
        className="panel-diagram"
        viewBox={`${-pad} ${-pad} ${edge.length + pad * 2} ${edge.width + pad * 2}`}
        role="img"
        aria-label={`${edge.label} end hole positions`}
      >
        <rect x={0} y={0} width={edge.length} height={edge.width} className="panel-body" />
        <line x1={0} y1={0} x2={edge.length} y2={0} className="panel-front-edge" />
        <text
          x={edge.length / 2}
          y={-pad / 3}
          textAnchor="middle"
          className="panel-note"
          fontSize={font}
        >
          front edge — fence the jig here
        </text>
        {edge.rows.map((row) =>
          [0, edge.length].map((x) => (
            <circle key={`${x}-${row}`} cx={x} cy={row} r={r} className="fixing" />
          )),
        )}
      </svg>
      <p className="muted small">
        Both ends take the same two holes, so one jig setting does all four: fence on
        the front edge, then turn it end for end for the back row.
      </p>
    </figure>
  )
}

/** A board that carries carcass fixings but no shelf pins — a top or a bottom. */
function JointCard({ joint, onSelect }: { joint: PanelJoints; onSelect: () => void }) {
  return (
    <figure className="panel-card">
      <figcaption>
        <button type="button" className="link strong" onClick={onSelect}>
          {joint.cabinetName} — {joint.label}
        </button>
        <span className="muted mono">
          {joint.length} × {joint.width} × {joint.thickness} mm
        </span>
      </figcaption>
      <p className="muted small">
        {joint.joints.length} joint{joint.joints.length === 1 ? '' : 's'}, drilled through
        this board into the edge of whatever stands against it.
      </p>
      <JointDiagram joint={joint} />
      <JointDetail joint={joint} />
    </figure>
  )
}

/**
 * The set-out order, then the numbers.
 *
 * In that order on purpose. The numbers are a check — they are exact to a hundredth
 * of a millimetre and useless as an instruction, because nobody transfers 1401.84mm
 * onto a board. The set-out is the instruction.
 */
function JointDetail({ joint }: { joint: PanelJoints }) {
  return (
    <div className="joint-detail">
      {joint.warnings.map((w) => (
        <p key={w} className="small warn-text">
          {w}
        </p>
      ))}

      {joint.setOut.length > 0 && (
        <>
          <p className="small strong">
            Set out from the {joint.datum} by standing the parts on the board
          </p>
          <ol className="set-out">
            {joint.setOut.map((step, i) =>
              step.kind === 'panel' ? (
                <li key={i} className="set-out-panel">
                  <span className="mono">{step.size}</span> {step.label}
                  <span className="muted"> — pencil both sides</span>
                </li>
              ) : (
                <li key={i} className="set-out-gap">
                  <span className="mono">{step.size}</span> opening
                  {step.gauge ? (
                    <span className="muted"> — gauge it with a {step.gauge.toLowerCase()}</span>
                  ) : (
                    <span className="muted"> — no cut part is this length; measure it</span>
                  )}
                </li>
              ),
            )}
          </ol>
          <p className="muted small">
            Every centre below then falls out of the cut sizes, so the error is the saw’s
            rather than the tape’s and it cannot accumulate.
          </p>
        </>
      )}

      <table className="joint-table small">
        <thead>
          <tr>
            <th>From the {joint.datum}</th>
            <th>From front</th>
            <th>Into</th>
            <th>Drill</th>
            <th>Slack</th>
          </tr>
        </thead>
        <tbody>
          {joint.joints.map((j) =>
            j.holes.map((h, i) => (
              <tr key={`${j.centre}-${h.v}`}>
                <td className="mono strong">{i === 0 ? `${j.centre}` : ''}</td>
                <td className="mono">{h.v}</td>
                <td>
                  {i === 0 ? (
                    <>
                      {j.mateLabel} <span className="muted">({j.mateThickness}mm)</span>
                    </>
                  ) : (
                    ''
                  )}
                </td>
                <td className="mono">
                  ⌀{h.clearance} through, ⌀{h.pilot}×{h.pilotDepth} on
                  {h.head ? `, ⌀${h.head.diameter}×${h.head.depth} counterbore` : ''}
                </td>
                <td className={`mono ${j.tolerance < 2.5 ? 'warn-text' : 'muted'}`}>
                  {i === 0 ? `±${j.tolerance}` : ''}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <p className="muted small">
        Slack is how far a centre may wander before the pilot breaks out of that edge.
      </p>
    </div>
  )
}

/**
 * The panel as you will hold it: lying down, bottom edge to the left, front edge
 * along the top. The hole rows are drawn where they really are across its width.
 */
function PanelDiagram({ panel, joints }: { panel: PanelDrilling; joints?: PanelJoints }) {
  // The viewBox is in millimetres, so everything drawn on it must be sized relative
  // to the panel — a fixed font size would be microscopic on a 2m side and enormous
  // on a short one. The SVG letterboxes into a fixed height so seven panel cards
  // stay scannable on one screen.
  const pad = panel.width / 6
  const viewW = panel.length + pad * 2
  const viewH = panel.width + pad * 2
  const r = Math.max(panel.grid.diameter, panel.width / 34)
  const font = panel.width / 14

  return (
    <svg
      className="panel-diagram"
      viewBox={`${-pad} ${-pad} ${viewW} ${viewH}`}
      role="img"
      aria-label={`${panel.label} hole positions`}
    >
      <rect x={0} y={0} width={panel.length} height={panel.width} className="panel-body" />
      {/* front edge, the one the jig registers against */}
      <line x1={0} y1={0} x2={panel.length} y2={0} className="panel-front-edge" />
      <text
        x={panel.length / 2}
        y={-pad / 3}
        textAnchor="middle"
        className="panel-note"
        fontSize={font}
      >
        front edge — register the jig here
      </text>
      <text
        x={-pad / 3}
        y={panel.width / 2}
        textAnchor="middle"
        className="panel-note"
        fontSize={font}
        transform={`rotate(-90 ${-pad / 3} ${panel.width / 2})`}
      >
        bottom edge
      </text>

      {panel.holes.map((h, i) => (
        <circle
          key={i}
          cx={h.u}
          cy={h.v}
          r={r}
          className={h.used ? 'hole used' : 'hole'}
        />
      ))}

      {/* Carcass fixings, drawn on the same panel so a clash with a pin row shows up. */}
      {joints?.joints.flatMap((j) =>
        j.holes.map((h) => (
          <circle
            key={`${j.centre}-${h.v}`}
            cx={h.u}
            cy={h.v}
            r={h.clearance / 2}
            className={h.pinGap !== null && h.pinGap < 2 ? 'fixing clash' : 'fixing'}
          />
        )),
      )}
    </svg>
  )
}

/**
 * A board with the uprights drawn on it where they land.
 *
 * The bands are the point of the drawing. A list of centres says nothing about
 * whether a 7mm hole will actually land on a 15mm edge; two hatched bands 15mm wide
 * with a hole between them say it at a glance.
 */
function JointDiagram({ joint }: { joint: PanelJoints }) {
  const pad = joint.width / 6
  const font = joint.width / 14

  return (
    <svg
      className="panel-diagram"
      viewBox={`${-pad} ${-pad} ${joint.length + pad * 2} ${joint.width + pad * 2}`}
      role="img"
      aria-label={`${joint.label} carcass fixing positions`}
    >
      <rect x={0} y={0} width={joint.length} height={joint.width} className="panel-body" />
      <line x1={0} y1={0} x2={joint.length} y2={0} className="panel-front-edge" />
      <text
        x={joint.length / 2}
        y={-pad / 3}
        textAnchor="middle"
        className="panel-note"
        fontSize={font}
      >
        front edge — fence the jig here
      </text>
      <text
        x={-pad / 3}
        y={joint.width / 2}
        textAnchor="middle"
        className="panel-note"
        fontSize={font}
        transform={`rotate(-90 ${-pad / 3} ${joint.width / 2})`}
      >
        {joint.datum}
      </text>

      {joint.joints.map((j) => (
        <rect
          key={j.centre}
          x={j.centre - j.mateThickness / 2}
          y={0}
          width={j.mateThickness}
          height={joint.width}
          className="mate-band"
        />
      ))}
      {joint.joints.flatMap((j) =>
        j.holes.map((h) => (
          <circle
            key={`${j.centre}-${h.v}`}
            cx={h.u}
            cy={h.v}
            r={h.clearance / 2}
            className="fixing"
          />
        )),
      )}
    </svg>
  )
}
