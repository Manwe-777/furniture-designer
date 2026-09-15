import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { designBounds } from '../../core/build/buildDesign'
import { bandingBox } from '../../core/geom'
import type { Part } from '../../core/types'
import { useStore, type Projection } from '../../state/store'

type Bounds = ReturnType<typeof designBounds>
type ViewName = 'front' | 'side' | 'top' | 'iso'

interface SceneHandle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  perspective: THREE.PerspectiveCamera
  orthographic: THREE.OrthographicCamera
  /** Whichever of the two is currently rendering. */
  camera: THREE.Camera
  controls: OrbitControls
  partGroup: THREE.Group
  raycaster: THREE.Raycaster
  /** Materials are shared between parts and reused across rebuilds. */
  materials: Map<string, THREE.Material>
  /** Half-height of the orthographic frustum, kept so resizes can rebuild it. */
  orthoHeight: number
  aspect: number
  setProjection: (projection: Projection, parts: Part[]) => void
  dispose: () => void
}

// One geometry for every panel — each mesh just scales it. Building these once at
// module level instead of per part per rebuild is the difference between a handful
// of GPU objects and a few hundred churning on every selection change.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX)

const SELECTED_COLOR = '#ff8a3d'
// A saturated teal: the board palette and the auto-assigned material colours are all
// muted wood tones, so banding has to sit outside that range to read as a coating
// rather than as another kind of board.
const BANDING_COLOR = '#1fa8b8'
// Real banding is about a millimetre. Drawn at its true thickness it would vanish
// against a 2m panel, so it is shown thicker — the edge it sits on is the
// information, not how far it stands proud.
const BANDING_DRAW_THICKNESS = 3

const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  front: [0, 0.15, 1],
  side: [1, 0.15, 0],
  top: [0, 1, 0.001],
  iso: [1, 0.8, 1],
}

/** True elevations — no tilt — for when the projection is orthographic. */
const FLAT_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  side: [1, 0, 0],
  top: [0, 1, 0.0001],
  iso: [1, 0.8, 1],
}

/**
 * Plain three.js rather than react-three-fiber: the scene is a few hundred boxes with
 * orbit and click-picking, which is less code directly than it is wiring up a
 * renderer abstraction — and it keeps the dependency list (and its peer conflicts)
 * out of the project.
 */
