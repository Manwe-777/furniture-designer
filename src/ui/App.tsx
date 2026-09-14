import { useEffect } from 'react'
import { newDesign } from '../core/defaults'
import { ProjectParseError } from '../core/io/project'
import { useStore, type Tab } from '../state/store'
import { BomPage } from './bom/BomPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CutPlanPage } from './cutplan/CutPlanPage'
import { DrillingPage } from './drilling/DrillingPage'
import { Elevation2D } from './designer/Elevation2D'
import { Inspector } from './designer/Inspector'
import { TreePanel } from './designer/TreePanel'
import { Viewport3D } from './designer/Viewport3D'
import { download, pickTextFile } from './download'

const TABS: { id: Tab; label: string }[] = [
  { id: 'designer', label: 'Designer' },
  { id: 'cutplan', label: 'Cut plan' },
  { id: 'drilling', label: 'Drilling' },
]

export function App() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)

  // Undo/redo work everywhere except inside a text field, where the browser's own
  // undo is what you actually want.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return (
    <div className="app">
      <Header />
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <BomTabButton />
      </nav>

      <ErrorBoundary resetKey={tab}>
        {tab === 'designer' && <DesignerPage />}
        {tab === 'bom' && <BomPage />}
        {tab === 'cutplan' && <CutPlanPage />}
        {tab === 'drilling' && <DrillingPage />}
      </ErrorBoundary>
    </div>
  )
}

/** The BOM tab carries a live part count, so it gets its own button. */
function BomTabButton() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const totalParts = useStore((s) => s.bom.totalParts)
  return (
    <button
      type="button"
      className={tab === 'bom' ? 'active' : ''}
      onClick={() => setTab('bom')}
    >
      Bill of materials <span className="badge">{totalParts}</span>
    </button>
  )
}

function DesignerPage() {
  return (
    <div className="page designer-page">
      <TreePanel />
      <Elevation2D />
      <div className="right-column">
        <Viewport3D />
        <ViewportControls />
      </div>
      <aside className="page-side">
        <Inspector />
      </aside>
      <Warnings />
    </div>
  )
}

function ViewportControls() {
  const exploded = useStore((s) => s.exploded)
  const setExploded = useStore((s) => s.setExploded)
  const showDimensions = useStore((s) => s.showDimensions)
  const toggleDimensions = useStore((s) => s.toggleDimensions)

  return (
    <div className="viewport-controls">
      <label className="slider">
        <span>Explode</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={exploded}
          onChange={(e) => setExploded(Number(e.target.value))}
        />
      </label>
      <button type="button" onClick={() => setExploded(0)} disabled={exploded === 0}>
        Reset
      </button>
      <button type="button" onClick={toggleDimensions}>
        {showDimensions ? 'Hide' : 'Show'} dimensions
      </button>
    </div>
  )
}

/** Anything the part generator could not build correctly, surfaced where you edit. */
function Warnings() {
  const warnings = useStore((s) => s.build.warnings)
  const select = useStore((s) => s.select)
  if (warnings.length === 0) return null

  return (
    <div className="warnings">
      {warnings.slice(0, 4).map((warning, i) => (
        <button
          key={i}
          type="button"
          className="warning"
          onClick={() =>
            select({ cabinetId: warning.cabinetId, nodeId: warning.nodeId })
          }
        >
          ⚠ {warning.message}
        </button>
      ))}
      {warnings.length > 4 && (
        <span className="warning muted">+{warnings.length - 4} more</span>
      )}
    </div>
  )
}

function Header() {
  const design = useStore((s) => s.design)
  const replaceDesign = useStore((s) => s.replaceDesign)
  const loadExample = useStore((s) => s.loadExample)
  const loadJson = useStore((s) => s.loadJson)
  const exportJson = useStore((s) => s.exportJson)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  const onImport = async () => {
    const text = await pickTextFile('application/json,.json')
    if (!text) return
    try {
      loadJson(text)
    } catch (error) {
      const message =
        error instanceof ProjectParseError ? error.message : 'Could not read that file'
      window.alert(message)
    }
  }

  return (
    <header className="app-header">
      <h1>Furniture designer</h1>
      <input
        className="design-name"
        value={design.name}
        onChange={(e) => replaceDesign({ ...design, name: e.target.value })}
        aria-label="Design name"
      />
      <div className="header-actions">
        <button type="button" onClick={undo} disabled={!canUndo} title="Ctrl+Z">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">
          Redo
        </button>
        <span className="divider" />
        <button type="button" onClick={() => replaceDesign(newDesign())}>
          New
        </button>
        <button type="button" onClick={loadExample}>
          L-desk example
        </button>
        <button type="button" onClick={onImport}>
          Import
        </button>
        <button
          type="button"
          onClick={() =>
            download(`${design.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json`, exportJson())
          }
        >
          Save
        </button>
      </div>
    </header>
  )
}
