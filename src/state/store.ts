import { create } from 'zustand'
import { buildBom, type BomSummary } from '../core/bom'
import { buildDesign, materialsById } from '../core/build/buildDesign'
import type { BuildResult } from '../core/build/buildCabinet'
import {
  cellWith,
  emptyCell,
  lDeskDesign,
  newCabinet,
  newWorktop,
  shelvesContent,
} from '../core/defaults'
import { newId } from '../core/ids'
import { parseDesign, serializeDesign } from '../core/io/project'
import { countMaterialUsage, newMaterial } from '../core/materials'
import type {
  Cabinet,
  Content,
  Design,
  FurnitureNode,
  Material,
  Size,
  SplitDir,
  Worktop,
} from '../core/types'
import { flex } from '../core/types'
import { findNode, findParent, replaceNode } from './tree'

const STORAGE_KEY = 'furniture-designer:design'

export type Tab = 'designer' | 'bom' | 'cutplan' | 'drilling'

/** Orthographic drops the perspective so front/side/top read as true elevations. */
export type Projection = 'perspective' | 'orthographic'

export interface Selection {
  nodeId?: string
  partId?: string
  cabinetId?: string
  worktopId?: string
}

interface AppState {
  design: Design
  selection: Selection
  tab: Tab
  exploded: number
  showDimensions: boolean
  showBanding: boolean
  projection: Projection
  past: Design[]
  future: Design[]

  // derived, recomputed on every design change
  build: BuildResult
  bom: BomSummary

  setTab: (tab: Tab) => void
  setExploded: (value: number) => void
  toggleDimensions: () => void
  toggleBanding: () => void
  setProjection: (projection: Projection) => void
  select: (selection: Selection) => void
  selectPart: (partId: string) => void

  undo: () => void
  redo: () => void

  replaceDesign: (design: Design) => void
  loadExample: () => void
  loadJson: (json: string) => void
  exportJson: () => string

  updateCabinet: (id: string, patch: Partial<Cabinet>) => void
  addCabinet: () => void
  duplicateCabinet: (id: string) => void
  removeCabinet: (id: string) => void

  updateWorktop: (id: string, patch: Partial<Worktop>) => void
  addWorktop: () => void
  removeWorktop: (id: string) => void

  splitCell: (cabinetId: string, nodeId: string, dir: SplitDir) => void
  addSplitChild: (cabinetId: string, nodeId: string) => void
  removeSplitChild: (cabinetId: string, splitId: string, index: number) => void
  setChildSize: (cabinetId: string, splitId: string, index: number, size: Size) => void
  setDividerThickness: (cabinetId: string, splitId: string, thickness: number) => void
  setContent: (cabinetId: string, nodeId: string, content: Content) => void
  updateSettings: (patch: Partial<Design['settings']>) => void

  addMaterial: () => void
  updateMaterial: (id: string, patch: Partial<Material>) => void
  removeMaterial: (id: string) => void
}

function derive(design: Design): { build: BuildResult; bom: BomSummary } {
  const build = buildDesign(design)
  const bom = buildBom(build.parts, materialsById(design))
  return { build, bom }
}

/** Allow deep-linking a tab, e.g. /?tab=cutplan. */
function initialTab(): Tab {
  try {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (
      requested === 'bom' ||
      requested === 'cutplan' ||
      requested === 'designer' ||
      requested === 'drilling'
    ) {
      return requested
    }
  } catch {
    // No URL available (tests, SSR) — fall through to the default.
  }
  return 'designer'
}

function loadInitialDesign(): Design {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return parseDesign(saved)
  } catch {
    // A corrupt or outdated save should never stop the app from opening.
  }
  return lDeskDesign()
}

function persist(design: Design): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDesign(design))
  } catch {
    // Private browsing or a full quota — not worth interrupting the user over.
  }
}

const HISTORY_LIMIT = 100