export function Viewport3D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<SceneHandle | null>(null)
  const framedRef = useRef(false)

  const parts = useStore((s) => s.build.parts)
  const materials = useStore((s) => s.design.materials)
  const selectedPartId = useStore((s) => s.selection.partId)
  const selectedNodeId = useStore((s) => s.selection.nodeId)
  const selectedCabinetId = useStore((s) => s.selection.cabinetId)
  const exploded = useStore((s) => s.exploded)
  const showBanding = useStore((s) => s.showBanding)
  const projection = useStore((s) => s.projection)
  const selectPart = useStore((s) => s.selectPart)

  // ---- one-time scene setup ----------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#151a21')

    const perspective = new THREE.PerspectiveCamera(45, 1, 10, 100000)
    perspective.position.set(2200, 1600, 2600)

    // Both cameras share a target and a view direction; only the projection differs.
    const orthographic = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, -50000, 100000)
    orthographic.position.copy(perspective.position)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    let controls = new OrbitControls(perspective, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.target.set(700, 400, 200)

    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(1500, 2500, 2000)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.9)
    fill.position.set(-1800, 900, -1200)
    scene.add(fill)

    const grid = new THREE.GridHelper(8000, 32, 0x3a4553, 0x242c36)
    grid.position.y = -0.5
    scene.add(grid)

    const partGroup = new THREE.Group()
    scene.add(partGroup)

    const materialCache = new Map<string, THREE.Material>()

    const handle: SceneHandle = {
      renderer,
      scene,
      perspective,
      orthographic,
      camera: perspective,
      controls,
      partGroup,
      raycaster: new THREE.Raycaster(),
      materials: materialCache,
      orthoHeight: 2000,
      aspect: 1,
      setProjection: (next, currentParts) => {
        const wanted = next === 'orthographic' ? orthographic : perspective
        if (handle.camera === wanted) return

        // Carry the current viewing direction across, so toggling the projection
        // changes how the model is drawn without moving the viewpoint.
        const target = controls.target.clone()
        const offset = handle.camera.position.clone().sub(target)
        wanted.position.copy(target).add(offset)
        wanted.up.copy(handle.camera.up)

        handle.camera = wanted
        controls.dispose()
        controls = new OrbitControls(wanted, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.12
        controls.target.copy(target)
        handle.controls = controls
        frameBounds(handle, designBounds(currentParts))
      },
      dispose: () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        controls.dispose()
        partGroup.clear()
        grid.geometry.dispose()
        for (const material of materialCache.values()) material.dispose()
        materialCache.clear()
        renderer.dispose()
        // Hand the GPU context back explicitly. Without this Chrome can stall for
        // tens of seconds when the canvas is torn down — switching tabs would
        // appear to freeze the whole app.
        renderer.forceContextLoss()
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement)
        }
      },
    }

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      handle.controls.update()
      renderer.render(scene, handle.camera)
    }
    animate()

    const resize = () => {
      const { clientWidth, clientHeight } = container
      if (clientWidth === 0 || clientHeight === 0) return
      renderer.setSize(clientWidth, clientHeight, false)
      const aspect = clientWidth / clientHeight
      handle.aspect = aspect
      perspective.aspect = aspect
      perspective.updateProjectionMatrix()
      applyOrthoFrustum(handle)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    handleRef.current = handle

    return () => {
      handleRef.current?.dispose()
      handleRef.current = null
    }
  }, [])

  // ---- projection toggle --------------------------------------------------
  useEffect(() => {
    handleRef.current?.setProjection(projection, parts)
    // `parts` is only read to frame the view; re-running on every part change
    // would fight the user's camera, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection])

  // ---- rebuild meshes whenever the parts change ---------------------------
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return

    const { partGroup, materials: cache } = handle
    partGroup.clear()

    const surface = (color: string, selected: boolean): THREE.Material => {
      const key = `s|${color}|${selected}`
      let material = cache.get(key)
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(selected ? SELECTED_COLOR : color),
          roughness: 0.75,
          metalness: 0.02,
          emissive: new THREE.Color(selected ? 0x4a2000 : 0x000000),
        })
        cache.set(key, material)
      }
      return material
    }

    const outline = (selected: boolean): THREE.Material => {
      const key = `e|${selected}`
      let material = cache.get(key)
      if (!material) {
        material = new THREE.LineBasicMaterial({ color: selected ? 0xffd9b0 : 0x2b3138 })
        cache.set(key, material)
      }
      return material
    }

    const colors = new Map(materials.map((m) => [m.id, m.color]))
    const bounds = designBounds(parts)
    const centre = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ] as const

    for (const part of parts) {
      const isSelected =
        part.id === selectedPartId ||
        (!!selectedNodeId && part.nodeId === selectedNodeId) ||
        (!selectedNodeId && !selectedPartId && part.cabinetId === selectedCabinetId)

      const mesh = new THREE.Mesh(
        UNIT_BOX,
        surface(colors.get(part.materialId) ?? '#c9a87c', isSelected),
      )

      const [px, py, pz] = part.box.pos
      const [sx, sy, sz] = part.box.size
      mesh.scale.set(sx, sy, sz)

      // Exploded view pushes each part away from the centre of the whole design,
      // so you can see inside without hiding anything.
      const cx = px + sx / 2
      const cy = py + sy / 2
      const cz = pz + sz / 2
      mesh.position.set(
        cx + (cx - centre[0]) * exploded,
        cy + (cy - centre[1]) * exploded,
        cz + (cz - centre[2]) * exploded,
      )
      mesh.userData.partId = part.id
      partGroup.add(mesh)

      const edges = new THREE.LineSegments(UNIT_EDGES, outline(isSelected))
      edges.scale.copy(mesh.scale)
      edges.position.copy(mesh.position)
      partGroup.add(edges)

      if (showBanding) {
        const offset = [
          mesh.position.x - (px + sx / 2),
          mesh.position.y - (py + sy / 2),
          mesh.position.z - (pz + sz / 2),
        ] as const

        for (const [along, sides] of [
          ['length', part.edgeBanding.alongLength],
          ['width', part.edgeBanding.alongWidth],
        ] as const) {
          sides.forEach((banded, side) => {
            if (!banded) return
            const b = bandingBox(
              part.box,
              part.thicknessAxis,
              part.lengthAxis,
              along,
              side as 0 | 1,
              BANDING_DRAW_THICKNESS,
            )
            const strip = new THREE.Mesh(UNIT_BOX, surface(BANDING_COLOR, false))
            strip.scale.set(b.size[0], b.size[1], b.size[2])
            strip.position.set(
              b.pos[0] + b.size[0] / 2 + offset[0],
              b.pos[1] + b.size[1] / 2 + offset[1],
              b.pos[2] + b.size[2] / 2 + offset[2],
            )
            partGroup.add(strip)
          })
        }
      }
    }

    // Frame the design the first time there is something to look at.
    if (!framedRef.current && parts.length > 0) {
      framedRef.current = true
      frameBounds(handle, bounds)
    }
  }, [parts, materials, exploded, showBanding, selectedPartId, selectedNodeId, selectedCabinetId])

  // ---- click to select ----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let downAt: { x: number; y: number } | null = null

    const onPointerDown = (event: PointerEvent) => {
      downAt = { x: event.clientX, y: event.clientY }
    }

    const onPointerUp = (event: PointerEvent) => {
      const handle = handleRef.current
      if (!downAt || !handle) return
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
      downAt = null
      // Ignore the pointer-up that ends an orbit drag.
      if (moved > 4) return

      const rect = container.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      handle.raycaster.setFromCamera(pointer, handle.camera)
      const hits = handle.raycaster.intersectObjects(handle.partGroup.children, false)
      const hit = hits.find((h) => h.object.userData.partId)
      if (hit) selectPart(hit.object.userData.partId as string)
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointerup', onPointerUp)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointerup', onPointerUp)
    }
  }, [selectPart])

  const setProjectionMode = useStore((s) => s.setProjection)

  return (
    <div className="viewport">
      <div ref={containerRef} className="viewport-canvas" />
      <div className="viewport-overlay">
        <div className="segmented">
          <button
            type="button"
            className={projection === 'perspective' ? 'active' : ''}
            onClick={() => setProjectionMode('perspective')}
            title="Perspective — how it looks in the room"
          >
            Persp
          </button>
          <button
            type="button"
            className={projection === 'orthographic' ? 'active' : ''}
            onClick={() => setProjectionMode('orthographic')}
            title="Orthographic — no perspective, so front/side/top are true elevations"
          >
            Ortho
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const handle = handleRef.current
            if (handle) frameBounds(handle, designBounds(parts))
          }}
          title="Fit the whole design in view"
        >
          Fit
        </button>
        {(Object.keys(VIEW_DIRECTIONS) as ViewName[]).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setView(handleRef.current, parts, view, projection)}
          >
            {view[0].toUpperCase() + view.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Rebuild the orthographic frustum from the stored height and the current aspect. */
function applyOrthoFrustum(handle: SceneHandle): void {
  const halfHeight = handle.orthoHeight / 2
  const halfWidth = halfHeight * handle.aspect
  const ortho = handle.orthographic
  ortho.left = -halfWidth
  ortho.right = halfWidth
  ortho.top = halfHeight
  ortho.bottom = -halfHeight
  ortho.updateProjectionMatrix()
}

function centreOf(bounds: Bounds): THREE.Vector3 {
  return new THREE.Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  )
}

