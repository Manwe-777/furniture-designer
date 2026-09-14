import type { PanelDrilling } from './holes'
import { mm } from './geom'

/** Build volume to design the jig for. Defaults to a Prusa MK4. */
export interface BedSize {
  length: number
  width: number
}

export const PRUSA_MK4: BedSize = { length: 250, width: 210 }

/**
 * The two pieces you print.
 *
 * `start` carries the end stop and establishes the first hole on a panel. `continue`
 * has no end stop, because once it is off the panel's bottom edge the stop would sit
 * on the panel face and lift the jig clear of the work — so every setup after the
 * first indexes off the last hole drilled instead. Dropping the stop also frees the
 * dead length before the first hole, so the continuation jig fits more positions.
 */
export type JigVariant = 'start' | 'continue'

export interface JigVariantSpec {
  positions: number
  /** How far up the panel one setup reaches. */
  reachMm: number
  /** Printed size, so it can be checked against the bed before slicing. */
  size: { length: number; width: number; height: number }
}

export interface JigSpec {
  /** Panel depth this jig is cut for. */
  panelWidth: number
  frontSetback: number
  backSetback: number
  pitch: number
  holeDiameter: number
  /** Distance from the end stop to the first hole. */
  firstHole: number
  start: JigVariantSpec
  continue: JigVariantSpec
  bed: BedSize
  panels: string[]
}

// Fixed geometry, mirrored in the generated source.
const MARGIN = 14
const FENCE_T = 6
const WALL_H = 14
const PLATE_T = 8
const END_T = 6
const BED_CLEARANCE = 10

/**
 * A single row of holes, and the jig is reversible.
 *
 * Drilling both rows in one setup means the plate has to span the whole panel depth —
 * for a 300mm panel that is a 282mm-wide part, which does not fit a normal printer.
 * A single-row jig is about 50mm wide instead, and because the fence and end stop
 * stand proud on BOTH faces you flip it over to drill the back row: the fence then
 * hooks the back edge, giving the same setback from that edge, and the hole heights
 * are unchanged because flipping about the long axis does not move them along it.
 *
 * One extra flip per panel, in exchange for a jig that actually prints.
 */
export function jigSpecs(
  panels: PanelDrilling[],
  bed: BedSize = PRUSA_MK4,
  depthTolerance = 3,
): JigSpec[] {
  // Panels of near-enough the same depth share a jig. A millimetre of edge banding
  // does not deserve its own print. The first-hole distance is different: it is what
  // the end stop registers, so panels that disagree on it need their own jig.
  const groups: PanelDrilling[][] = []
  for (const panel of [...panels].sort((a, b) => a.width - b.width)) {
    const first = panel.gridHeights[0] ?? panel.grid.origin
    const target = groups.find((g) => {
      const gFirst = g[0].gridHeights[0] ?? g[0].grid.origin
      return Math.abs(g[0].width - panel.width) <= depthTolerance && gFirst === first
    })
    if (target) target.push(panel)
    else groups.push([panel])
  }

  return groups
    .map((list) => {
      const { grid, gridHeights } = list[0]
      const firstHole = gridHeights[0] ?? grid.origin
      const width = Math.round(Math.min(...list.map((p) => p.width)))

      const available = Math.max(bed.length, bed.width) - BED_CLEARANCE
      const cap = Math.max(...list.map((p) => p.gridHeights.length))
      const jigWidth = mm(grid.frontSetback + MARGIN + FENCE_T)
      const jigHeight = mm(PLATE_T + WALL_H * 2)

      // The start jig spends `firstHole` of its length before the first hole, to
      // reach back to the end stop. The continuation jig does not, so it fits more.
      const fit = (deadLength: number, extra: number) =>
        Math.max(
          1,
          Math.min(cap, Math.floor((available - extra - deadLength - MARGIN) / grid.pitch) + 1),
        )

      const startPositions = fit(firstHole, END_T)
      const continuePositions = fit(MARGIN, 0)

      return {
        panelWidth: width,
        frontSetback: grid.frontSetback,
        backSetback: grid.backSetback,
        pitch: grid.pitch,
        holeDiameter: grid.diameter,
        firstHole,
        start: {
          positions: startPositions,
          reachMm: (startPositions - 1) * grid.pitch,
          size: {
            length: mm(firstHole + (startPositions - 1) * grid.pitch + MARGIN + END_T),
            width: jigWidth,
            height: jigHeight,
          },
        },
        continue: {
          positions: continuePositions,
          // One position is spent landing on the last hole drilled.
          reachMm: (continuePositions - 1) * grid.pitch,
          size: {
            length: mm(MARGIN * 2 + (continuePositions - 1) * grid.pitch),
            width: jigWidth,
            height: jigHeight,
          },
        },
        bed,
        panels: list.map((p) => `${p.cabinetName} — ${p.label}`),
      }
    })
    .sort((a, b) => a.panelWidth - b.panelWidth)
}

