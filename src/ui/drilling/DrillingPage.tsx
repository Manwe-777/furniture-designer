import { useMemo } from 'react'
import { buildDrilling, countHoles, drillingToCsv, unusedCabinets, type PanelDrilling } from '../../core/holes'
import {
  edgeJigFreecadMacro,
  edgeJigScad,
  edgeJigSpec,
  jigFreecadMacro,
  jigScad,
  jigSpecs,
} from '../../core/jig'
import { useStore } from '../../state/store'
import { download } from '../download'

export function DrillingPage() {
  const design = useStore((s) => s.design)
  const selectPart = useStore((s) => s.selectPart)
  const setTab = useStore((s) => s.setTab)

  const panels = useMemo(() => buildDrilling(design), [design])
  const counts = countHoles(panels)
  const without = unusedCabinets(design)
  const jigs = useMemo(() => jigSpecs(panels), [panels])
  // Edge holes are for minifix bolts and dowels. Confirmats do not need this jig:
  // they are drilled through both panels at once and cannot come out misaligned.
  const edgeJig = useMemo(() => {
    const thickness = design.cabinets[0]
      ? (design.materials.find((m) => m.id === design.cabinets[0].materialId)?.thickness ?? 18)
      : 18
    return edgeJigSpec(thickness, 8, 50)
  }, [design])

  return (
    <div className="page drilling-page">
      <aside className="page-side left">
        <section className="inspector-section">
          <h3>Shelf pin holes</h3>
          <p className="muted small">
            Every shelf sits on the same grid, so one jig registered off the bottom and
            front edges drills every panel here — no per-panel measuring.
          </p>
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

          <div className="button-row">
            <button
              type="button"
              disabled={panels.length === 0}
              onClick={() => download('drilling.csv', drillingToCsv(panels), 'text/csv')}
            >
              Export CSV
            </button>
            <button type="button" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </section>

        {jigs.length > 0 && (
          <section className="inspector-section">
            <h3>Printable jig</h3>
            <p className="muted small">
              Print <strong>both</strong>. The end stop places the first hole, but once
              the jig moves off the bottom edge that stop would sit on the panel face and
              lift it off the work — so the continuation piece has none, and indexes off
              the last hole instead. Both are reversible: flip to drill the back row.
            </p>
            {jigs.map((jig) => (
              <div key={jig.panelWidth} className="material-result">
                <strong>{jig.panelWidth}mm deep panels</strong>
                <span className="muted small">
                  {jig.panels.length} panel{jig.panels.length === 1 ? '' : 's'}
                </span>
                {(['start', 'continue'] as const).map((variant) => {
                  const v = jig[variant]
                  return (
                    <div key={variant} className="jig-variant">
                      <span className="small">
                        <strong>{variant === 'start' ? 'Start' : 'Continue'}</strong>{' '}
                        <span className="muted">
                          {variant === 'start' ? 'fence + end stop' : 'fence only'} ·{' '}
                          {v.positions} positions · reaches {v.reachMm}mm
                        </span>
                      </span>
                      <span className="muted small mono">
                        prints {v.size.length} × {v.size.width} × {v.size.height} mm
                      </span>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() =>
                            download(
                              `jig-${jig.panelWidth}mm-${variant}.FCMacro`,
                              jigFreecadMacro(jig, design.name, variant),
                              'text/plain',
                            )
                          }
                        >
                          FreeCAD
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            download(
                              `jig-${jig.panelWidth}mm-${variant}.scad`,
                              jigScad(jig, design.name, variant),
                              'text/plain',
                            )
                          }
                        >
                          OpenSCAD
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            <p className="muted small">
              <strong>FreeCAD:</strong> Macro → Macros… → create, paste, Execute, then
              File → Export → STL. <strong>OpenSCAD:</strong> open, F6, export. Both
              build the same solid; plate thickness, bushing pocket and fence size are
              named parameters at the top of each.
            </p>
          </section>
        )}

        <section className="inspector-section">
          <h3>Edge jig</h3>
          <p className="muted small">
            For holes into the <strong>edge</strong> of a panel — minifix bolts or
            dowels — centred on its thickness and square to it. It straddles the edge,
            with a fence to set the distance along it.
          </p>
          <p className="muted small">
            You do <strong>not</strong> need this for confirmats: those are drilled
            through both panels in one pass, so the edge hole cannot come out
            misaligned.
          </p>
          <div className="jig-variant">
            <span className="small">
              <strong>{edgeJig.panelThickness}mm panels</strong>{' '}
              <span className="muted">
                · ⌀{edgeJig.holeDiameter}mm at {edgeJig.panelThickness / 2}mm ·{' '}
                {edgeJig.fromEdge}mm from the fence
              </span>
            </span>
            <span className="muted small mono">
              prints {edgeJig.size.length} × {edgeJig.size.width} × {edgeJig.size.height} mm
            </span>
            <div className="button-row">
              <button
                type="button"
                onClick={() =>
                  download(
                    'edge-jig.FCMacro',
                    edgeJigFreecadMacro(edgeJig, design.name),
                    'text/plain',
                  )
                }
              >
                FreeCAD
              </button>
              <button
                type="button"
                onClick={() =>
                  download('edge-jig.scad', edgeJigScad(edgeJig, design.name), 'text/plain')
                }
              >
                OpenSCAD
              </button>
            </div>
          </div>
          <p className="muted small">
            <strong>Check bit_d before printing</strong> — it defaults to 8mm, but your
            minifix bolt may want 10mm, or 5mm if it threads straight into the board.
          </p>
        </section>

      </aside>

      <div className="page-main drilling-list">
        {panels.length === 0 && (
          <p className="muted empty-state">
            No pin holes yet. Turn on “Shelf pin holes” for a cabinet in the designer,
            and give it some adjustable shelves.
          </p>
        )}
        {panels.map((panel) => (
          <PanelCard key={panel.partId} panel={panel} onSelect={() => { selectPart(panel.partId); setTab('designer') }} />
        ))}
      </div>
    </div>
  )
}

function PanelCard({ panel, onSelect }: { panel: PanelDrilling; onSelect: () => void }) {
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

      <PanelDiagram panel={panel} />

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
 * The panel as you will hold it: lying down, bottom edge to the left, front edge
 * along the top. The hole rows are drawn where they really are across its width.
 */
function PanelDiagram({ panel }: { panel: PanelDrilling }) {
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
    </svg>
  )
}
