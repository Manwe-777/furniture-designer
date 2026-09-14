import { useMemo, useState } from 'react'
import { materialsById } from '../../core/build/buildDesign'
import { cutPlanToCsv } from '../../core/io/csv'
import { nest, toNestParts } from '../../core/nest/optimize'
import type { MaterialNestResult, NestResult } from '../../core/nest/types'
import { useStore } from '../../state/store'
import { CheckField, NumberField } from '../components/Field'
import { download } from '../download'
import { SheetSvg } from './SheetSvg'

/**
 * Says whether the sheet count could actually be lower.
 *
 * Waste % on its own makes a good plan look bad: you buy whole sheets, so leftover
 * area only costs you if it could have removed a sheet. This compares the packing
 * efficiency achieved against the efficiency that dropping one sheet would demand —
 * and past roughly 92% no real layout of mixed rectangles gets there, so the honest
 * answer is that the parts, not the packer, are what to change.
 */
function Verdict({ result }: { result: MaterialNestResult }) {
  const { utilisationPct, utilisationToSaveOneSheet, provenFloorSheets } = result.yield
  if (result.sheets.length <= provenFloorSheets) {
    return (
      <span className="verdict good">
        Provably optimal — {result.sheets.length} sheet(s) is the mathematical minimum
        for these parts. The leftover cannot be recovered by any algorithm.
      </span>
    )
  }
  if (utilisationToSaveOneSheet === null) {
    return <span className="verdict good">Single sheet — nothing to improve.</span>
  }
  if (utilisationToSaveOneSheet > 92) {
    return (
      <span className="verdict good">
        As good as it gets: using {result.sheets.length - 1} sheets would need{' '}
        {utilisationToSaveOneSheet.toFixed(0)}% packing, which no real layout reaches.
        To use less, change the parts.
      </span>
    )
  }
  return (
    <span className="verdict warn">
      Currently {utilisationPct.toFixed(0)}% packed;{' '}
      {utilisationToSaveOneSheet.toFixed(0)}% would save a sheet. Try raising the
      optimiser effort.
    </span>
  )
}

export function CutPlanPage() {
  const design = useStore((s) => s.design)
  const parts = useStore((s) => s.build.parts)
  const updateSettings = useStore((s) => s.updateSettings)
  const selectPart = useStore((s) => s.selectPart)
  const selectedPartId = useStore((s) => s.selection.partId)
  const [showCuts, setShowCuts] = useState(true)
  const [effort, setEffort] = useState(100)

  // Nesting is fast enough (tens of milliseconds) to just recompute whenever the
  // design or the sheet settings change — no "Run" button to forget to press.
  const result: NestResult = useMemo(
    () =>
      nest(toNestParts(parts, materialsById(design)), materialsById(design), {
        kerf: design.settings.kerf,
        trim: design.settings.sheetTrim,
        effort,
        seed: 12345,
      }),
    [parts, design, effort],
  )

  const allSheets = result.byMaterial.flatMap((m) => m.sheets)

  return (
    <div className="page cutplan-page">
      <aside className="page-side left">
        <section className="inspector-section">
          <h3>Sheet settings</h3>
          <NumberField
            label="Saw kerf"
            value={design.settings.kerf}
            min={0}
            step={0.1}
            hint="Blade width. Every cut destroys this much material between two parts."
            onChange={(v) => updateSettings({ kerf: v })}
          />
          <NumberField
            label="Edge trim"
            value={design.settings.sheetTrim}
            min={0}
            hint="Unusable margin trimmed off each sheet edge before anything is cut"
            onChange={(v) => updateSettings({ sheetTrim: v })}
          />
          <NumberField
            label="Optimiser effort"
            value={effort}
            min={0}
            max={5000}
            step={10}
            suffix="tries"
            hint="Extra randomised attempts on top of the standard strategies. More tries can find a better layout; results stay reproducible."
            onChange={setEffort}
          />
          <CheckField label="Show cut lines" checked={showCuts} onChange={setShowCuts} />
          <p className="muted small">
            Sheet sizes and prices are set per material on the Bill of materials tab.
          </p>
        </section>

        <section className="inspector-section">
          <h3>Result</h3>
          <dl className="readout">
            <div>
              <dt>Sheets</dt>
              <dd className="mono strong">{result.totalSheets}</dd>
            </div>
            <div>
              <dt>Waste</dt>
              <dd className="mono">{result.totalWastePct.toFixed(1)}%</dd>
            </div>
          </dl>
          {result.byMaterial.map((m) => (
            <div key={m.materialId} className="material-result">
              <strong>{m.materialName}</strong>
              <span className="muted">
                {m.sheets.length} sheet(s) · {m.wastePct.toFixed(1)}% waste
              </span>
              {m.largestOffcut && (
                <span className="muted small">
                  Largest offcut {Math.round(m.largestOffcut.w)} × {Math.round(m.largestOffcut.h)} mm
                </span>
              )}
              <Verdict result={m} />
            </div>
          ))}

          {result.unplaced.length > 0 && (
            <div className="warning-box">
              <strong>{result.unplaced.length} part(s) do not fit on a sheet:</strong>
              <ul>
                {result.unplaced.slice(0, 6).map((p) => (
                  <li key={p.id} className="mono">
                    {p.label} — {p.length} × {p.width}
                  </li>
                ))}
              </ul>
              <span className="small">
                Either the part is bigger than the sheet, or the edge trim leaves too little.
              </span>
            </div>
          )}

          <div className="button-row">
            <button
              type="button"
              onClick={() => download('cut-plan.csv', cutPlanToCsv(allSheets), 'text/csv')}
            >
              Export CSV
            </button>
            <button type="button" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </section>
      </aside>

      <div className="page-main sheets">
        {allSheets.length === 0 && (
          <p className="muted empty-state">
            Nothing to nest yet — design something on the Designer tab.
          </p>
        )}
        {allSheets.map((sheet) => (
          <figure key={`${sheet.materialId}-${sheet.index}`} className="sheet-figure">
            <figcaption>
              <strong>
                {sheet.materialName} — sheet {sheet.index + 1}
              </strong>
              <span className="muted">
                {sheet.sheetLength} × {sheet.sheetWidth} mm · {sheet.placements.length} parts ·{' '}
                {sheet.wastePct.toFixed(1)}% waste · {sheet.cuts.length} cuts
              </span>
            </figcaption>
            <SheetSvg
              sheet={sheet}
              showCuts={showCuts}
              highlightPartId={selectedPartId}
              onSelectPart={selectPart}
            />
          </figure>
        ))}
      </div>
    </div>
  )
}