function header(spec: JigSpec, variant: JigVariant, c: string): string {
  const v = spec[variant]
  const isStart = variant === 'start'

  return `${c} Shelf-pin drilling jig — ${isStart ? 'START (with end stop)' : 'CONTINUE (no end stop)'}
${c} ${spec.panels.length} panel(s), ${spec.panelWidth}mm deep:
${spec.panels.map((p) => `${c}   ${p}`).join('\n')}
${c}
${c} PRINTS AT ${v.size.length} x ${v.size.width} x ${v.size.height} mm  (bed ${spec.bed.length} x ${spec.bed.width})
${c}
${c} YOU NEED BOTH PIECES. The end stop is what puts the first hole in the right
${c} place, but the moment the jig moves off the panel's bottom edge that same stop
${c} lands on the panel face and lifts the jig clear of the work. So:
${c}   1. START jig    — end stop on the bottom edge, drill its ${spec.start.positions} holes.
${c}   2. CONTINUE jig — no stop, so it lies flat anywhere. Drop a ${spec.holeDiameter}mm pin through
${c}                     its FIRST hole into the LAST hole you drilled, clamp, drill the
${c}                     rest. Repeat up the panel. No cumulative error.
${c}
${c} HOW THIS ONE REGISTERS
${c}   fence    -> hooks over a long edge, setting the ${spec.frontSetback}mm setback${
    isStart
      ? `
${c}   end stop -> butts the panel's BOTTOM edge, first hole at ${spec.firstHole}mm`
      : `
${c}   (no end stop — indexed by a pin in the last hole drilled)`
  }
${c}   reaches ${v.reachMm}mm of panel per setup.
${c}
${c} IT IS REVERSIBLE — the walls stand proud on both faces.
${c}   Front row: fence on the FRONT edge.
${c}   Back row:  flip it over, turning it like a page so the ends stay put. The
${c}              fence then hooks the BACK edge and gives the same ${spec.backSetback}mm from
${c}              it, and the hole heights do not move.
${c}
${c} DRILL DEPTH — READ THIS
${c}   The jig adds its own thickness to the bit's travel. Set your depth collar so
${c}   the bit protrudes plate_t + (the hole depth you want).
${c}   On 15mm panels do not exceed 10mm of hole or you will come out the far side.`
}

/** The jig as OpenSCAD source. */
export function jigScad(
  spec: JigSpec,
  designName: string,
  variant: JigVariant = 'start',
): string {
  const v = spec[variant]
  const withStop = variant === 'start'
  return `${header(spec, variant, '//')}
//
// ${designName}

pitch      = ${spec.pitch};    // hole spacing — the 32mm system
hole_d     = ${spec.holeDiameter};     // drill diameter
setback    = ${spec.frontSetback};    // hole centre to the fence face
first_hole = ${withStop ? spec.firstHole : MARGIN};    // ${withStop ? 'end stop face to the first hole' : 'plate end to the first hole'}
positions  = ${v.positions};     // hole positions on this jig
end_stop   = ${withStop ? 'true' : 'false'};  // the START jig has one; the CONTINUE jig must not

plate_t    = ${PLATE_T};     // jig thickness. ADDS TO YOUR BIT DEPTH.
bushing_d  = 0;     // 0 = plain printed hole; else pocket dia for a steel bushing
bushing_t  = 6;     // how deep that pocket goes

fence_t    = ${FENCE_T};     // fence wall thickness
wall_h     = ${WALL_H};    // fence and end stop stand proud this much EACH side
end_t      = ${END_T};     // end stop thickness
margin     = ${MARGIN};    // material past the outermost hole

// ---------------------------------------------------------------------------

plate_l = first_hole + (positions - 1) * pitch + margin;
plate_w = setback + margin;
wall_z  = plate_t + wall_h * 2;   // spans both faces, so the jig can be flipped