function radiusOf(bounds: Bounds): number {
  return Math.max(
    400,
    Math.hypot(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ) / 2,
  )
}

/**
 * Fit the design in view. Perspective moves the camera back; orthographic has no
 * notion of distance, so it widens the frustum instead.
 */
function frameBounds(handle: SceneHandle, bounds: Bounds): void {
  const centre = centreOf(bounds)
  const radius = radiusOf(bounds)

  const direction = handle.camera.position.clone().sub(handle.controls.target).normalize()
  if (direction.lengthSq() === 0) direction.set(1, 0.8, 1).normalize()

  handle.controls.target.copy(centre)

  if (handle.camera === handle.orthographic) {
    // Stay well clear of the model; the frustum, not the distance, sets the scale.
    handle.camera.position.copy(centre).addScaledVector(direction, radius * 4)
    handle.camera.lookAt(centre)
    handle.camera.updateMatrixWorld()

    // Measure how much of the screen the model actually covers from here, rather
    // than falling back on the 3D diagonal — otherwise a wide, flat elevation is
    // framed for a depth it does not have and ends up small and adrift.
    const right = new THREE.Vector3().setFromMatrixColumn(handle.camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(handle.camera.matrixWorld, 1)
    let halfAcross = 0
    let halfDown = 0
    for (const x of [bounds.min[0], bounds.max[0]]) {
      for (const y of [bounds.min[1], bounds.max[1]]) {
        for (const z of [bounds.min[2], bounds.max[2]]) {
          const corner = new THREE.Vector3(x, y, z).sub(centre)
          halfAcross = Math.max(halfAcross, Math.abs(corner.dot(right)))
          halfDown = Math.max(halfDown, Math.abs(corner.dot(up)))
        }
      }
    }

    const margin = 1.12
    handle.orthoHeight = Math.max(
      100,
      2 * halfDown * margin,
      (2 * halfAcross * margin) / Math.max(handle.aspect, 0.01),
    )
    applyOrthoFrustum(handle)
  } else {
    const distance = radius / Math.sin((handle.perspective.fov * Math.PI) / 360)
    handle.camera.position.copy(centre).addScaledVector(direction, distance * 1.1)
    handle.perspective.updateProjectionMatrix()
  }

  handle.controls.update()
}

function setView(
  handle: SceneHandle | null,
  parts: Part[],
  view: ViewName,
  projection: Projection,
): void {
  if (!handle) return
  // Orthographic gets the untilted direction, so front/side/top are true elevations.
  const table = projection === 'orthographic' ? FLAT_DIRECTIONS : VIEW_DIRECTIONS
  const bounds = designBounds(parts)
  const centre = centreOf(bounds)
  const direction = new THREE.Vector3(...table[view]).normalize()

  handle.controls.target.copy(centre)
  handle.camera.position.copy(centre).addScaledVector(direction, radiusOf(bounds) * 4)
  handle.controls.update()
  frameBounds(handle, bounds)
}
