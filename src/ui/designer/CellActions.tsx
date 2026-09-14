import { drawersContent, shelvesContent } from '../../core/defaults'
import type { Content } from '../../core/types'
import { selectActiveCabinet, selectActiveNode, selectActiveParent, useStore } from '../../state/store'

/**
 * What you can do to the selected cell. The whole editing vocabulary is here:
 * divide a space, or fill it.
 */
export function CellActions() {
  const cabinet = useStore(selectActiveCabinet)
  const node = useStore(selectActiveNode)
  const parent = useStore(selectActiveParent)
  const splitCell = useStore((s) => s.splitCell)
  const setContent = useStore((s) => s.setContent)
  const addSplitChild = useStore((s) => s.addSplitChild)
  const removeSplitChild = useStore((s) => s.removeSplitChild)

  if (!cabinet || !node) {
    return (
      <div className="cell-actions muted">Click a space in the elevation to edit it.</div>
    )
  }

  const fill = (content: Content) => setContent(cabinet.id, node.id, content)
  const indexInParent = parent?.children.findIndex((c) => c.id === node.id) ?? -1

  return (
    <div className="cell-actions">
      <div className="action-group">
        <span className="action-label">Divide</span>
        <button type="button" onClick={() => splitCell(cabinet.id, node.id, 'v')}>
          <Glyph dir="v" /> Columns
        </button>
        <button type="button" onClick={() => splitCell(cabinet.id, node.id, 'h')}>
          <Glyph dir="h" /> Rows
        </button>
        {node.kind === 'split' && (
          <button type="button" onClick={() => addSplitChild(cabinet.id, node.id)}>
            + Add {node.dir === 'v' ? 'column' : 'row'}
          </button>
        )}
      </div>

      {node.kind === 'cell' && (
        <div className="action-group">
          <span className="action-label">Fill with</span>
          <button
            type="button"
            className={node.content.type === 'shelves' ? 'active' : ''}
            onClick={() => fill(shelvesContent(3))}
          >
            Shelves
          </button>
          <button
            type="button"
            className={node.content.type === 'drawers' ? 'active' : ''}
            onClick={() => fill(drawersContent(3))}
          >
            Drawers
          </button>
          <button
            type="button"
            className={node.content.type === 'door' ? 'active' : ''}
            onClick={() => fill({ type: 'door', hinge: 'left', gap: 2 })}
          >
            Door
          </button>
          <button
            type="button"
            className={node.content.type === 'empty' ? 'active' : ''}
            onClick={() => fill({ type: 'empty' })}
          >
            Empty
          </button>
        </div>
      )}

      {parent && indexInParent >= 0 && (
        <div className="action-group">
          <button
            type="button"
            className="danger"
            onClick={() => removeSplitChild(cabinet.id, parent.id, indexInParent)}
          >
            Remove this {parent.dir === 'v' ? 'column' : 'row'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Little icon showing which way the dividers will run. */
function Glyph({ dir }: { dir: 'v' | 'h' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="glyph" aria-hidden="true">
      <rect x="0.5" y="0.5" width="13" height="13" fill="none" stroke="currentColor" />
      {dir === 'v' ? (
        <line x1="7" y1="0.5" x2="7" y2="13.5" stroke="currentColor" />
      ) : (
        <line x1="0.5" y1="7" x2="13.5" y2="7" stroke="currentColor" />
      )}
    </svg>
  )
}