module jig() {
  difference() {
    union() {
      cube([plate_l, plate_w, plate_t]);
      // fence — hooks a long edge, standing proud both sides
      translate([0, -fence_t, -wall_h]) cube([plate_l, fence_t, wall_z]);
      // end stop — only on the START jig; on the CONTINUE jig it would sit on the
      // panel face mid-run and lift the whole thing off the work
      if (end_stop)
        translate([-end_t, -fence_t, -wall_h]) cube([end_t, plate_w + fence_t, wall_z]);
    }
    for (i = [0 : positions - 1])
      translate([first_hole + i * pitch, setback, -1]) {
        cylinder(h = plate_t + 2, d = hole_d, $fn = 48);
        if (bushing_d > 0)
          translate([0, 0, plate_t + 1 - bushing_t])
            cylinder(h = bushing_t + 1, d = bushing_d, $fn = 48);
      }
  }
}

jig();
`
}

/**
 * The same jig as a FreeCAD macro.
 *
 * OpenSCAD is the lingua franca for printable jigs, but it is another program to
 * install. This builds the identical solid through FreeCAD's Part API, so anyone who
 * already has FreeCAD can run it — and it can be checked headlessly with
 * `freecadcmd`, which a .scad file cannot be without the OpenSCAD binary.
 */
export function jigFreecadMacro(
  spec: JigSpec,
  designName: string,
  variant: JigVariant = 'start',
): string {
  const v = spec[variant]
  const withStop = variant === 'start'
  return `${header(spec, variant, '#')}
#
# ${designName}
#
# In FreeCAD: Macro -> Macros... -> create, paste this, Execute. Then File -> Export
# and pick STL. Or set EXPORT_STL below to a path and just run it.

import FreeCAD as App
import Part

pitch      = ${spec.pitch}    # hole spacing - the 32mm system
hole_d     = ${spec.holeDiameter}     # drill diameter
setback    = ${spec.frontSetback}    # hole centre to the fence face
first_hole = ${withStop ? spec.firstHole : MARGIN}    # ${withStop ? 'end stop face to the first hole' : 'plate end to the first hole'}
positions  = ${v.positions}     # hole positions on this jig
end_stop   = ${withStop ? 'True' : 'False'}  # the START jig has one; the CONTINUE jig must not

plate_t   = ${PLATE_T}.0   # jig thickness. ADDS TO YOUR BIT DEPTH.
bushing_d = 0.0   # 0 = plain printed hole; else pocket dia for a steel bushing
bushing_t = 6.0   # how deep that pocket goes

fence_t = ${FENCE_T}.0
wall_h  = ${WALL_H}.0   # fence and end stop stand proud this much EACH side
end_t   = ${END_T}.0
margin  = ${MARGIN}.0

EXPORT_STL = ""   # set to a file path to also write an STL

# ---------------------------------------------------------------------------

plate_l = first_hole + (positions - 1) * pitch + margin
plate_w = setback + margin
wall_z = plate_t + wall_h * 2

plate = Part.makeBox(plate_l, plate_w, plate_t)
fence = Part.makeBox(plate_l, fence_t, wall_z, App.Vector(0, -fence_t, -wall_h))
body = plate.fuse(fence)

# The end stop is only on the START jig. On the CONTINUE jig it would sit on the
# panel face mid-run and lift the whole thing off the work.
if end_stop:
    stop = Part.makeBox(end_t, plate_w + fence_t, wall_z,
                        App.Vector(-end_t, -fence_t, -wall_h))
    body = body.fuse(stop)

cutters = []
for i in range(positions):
    x = first_hole + i * pitch
    cutters.append(Part.makeCylinder(hole_d / 2.0, plate_t + 2.0,
                                     App.Vector(x, setback, -1.0)))
    if bushing_d > 0:
        cutters.append(Part.makeCylinder(bushing_d / 2.0, bushing_t + 1.0,
                                         App.Vector(x, setback, plate_t - bushing_t)))

body = body.cut(Part.makeCompound(cutters))

doc = App.ActiveDocument or App.newDocument("ShelfPinJig")
obj = doc.addObject("Part::Feature", "ShelfPinJig")
obj.Shape = body
doc.recompute()

bb = body.BoundBox
print("jig: %d holes, %.1f x %.1f x %.1f mm, valid=%s"
      % (positions, bb.XLength, bb.YLength, bb.ZLength, body.isValid()))
print("bed ${spec.bed.length} x ${spec.bed.width}: fits=%s"
      % (bb.XLength <= ${spec.bed.length} and bb.YLength <= ${spec.bed.width}))