export const useStore = create<AppState>((set, get) => {
  const initial = loadInitialDesign()

  /** Apply a change to the design, recording it for undo and saving it. */
  const commit = (fn: (design: Design) => Design) => {
    const { design, past } = get()
    const next = fn(design)
    if (next === design) return
    persist(next)
    set({
      design: next,
      past: [...past, design].slice(-HISTORY_LIMIT),
      future: [],
      ...derive(next),
    })
  }

  /** Change one cabinet's tree in place. */
  const editTree = (
    cabinetId: string,
    fn: (root: FurnitureNode) => FurnitureNode,
  ) =>
    commit((design) => ({
      ...design,
      cabinets: design.cabinets.map((cab) =>
        cab.id === cabinetId ? { ...cab, root: fn(cab.root) } : cab,
      ),
    }))

  return {
    design: initial,
    selection: { cabinetId: initial.cabinets[0]?.id, nodeId: initial.cabinets[0]?.root.id },
    tab: initialTab(),
    exploded: 0,
    showDimensions: true,
    showBanding: true,
    projection: 'perspective',
    past: [],
    future: [],
    ...derive(initial),

    setTab: (tab) => set({ tab }),
    setExploded: (exploded) => set({ exploded }),
    toggleDimensions: () => set({ showDimensions: !get().showDimensions }),
    toggleBanding: () => set({ showBanding: !get().showBanding }),
    setProjection: (projection) => set({ projection }),
    select: (selection) => set({ selection }),

    selectPart: (partId) => {
      const part = get().build.parts.find((p) => p.id === partId)
      if (!part) return
      set({
        selection: {
          partId,
          nodeId: part.nodeId,
          cabinetId: part.cabinetId,
          worktopId: get().design.worktops.some((w) => w.id === part.cabinetId)
            ? part.cabinetId
            : undefined,
        },
      })
    },

    undo: () => {
      const { past, design, future } = get()
      const previous = past[past.length - 1]
      if (!previous) return
      persist(previous)
      set({
        design: previous,
        past: past.slice(0, -1),
        future: [design, ...future].slice(0, HISTORY_LIMIT),
        ...derive(previous),
      })
    },

    redo: () => {
      const { past, design, future } = get()
      const next = future[0]
      if (!next) return
      persist(next)
      set({
        design: next,
        past: [...past, design].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        ...derive(next),
      })
    },

    replaceDesign: (design) => commit(() => design),

    loadExample: () => {
      const design = lDeskDesign()
      commit(() => design)
      set({ selection: { cabinetId: design.cabinets[0].id, nodeId: design.cabinets[0].root.id } })
    },

    loadJson: (json) => {
      const design = parseDesign(json)
      commit(() => design)
      set({ selection: { cabinetId: design.cabinets[0]?.id, nodeId: design.cabinets[0]?.root.id } })
    },

    exportJson: () => serializeDesign(get().design),

    updateCabinet: (id, patch) =>
      commit((design) => ({
        ...design,
        cabinets: design.cabinets.map((cab) => (cab.id === id ? { ...cab, ...patch } : cab)),
      })),

    addCabinet: () => {
      const design = get().design
      // Drop the new cabinet to the right of everything that exists already.
      const rightEdge = design.cabinets.reduce(
        (max, cab) => Math.max(max, cab.transform.x + cab.width),
        0,
      )
      const cab = newCabinet({
        name: `Cabinet ${design.cabinets.length + 1}`,
        transform: { x: rightEdge + 50, y: 0, z: 0, rotY: 0 },
        root: cellWith(shelvesContent(2)),
      })
      commit((d) => ({ ...d, cabinets: [...d.cabinets, cab] }))
      set({ selection: { cabinetId: cab.id, nodeId: cab.root.id } })
    },

    duplicateCabinet: (id) => {
      const source = get().design.cabinets.find((c) => c.id === id)
      if (!source) return
      const clone: Cabinet = {
        ...structuredClone(source),
        id: newId('cab'),
        name: `${source.name} copy`,
        transform: { ...source.transform, x: source.transform.x + source.width + 50 },
      }
      reassignNodeIds(clone.root)
      commit((d) => ({ ...d, cabinets: [...d.cabinets, clone] }))
      set({ selection: { cabinetId: clone.id, nodeId: clone.root.id } })
    },

    removeCabinet: (id) => {
      commit((d) => ({ ...d, cabinets: d.cabinets.filter((c) => c.id !== id) }))
      const remaining = get().design.cabinets[0]
      set({ selection: { cabinetId: remaining?.id, nodeId: remaining?.root.id } })
    },

    updateWorktop: (id, patch) =>
      commit((design) => ({
        ...design,
        worktops: design.worktops.map((wt) => (wt.id === id ? { ...wt, ...patch } : wt)),
      })),

    addWorktop: () => {
      const wt = newWorktop({ name: `Worktop ${get().design.worktops.length + 1}` })
      commit((d) => ({ ...d, worktops: [...d.worktops, wt] }))
      set({ selection: { worktopId: wt.id, cabinetId: undefined, nodeId: undefined } })
    },

    removeWorktop: (id) =>
      commit((d) => ({ ...d, worktops: d.worktops.filter((w) => w.id !== id) })),

    splitCell: (cabinetId, nodeId, dir) => {
      const cab = get().design.cabinets.find((c) => c.id === cabinetId)
      if (!cab) return
      const thickness =
        get().design.materials.find((m) => m.id === cab.materialId)?.thickness ?? 18
      const newCellId = newId('n')

      editTree(cabinetId, (root) =>
        replaceNode(root, nodeId, (node) => ({
          id: newId('n'),
          kind: 'split',
          dir,
          dividerThickness: thickness,
          sizes: [flex(1), flex(1)],
          // Keep the existing contents as the first child rather than discarding
          // the work that is already there, and give the new child the same
          // contents. Splitting a run of shelves is how you add a vertical spacer
          // to it, and you almost always want the shelves to carry on past the
          // divider — re-adding them by hand every time is just busywork.
          children: [node, { id: newCellId, kind: 'cell', content: contentToRepeat(node) }],
        })),
      )
      set({ selection: { cabinetId, nodeId: newCellId } })
    },

    addSplitChild: (cabinetId, nodeId) =>
      editTree(cabinetId, (root) =>
        replaceNode(root, nodeId, (node) => {
          if (node.kind !== 'split') return node
          // Match the bay next to it, for the same reason as splitCell.
          const previous = node.children[node.children.length - 1]
          return {
            ...node,
            children: [
              ...node.children,
              { id: newId('n'), kind: 'cell', content: contentToRepeat(previous) },
            ],
            sizes: [...node.sizes, flex(1)],
          }
        }),
      ),

    removeSplitChild: (cabinetId, splitId, index) =>
      editTree(cabinetId, (root) =>
        replaceNode(root, splitId, (node) => {
          if (node.kind !== 'split') return node
          const children = node.children.filter((_, i) => i !== index)
          const sizes = node.sizes.filter((_, i) => i !== index)
          // A split with one child left is just that child.
          if (children.length === 1) return children[0]
          if (children.length === 0) return emptyCell()
          return { ...node, children, sizes }
        }),
      ),

    setChildSize: (cabinetId, splitId, index, size) =>
      editTree(cabinetId, (root) =>
        replaceNode(root, splitId, (node) => {
          if (node.kind !== 'split') return node
          const sizes = [...node.sizes]
          sizes[index] = size
          return { ...node, sizes }
        }),
      ),

    setDividerThickness: (cabinetId, splitId, thickness) =>
      editTree(cabinetId, (root) =>
        replaceNode(root, splitId, (node) =>
          node.kind === 'split' ? { ...node, dividerThickness: thickness } : node,
        ),
      ),

    setContent: (cabinetId, nodeId, content) =>
      editTree(cabinetId, (root) =>
        replaceNode(root, nodeId, (node) =>
          node.kind === 'cell' ? { ...node, content } : node,
        ),
      ),

    updateSettings: (patch) =>
      commit((design) => ({ ...design, settings: { ...design.settings, ...patch } })),

    addMaterial: () =>
      commit((design) => ({
        ...design,
        materials: [...design.materials, newMaterial(design.materials)],
      })),

    updateMaterial: (id, patch) =>
      commit((design) => ({
        ...design,
        materials: design.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),

    removeMaterial: (id) =>
      commit((design) => {
        // Refuse rather than silently re-thickness every panel that used it.
        if (countMaterialUsage(design, id) > 0 || design.materials.length <= 1) return design
        return { ...design, materials: design.materials.filter((m) => m.id !== id) }
      }),
  }
})

/**
 * What a new bay should contain when you divide an existing one.
 *
 * A cell repeats its own contents; a split repeats whatever its first leaf holds, so
 * dividing an already-divided run still gives you a matching bay rather than a hole.
 */
function contentToRepeat(node: FurnitureNode): Content {
  if (node.kind === 'cell') return structuredClone(node.content)
  const firstLeaf = node.children.find((child) => child.kind === 'cell')
  return firstLeaf && firstLeaf.kind === 'cell'
    ? structuredClone(firstLeaf.content)
    : { type: 'empty' }
}

/** After a structuredClone the node ids are duplicates — give the copy fresh ones. */
function reassignNodeIds(node: FurnitureNode): void {
  node.id = newId('n')
  if (node.kind === 'split') for (const child of node.children) reassignNodeIds(child)
}

/** Convenience selectors used across the UI. */
export const selectActiveCabinet = (state: AppState): Cabinet | undefined =>
  state.design.cabinets.find((c) => c.id === state.selection.cabinetId)

export const selectActiveNode = (state: AppState): FurnitureNode | undefined => {
  const cab = selectActiveCabinet(state)
  if (!cab || !state.selection.nodeId) return undefined
  return findNode(cab.root, state.selection.nodeId) ?? undefined
}

export const selectActiveParent = (state: AppState) => {
  const cab = selectActiveCabinet(state)
  if (!cab || !state.selection.nodeId) return null
  return findParent(cab.root, state.selection.nodeId)
}
