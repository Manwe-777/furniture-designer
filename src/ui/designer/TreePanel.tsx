import type { FurnitureNode } from '../../core/types'
import { useStore } from '../../state/store'
import { describeNode, flattenNodes } from '../../state/tree'

export function TreePanel() {
  const cabinets = useStore((s) => s.design.cabinets)
  const worktops = useStore((s) => s.design.worktops)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const addCabinet = useStore((s) => s.addCabinet)
  const addWorktop = useStore((s) => s.addWorktop)
  const duplicateCabinet = useStore((s) => s.duplicateCabinet)
  const removeCabinet = useStore((s) => s.removeCabinet)
  const removeWorktop = useStore((s) => s.removeWorktop)

  return (
    <div className="tree-panel">
      <div className="panel-header">
        <h2>Structure</h2>
      </div>

      <div className="tree-scroll">
        {cabinets.map((cab) => {
          const isActive = selection.cabinetId === cab.id && !selection.worktopId
          return (
            <div key={cab.id} className={`tree-unit${isActive ? ' active' : ''}`}>
              <div className="tree-unit-header">
                <button
                  type="button"
                  className="tree-row unit"
                  onClick={() => select({ cabinetId: cab.id, nodeId: cab.root.id })}
                >
                  <span className="tree-name">{cab.name}</span>
                  <span className="tree-meta mono">
                    {cab.width}×{cab.height}×{cab.depth}
                  </span>
                </button>
                <div className="tree-unit-actions">
                  <button type="button" title="Duplicate" onClick={() => duplicateCabinet(cab.id)}>
                    ⧉
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    className="danger"
                    onClick={() => removeCabinet(cab.id)}
                  >
                    ×
                  </button>
                </div>
              </div>

              {isActive &&
                flattenNodes(cab.root).map(({ node, depth }) => (
                  <NodeRow
                    key={node.id}
                    node={node}
                    depth={depth}
                    selected={selection.nodeId === node.id}
                    onSelect={() => select({ cabinetId: cab.id, nodeId: node.id })}
                  />
                ))}
            </div>
          )
        })}

        {worktops.map((wt) => (
          <div
            key={wt.id}
            className={`tree-unit${selection.worktopId === wt.id ? ' active' : ''}`}
          >
            <div className="tree-unit-header">
              <button
                type="button"
                className="tree-row unit"
                onClick={() => select({ worktopId: wt.id })}
              >
                <span className="tree-name">{wt.name}</span>
                <span className="tree-meta mono">
                  {wt.shape === 'L' ? 'L-shape' : `${wt.a.length}×${wt.a.depth}`}
                </span>
              </button>
              <div className="tree-unit-actions">
                <button
                  type="button"
                  title="Delete"
                  className="danger"
                  onClick={() => removeWorktop(wt.id)}
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="tree-footer">
        <button type="button" onClick={addCabinet}>
          + Cabinet
        </button>
        <button type="button" onClick={addWorktop}>
          + Worktop
        </button>
      </div>
    </div>
  )
}

function NodeRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FurnitureNode
  depth: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`tree-row${selected ? ' selected' : ''}`}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={onSelect}
    >
      <span className="tree-glyph">{node.kind === 'split' ? (node.dir === 'v' ? '▥' : '▤') : '·'}</span>
      <span className="tree-name">{describeNode(node)}</span>
    </button>
  )
}