if EXPORT_STL:
    import Mesh
    Mesh.export([obj], EXPORT_STL)
    print("wrote " + EXPORT_STL)
`
}

/**
 * A jig for drilling into the EDGE of a panel — minifix bolts, or dowels.
 *
 * This is a different problem from the shelf-pin holes. Those go in the FACE of a
 * vertical panel, 37mm in from its front edge. These go into the narrow edge of an
 * 18mm board and have to come out centred on its thickness and square in two
 * directions at once, which is the one hole nobody drills accurately by hand.
 *
 * The jig straddles the edge: legs down both faces, a thick top plate spanning them,
 * and the guide hole at half the panel thickness. A fence at one end sets how far
 * along the edge the hole lands — use it from one side of the panel, then turn the
 * jig end for end and use it from the other, and the two holes come out symmetric
 * about the panel's centre without measuring either of them.
 */
export interface EdgeJigSpec {
  panelThickness: number
  holeDiameter: number
  /** Hole centre from the fence face, i.e. from the panel's side edge. */
  fromEdge: number
  size: { length: number; width: number; height: number }
  bed: BedSize
}

const EDGE_LEG_T = 8
const EDGE_LEG_H = 22
const EDGE_PLATE_T = 12
const EDGE_FENCE_T = 6
const EDGE_MARGIN = 16

export function edgeJigSpec(
  panelThickness: number,
  holeDiameter: number,
  fromEdge = 50,
  bed: BedSize = PRUSA_MK4,
): EdgeJigSpec {
  return {
    panelThickness,
    holeDiameter,
    fromEdge,
    size: {
      length: mm(fromEdge + EDGE_MARGIN + EDGE_FENCE_T),
      width: mm(panelThickness + EDGE_LEG_T * 2),
      height: mm(EDGE_PLATE_T + EDGE_LEG_H),
    },
    bed,
  }
}

function edgeHeader(spec: EdgeJigSpec, c: string): string {
  return `${c} Edge-drilling jig — for ${spec.panelThickness}mm panels
${c}
${c} PRINTS AT ${spec.size.length} x ${spec.size.width} x ${spec.size.height} mm  (bed ${spec.bed.length} x ${spec.bed.width})
${c}
${c} WHAT IT IS FOR
${c}   A ${spec.holeDiameter}mm hole into the EDGE of a panel, centred at ${mm(spec.panelThickness / 2)}mm
${c}   and square in both directions. Minifix bolts, or 8mm tarugos.
${c}   NOT for shelf pins — those go in the FACE, 37mm from the front edge.
${c}
${c} HOW TO USE IT
${c}   1. Sit the jig over the panel edge so the legs straddle both faces.
${c}   2. Press it firmly against ONE face — always the same one, the inside face —
${c}      and clamp. MDF thickness varies by a few tenths; referencing the same face
${c}      every time means any variation lands identically on both mating panels,
${c}      which is what actually matters.
${c}   3. Butt the fence against the panel's side edge. The hole lands ${spec.fromEdge}mm along.
${c}   4. For the second hole, turn the jig end for end and work from the other side
${c}      edge. The two holes come out symmetric about the middle, unmeasured.
${c}
${c} DRILL DEPTH
${c}   The plate is ${EDGE_PLATE_T}mm thick and sits on top of the edge, so set your depth collar
${c}   to ${EDGE_PLATE_T}mm + the hole depth you want. A minifix bolt usually wants about 34mm.`
}

/** Edge-drilling jig as OpenSCAD source. */
export function edgeJigScad(spec: EdgeJigSpec, designName: string): string {
  return `${edgeHeader(spec, '//')}
//
// ${designName}

panel_t   = ${spec.panelThickness};    // panel thickness — the slot straddles this
bit_d     = ${spec.holeDiameter};     // hole diameter. CHECK THIS against your minifix bolt.
from_edge = ${spec.fromEdge};    // hole centre to the fence face
slot_play = 0.3;   // so it slides on; press against one face and it does not matter

plate_t   = ${EDGE_PLATE_T};    // guide thickness — more is straighter
leg_t     = ${EDGE_LEG_T};
leg_h     = ${EDGE_LEG_H};
fence_t   = ${EDGE_FENCE_T};
margin    = ${EDGE_MARGIN};
bushing_d = 0;     // 0 = plain printed hole; else pocket dia for a steel bushing
bushing_t = 8;

// ---------------------------------------------------------------------------

slot_w  = panel_t + slot_play;
total_w = slot_w + leg_t * 2;
total_l = from_edge + margin;

