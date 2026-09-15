import { useMemo } from 'react'
import { buildCost, buildHardware } from '../../core/hardware'
import { bomToCsv } from '../../core/io/csv'
import { buildCutOrder, cutOrderWarnings } from '../../core/io/cutOrder'
import { countMaterialUsage } from '../../core/materials'
import type { Material } from '../../core/types'
import { useStore } from '../../state/store'
import { NumberField, TextField } from '../components/Field'
import { download, downloadBlob } from '../download'

export function BomPage() {
  const bom = useStore((s) => s.bom)
  const design = useStore((s) => s.design)
  const parts = useStore((s) => s.build.parts)
  const selection = useStore((s) => s.selection)
  const selectPart = useStore((s) => s.selectPart)
  const setTab = useStore((s) => s.setTab)
  const addMaterial = useStore((s) => s.addMaterial)

  const { hardware, cost } = useMemo(() => {
    const hardware = buildHardware(design, parts)
    return { hardware, cost: buildCost(design, bom, hardware) }
  }, [design, parts, bom])

  const selectedRowKey = bom.rows.find((r) => r.partIds.includes(selection.partId ?? ''))?.key
  const orderWarnings = useMemo(() => cutOrderWarnings(design, bom), [design, bom])

  return (
    <div className="page bom-page">
      <div className="page-main">
        <div className="panel-header">
          <h2>Bill of materials</h2>
          <div className="header-actions">
            <span className="muted">
              {bom.totalParts} parts · {bom.totalAreaM2.toFixed(2)} m²
            </span>
            <button
              type="button"
              onClick={() => download('bill-of-materials.csv', bomToCsv(bom.rows), 'text/csv')}
            >
              Export CSV
            </button>
            <button
              type="button"
              title="Cutting order in the board shop's column layout, one sheet per material"
              onClick={() => downloadBlob('listado-de-corte.xlsx', buildCutOrder(design, bom))}
            >
              Cutting order (.xlsx)
            </button>
          </div>
        </div>

        {orderWarnings.length > 0 && (
          <div className="warning-box order-warnings">
            <strong>Before sending the cutting order:</strong>
            <ul>
              {orderWarnings.map((w, i) => (
                <li key={i}>
                  {w.severity === 'error' ? '⛔ ' : '⚠ '}
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Material</th>
                <th className="num">Thk</th>
                <th className="num">Length</th>
                <th className="num">Width</th>
                <th className="num">Qty</th>
                <th className="num">Banding</th>
              </tr>
            </thead>
            <tbody>
              {bom.rows.map((row) => (
                <tr
                  key={row.key}
                  className={row.key === selectedRowKey ? 'selected' : ''}
                  onClick={() => {
                    selectPart(row.partIds[0])
                    setTab('designer')
                  }}
                  title="Show this part in the designer"
                >
                  <td>
                    {row.label}
                    {row.supplied && <span className="tag">supplied</span>}
                  </td>
                  <td className="muted">{row.materialName}</td>
                  <td className="num mono">{row.thickness}</td>
                  <td className="num mono strong">{row.length}</td>
                  <td className="num mono strong">{row.width}</td>
                  <td className="num mono">{row.quantity}</td>
                  <td className="num muted">
                    {row.bandedEdges > 0 ? `${row.bandingMetres.toFixed(2)} m` : '—'}
                  </td>
                </tr>
              ))}
              {bom.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Nothing to cut yet — add a cabinet in the designer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="page-side">
        <section className="inspector-section">
          <h3>Materials</h3>
          <p className="muted small">
            Sheet size is what your supplier sells. Cut sizes never change with it — only
            how many sheets you need.
          </p>
          {design.materials.map((material) => (
            <MaterialEditor key={material.id} material={material} />
          ))}
          <button type="button" className="add-material" onClick={addMaterial}>
            + Add material
          </button>
        </section>

        <section className="inspector-section">
          <h3>Hardware</h3>
          <table className="data-table compact">
            <tbody>
              {hardware.map((item) => (
                <tr key={item.name}>
                  <td>{item.name}</td>
                  <td className="num mono">{item.quantity}</td>
                  <td className="num mono">{money(item.total)}</td>
                </tr>
              ))}
              {hardware.length === 0 && (
                <tr>
                  <td className="muted">No hardware needed yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="inspector-section">
          <h3>Estimated cost</h3>
          <table className="data-table compact">
            <tbody>
              {cost.sheets.map((sheet) => (
                <tr key={sheet.materialId}>
                  <td>
                    {sheet.materialName}
                    <span className="muted"> × {sheet.sheets} sheet(s)</span>
                  </td>
                  <td className="num mono">{money(sheet.total)}</td>
                </tr>
              ))}
              <tr>
                <td>Edge banding</td>
                <td className="num mono">{money(cost.bandingTotal)}</td>
              </tr>
              <tr>
                <td>Hardware</td>
                <td className="num mono">{money(cost.hardwareTotal)}</td>
              </tr>
              {bom.byMaterial
                .filter((m) => m.supplied)
                .map((m) => (
                  <tr key={m.materialId}>
                    <td>
                      {m.materialName}
                      <span className="muted"> · {m.areaM2.toFixed(2)} m²</span>
                    </td>
                    <td className="num muted">supplied</td>
                  </tr>
                ))}
              <tr className="total">
                <td>Total</td>
                <td className="num mono strong">{money(cost.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            Sheet counts here are the theoretical minimum from area alone. Run the cut plan
            for the real number — offcuts always push it up.
          </p>
        </section>
      </aside>
    </div>
  )
}

function MaterialEditor({ material }: { material: Material }) {
  const design = useStore((s) => s.design)
  const updateMaterial = useStore((s) => s.updateMaterial)
  const removeMaterial = useStore((s) => s.removeMaterial)
  const usage = countMaterialUsage(design, material.id)
  const canRemove = usage === 0 && design.materials.length > 1

  const update = (patch: Partial<Material>) => updateMaterial(material.id, patch)

  return (
    <details className="material-editor">
      <summary>
        <span className="swatch" style={{ background: material.color }} />
        {material.name}
        <span className="muted mono">
          {material.thickness}mm · {material.sheet.length}×{material.sheet.width}
        </span>
      </summary>
      <TextField label="Name" value={material.name} onChange={(v) => update({ name: v })} />
      <NumberField
        label="Thickness"
        value={material.thickness}
        min={1}
        step={0.5}
        onChange={(v) => update({ thickness: v })}
      />
      <div className="field-row">
        <NumberField
          label="Sheet length"
          value={material.sheet.length}
          min={100}
          onChange={(v) => update({ sheet: { ...material.sheet, length: v } })}
        />
        <NumberField
          label="Sheet width"
          value={material.sheet.width}
          min={100}
          onChange={(v) => update({ sheet: { ...material.sheet, width: v } })}
        />
      </div>
      <NumberField
        label="Price per sheet"
        value={material.pricePerSheet}
        min={0}
        step={0.5}
        suffix=""
        onChange={(v) => update({ pricePerSheet: v })}
      />
      <label className="field check">
        <input
          type="checkbox"
          checked={material.hasGrain}
          onChange={(e) => update({ hasGrain: e.target.checked })}
        />
        <span className="field-label">
          Has grain
          <em title="Grained parts keep their orientation when nesting, which usually costs a little more material">
            ?
          </em>
        </span>
      </label>
      <label className="field check">
        <input
          type="checkbox"
          checked={!!material.supplied}
          onChange={(e) => update({ supplied: e.target.checked })}
        />
        <span className="field-label">
          Supplied to size
          <em title="Not cut from sheets — a solid timber plank, glass, a bought worktop. Left out of the cut plan and the sheet count, but still listed here with its dimensions so you know what to order.">
            ?
          </em>
        </span>
      </label>
      <div className="material-footer">
        <span className="muted small">
          {usage === 0 ? 'not used' : `used in ${usage} place${usage === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className="danger"
          disabled={!canRemove}
          title={
            canRemove
              ? 'Remove this material'
              : 'Still in use — change those parts to another material first'
          }
          onClick={() => removeMaterial(material.id)}
        >
          Remove
        </button>
      </div>
    </details>
  )
}

const money = (value: number) => value.toFixed(2)