module edge_jig() {
  difference() {
    union() {
      // top plate — spans the edge and guides the bit
      translate([0, -leg_t, 0]) cube([total_l, total_w, plate_t]);
      // legs — straddle both faces
      translate([0, -leg_t, -leg_h]) cube([total_l, leg_t, leg_h]);
      translate([0, slot_w, -leg_h]) cube([total_l, leg_t, leg_h]);
      // fence — butts the panel's side edge
      translate([-fence_t, -leg_t, -leg_h]) cube([fence_t, total_w, leg_h + plate_t]);
    }
    // Centred on the PANEL, measured from the reference wall at y=0 — not on the
    // slot, which is slightly wider so the jig slides on. Press the jig against
    // that one face and the hole lands at exactly panel_t/2 every time.
    translate([from_edge, panel_t / 2, -1]) {
      cylinder(h = plate_t + 2, d = bit_d, $fn = 48);
      if (bushing_d > 0)
        translate([0, 0, plate_t + 1 - bushing_t])
          cylinder(h = bushing_t + 1, d = bushing_d, $fn = 48);
    }
  }
}

edge_jig();
`
}

/** Edge-drilling jig as a FreeCAD macro. */
export function edgeJigFreecadMacro(spec: EdgeJigSpec, designName: string): string {
  return `${edgeHeader(spec, '#')}
#
# ${designName}
#
# In FreeCAD: Macro -> Macros... -> create, paste this, Execute. Then File -> Export
# and pick STL. Or set EXPORT_STL below to a path and just run it.

import FreeCAD as App
import Part

panel_t   = ${spec.panelThickness}.0   # panel thickness — the slot straddles this
bit_d     = ${spec.holeDiameter}.0    # hole diameter. CHECK against your minifix bolt.
from_edge = ${spec.fromEdge}.0   # hole centre to the fence face
slot_play = 0.3

plate_t   = ${EDGE_PLATE_T}.0
leg_t     = ${EDGE_LEG_T}.0
leg_h     = ${EDGE_LEG_H}.0
fence_t   = ${EDGE_FENCE_T}.0
margin    = ${EDGE_MARGIN}.0
bushing_d = 0.0
bushing_t = 8.0

EXPORT_STL = ""   # set to a file path to also write an STL

# ---------------------------------------------------------------------------

slot_w = panel_t + slot_play
total_w = slot_w + leg_t * 2
total_l = from_edge + margin

plate = Part.makeBox(total_l, total_w, plate_t, App.Vector(0, -leg_t, 0))
leg_a = Part.makeBox(total_l, leg_t, leg_h, App.Vector(0, -leg_t, -leg_h))
leg_b = Part.makeBox(total_l, leg_t, leg_h, App.Vector(0, slot_w, -leg_h))
fence = Part.makeBox(fence_t, total_w, leg_h + plate_t,
                     App.Vector(-fence_t, -leg_t, -leg_h))
body = plate.fuse(leg_a).fuse(leg_b).fuse(fence)

# Centred on the PANEL, measured from the reference wall at y=0 — not on the slot,
# which is slightly wider so the jig slides on. Press the jig against that one face
# and the hole lands at exactly panel_t/2 every time.
cutters = [Part.makeCylinder(bit_d / 2.0, plate_t + 2.0,
                             App.Vector(from_edge, panel_t / 2.0, -1.0))]
if bushing_d > 0:
    cutters.append(Part.makeCylinder(bushing_d / 2.0, bushing_t + 1.0,
                                     App.Vector(from_edge, panel_t / 2.0,
                                                plate_t - bushing_t)))
body = body.cut(Part.makeCompound(cutters))

doc = App.ActiveDocument or App.newDocument("EdgeJig")
obj = doc.addObject("Part::Feature", "EdgeJig")
obj.Shape = body
doc.recompute()

bb = body.BoundBox
print("edge jig: %.1f x %.1f x %.1f mm, hole %.1fmm at %.1fmm centre, valid=%s"
      % (bb.XLength, bb.YLength, bb.ZLength, bit_d, panel_t / 2.0, body.isValid()))
print("bed ${spec.bed.length} x ${spec.bed.width}: fits=%s"
      % (bb.XLength <= ${spec.bed.length} and bb.YLength <= ${spec.bed.width}))

if EXPORT_STL:
    import Mesh
    Mesh.export([obj], EXPORT_STL)
    print("wrote " + EXPORT_STL)
`
}
