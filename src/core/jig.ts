import type { PanelDrilling, ShelfEdgeHoles } from './holes'
import type { PanelJoints } from './joints'
import { mm } from './geom'
import type { JointFixing } from './types'

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
export type EdgeJigKind = 'shelf-pin' | 'minifix'

export interface EdgeJigSpec {
  /** What this one is for. The numbers differ completely between the two uses. */
  kind: EdgeJigKind
  panelThickness: number
  holeDiameter: number
  /** Hole centres from the fence face, i.e. from the panel's side edge. */
  holes: number[]
  /** How deep to go into the edge. */
  depth: number
  /**
   * Material left either side of the hole. Under about 3mm the bit breaks out
   * through the face instead of staying in the edge, and the jig is worse than
   * useless — it drills a confidently placed hole in the wrong place.
   */
  wall: number
  /** Parts this one is for. Empty for the generic minifix jig. */
  panels: string[]
  size: { length: number; width: number; height: number }
  bed: BedSize
}

/** Below this much material either side of the hole, the edge will blow out. */
export const MIN_EDGE_WALL = 3

/**
 * One edge jig per panel thickness the design actually uses.
 *
 * The slot has to match the board, and the guide hole is at half the board's
 * thickness, so a jig made for 18mm stock puts the hole 1.5mm off centre on a 15mm
 * divider — which on an 8mm hole leaves 2mm of material and breaks out. A carcass
 * is not always one thickness, so neither is this.
 */
export function edgeJigSpecs(
  thicknesses: number[],
  holeDiameter: number,
  fromEdge = 50,
  bed: BedSize = PRUSA_MK4,
): EdgeJigSpec[] {
  return dedupe(thicknesses.filter((t) => t > 0)).map((t) =>
    edgeJigSpec(t, holeDiameter, fromEdge, bed),
  )
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
  return makeEdgeJig('minifix', panelThickness, holeDiameter, [fromEdge], 34, [], bed)
}

function makeEdgeJig(
  kind: EdgeJigKind,
  panelThickness: number,
  holeDiameter: number,
  holes: number[],
  depth: number,
  panels: string[],
  bed: BedSize,
): EdgeJigSpec {
  return {
    kind,
    panelThickness,
    holeDiameter,
    holes,
    depth,
    wall: mm((panelThickness - holeDiameter) / 2),
    panels,
    size: {
      length: mm(Math.max(...holes) + EDGE_MARGIN + EDGE_FENCE_T),
      width: mm(panelThickness + EDGE_LEG_T * 2),
      height: mm(EDGE_PLATE_T + EDGE_LEG_H),
    },
    bed,
  }
}

/**
 * Edge jigs for pinning shelves — the other half of the 32mm grid.
 *
 * The face jig drills the rows in the side panels. If the pins are meant to capture
 * the shelf rather than just hold it up, the shelf's two ENDS need matching holes,
 * centred on its thickness and at the same distance from the front edge the rows
 * already are. One jig does both ends and both rows, because the rows are symmetric
 * about the panel's middle: fence on the front edge for one, turn it end for end
 * for the other.
 *
 * The distances come from the schedule, which read them off the side panels — not
 * from the grid directly, because a shelf set back from the carcass front does not
 * share the side panel's front face.
 */
export function shelfPinEdgeJigSpecs(
  groups: { edge: ShelfEdgeHoles; count: number }[],
  bed: BedSize = PRUSA_MK4,
): EdgeJigSpec[] {
  const parts = new Map<string, EdgeJigSpec>()

  for (const { edge } of groups) {
    const key = `${edge.thickness}|${edge.diameter}|${edge.fromNearestEdge.join(',')}`
    const found = parts.get(key)
    if (found) {
      const name = `${edge.cabinetName} — ${edge.label}`
      if (!found.panels.includes(name)) found.panels.push(name)
      continue
    }
    parts.set(
      key,
      makeEdgeJig(
        'shelf-pin',
        edge.thickness,
        edge.diameter,
        edge.fromNearestEdge,
        edge.depth,
        [`${edge.cabinetName} — ${edge.label}`],
        bed,
      ),
    )
  }

  return [...parts.values()].sort((a, b) => a.panelThickness - b.panelThickness)
}

function edgeHeader(spec: EdgeJigSpec, c: string): string {
  const pins = spec.kind === 'shelf-pin'
  return `${c} Edge-drilling jig — ${pins ? 'SHELF PINS' : 'minifix / dowels'}, ${spec.panelThickness}mm panels
${spec.panels.length ? `${spec.panels.map((p) => `${c}   ${p}`).join('\n')}
${c}
` : ''}${c} PRINTS AT ${spec.size.length} x ${spec.size.width} x ${spec.size.height} mm  (bed ${spec.bed.length} x ${spec.bed.width})
${c}
${c} WHAT IT IS FOR${
    pins
      ? `
${c}   The OTHER half of the 32mm grid. The face jig put the rows in your side
${c}   panels; this puts the matching holes in the ENDS of the shelves, so the pins
${c}   capture the shelf instead of just holding it up.
${c}   ${spec.holeDiameter}mm, centred at ${mm(spec.panelThickness / 2)}mm on the ${spec.panelThickness}mm edge, ${spec.holes.join(' and ')}mm in from the edge.
${c}   Those distances are not the grid's ${spec.holes.length === 1 ? 'setback' : 'setbacks'} by assumption — they were read off
${c}   the side panels this shelf actually sits between, so a shelf set back from the
${c}   carcass front still lines up.`
      : `
${c}   A ${spec.holeDiameter}mm hole into the EDGE of a panel, centred at ${mm(spec.panelThickness / 2)}mm
${c}   and square in both directions. Minifix bolts, or 8mm tarugos.
${c}   NOT for shelf pins — there is a separate jig for those, with the grid's
${c}   setbacks on it rather than this one's.
${c}   NOT for confirmats either — those are drilled through the other panel and on
${c}   into this edge in one pass, so there is nothing here to pre-drill.`
  }
${c}
${c} THIS JIG IS CUT FOR ${spec.panelThickness}mm AND ONLY ${spec.panelThickness}mm
${c}   The slot straddles ${spec.panelThickness}mm and the guide sits at ${mm(spec.panelThickness / 2)}mm. Use it on a thinner
${c}   board and the hole comes out off centre by exactly half the difference — on a
${c}   15mm board an 18mm jig leaves 2mm of material and breaks out through the face.
${c}   Check the number above against the board in your hand before you clamp it.${
    spec.wall < MIN_EDGE_WALL
      ? `
${c}
${c} *** THIS COMBINATION DOES NOT WORK ***
${c}   A ${spec.holeDiameter}mm hole in a ${spec.panelThickness}mm edge leaves ${spec.wall}mm either side. It will break out.
${c}   Use a smaller bit, or fix this joint some other way.`
      : `
${c}   Material either side of the hole: ${spec.wall}mm.`
  }
${c}
${c} HOW TO USE IT
${c}   1. Sit the jig over the panel edge so the legs straddle both faces.
${c}   2. Press it firmly against ONE face — always the same one, the inside face —
${c}      and clamp. MDF thickness varies by a few tenths; referencing the same face
${c}      every time means any variation lands identically on both mating parts,
${c}      which is what actually matters.
${c}   3. Butt the fence against the ${pins ? 'FRONT' : "panel's side"} edge. The ${spec.holes.length === 1 ? 'hole lands' : 'holes land'} ${spec.holes.join(', ')}mm along.
${c}   4. Turn the jig end for end, fence on the ${pins ? 'BACK' : 'other side'} edge, and repeat.
${c}      The holes come out symmetric about the middle, unmeasured.${
    pins
      ? `
${c}   5. Both ENDS of the shelf get the same two holes. Four per shelf.
${c}
${c} ONE THING TO KNOW BEFORE YOU DRILL
${c}   A hole centred on the edge seats the shelf's MIDDLE on the pin, not its
${c}   underside. So every shelf ends up ${mm(spec.panelThickness / 2)}mm lower than the drawing shows.
${c}   That is the same ${mm(spec.panelThickness / 2)}mm for every shelf, so the openings stay even and it
${c}   usually does not matter — but if it does, move the grid origin up by ${mm(spec.panelThickness / 2)}mm
${c}   before you drill the sides.`
      : ''
  }
${c}
${c} DRILL DEPTH
${c}   The plate is ${EDGE_PLATE_T}mm thick and sits on top of the edge, so set your depth collar
${c}   to ${EDGE_PLATE_T}mm + ${spec.depth}mm = ${mm(EDGE_PLATE_T + spec.depth)}mm.${
    pins
      ? `
${c}   ${spec.depth}mm is a starting point. What it has to swallow is however much of your
${c}   pin stands proud of the side panel — measure one and add 2mm.`
      : `
${c}   A minifix bolt usually wants about 34mm.`
  }`
}

/** Edge-drilling jig as OpenSCAD source. */
export function edgeJigScad(spec: EdgeJigSpec, designName: string): string {
  return `${edgeHeader(spec, '//')}
//
// ${designName}

panel_t   = ${spec.panelThickness};    // panel thickness — the slot straddles this
bit_d     = ${spec.holeDiameter};     // hole diameter. ${spec.kind === 'shelf-pin' ? 'CHECK THIS against your shelf pin.' : 'CHECK THIS against your minifix bolt.'}
holes     = [${spec.holes.join(', ')}];  // hole centres from the fence face
slot_play = 0.3;   // so it slides on; press against one face and it does not matter

plate_t   = ${EDGE_PLATE_T};    // guide thickness — more is straighter
leg_t     = ${EDGE_LEG_T};
leg_h     = ${EDGE_LEG_H};
fence_t   = ${EDGE_FENCE_T};
margin    = ${EDGE_MARGIN};
bushing_d = 0;     // 0 = plain printed hole; else pocket dia for a steel bushing
bushing_t = 8;

// ---------------------------------------------------------------------------

n_holes = len(holes);
slot_w  = panel_t + slot_play;
total_w = slot_w + leg_t * 2;
total_l = max(holes) + margin;

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
    for (i = [0 : n_holes - 1])
      translate([holes[i], panel_t / 2, -1]) {
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
bit_d     = ${spec.holeDiameter}.0    # hole diameter. ${spec.kind === 'shelf-pin' ? 'CHECK against your shelf pin.' : 'CHECK against your minifix bolt.'}
holes     = [${spec.holes.map((h) => `${h}.0`).join(', ')}]   # hole centres from the fence face
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
total_l = max(holes) + margin

plate = Part.makeBox(total_l, total_w, plate_t, App.Vector(0, -leg_t, 0))
leg_a = Part.makeBox(total_l, leg_t, leg_h, App.Vector(0, -leg_t, -leg_h))
leg_b = Part.makeBox(total_l, leg_t, leg_h, App.Vector(0, slot_w, -leg_h))
fence = Part.makeBox(fence_t, total_w, leg_h + plate_t,
                     App.Vector(-fence_t, -leg_t, -leg_h))
body = plate.fuse(leg_a).fuse(leg_b).fuse(fence)

# Centred on the PANEL, measured from the reference wall at y=0 — not on the slot,
# which is slightly wider so the jig slides on. Press the jig against that one face
# and the hole lands at exactly panel_t/2 every time.
cutters = []
for x in holes:
    cutters.append(Part.makeCylinder(bit_d / 2.0, plate_t + 2.0,
                                     App.Vector(x, panel_t / 2.0, -1.0)))
    if bushing_d > 0:
        cutters.append(Part.makeCylinder(bushing_d / 2.0, bushing_t + 1.0,
                                         App.Vector(x, panel_t / 2.0,
                                                    plate_t - bushing_t)))
body = body.cut(Part.makeCompound(cutters))

doc = App.ActiveDocument or App.newDocument("EdgeJig")
obj = doc.addObject("Part::Feature", "EdgeJig")
obj.Shape = body
doc.recompute()

bb = body.BoundBox
print("edge jig: %.1f x %.1f x %.1f mm, %d x %.1fmm hole(s) at %.1fmm centre, valid=%s"
      % (bb.XLength, bb.YLength, bb.ZLength, len(holes), bit_d, panel_t / 2.0,
         body.isValid()))
print("bed ${spec.bed.length} x ${spec.bed.width}: fits=%s"
      % (bb.XLength <= ${spec.bed.length} and bb.YLength <= ${spec.bed.width}))

if EXPORT_STL:
    import Mesh
    Mesh.export([obj], EXPORT_STL)
    print("wrote " + EXPORT_STL)
`
}

/**
 * A jig for drilling the CARCASS fixings — the holes that hold the thing together.
 *
 * This is the third drilling problem, and the one the other two jigs cannot help
 * with. A shelf pin goes in the face of a vertical panel; a minifix bolt goes into
 * the edge of one. A carcass fixing goes THROUGH a board and on into the edge of
 * whatever stands against it, which means the hole has to land on a 15 or 18mm edge
 * that is somewhere under the board where you cannot see it.
 *
 * The jig deliberately does NOT try to find that position along the board. Nothing
 * printable can: the centre of a divider 1401.84mm along a 2090mm board is a number
 * you cannot transfer with a tape, and if you could, the board itself is only cut to
 * ±1mm. Instead you stand the parts on the board, pencil them, and the jig does the
 * two things a pencil line cannot: it sets the distance in from the front edge, and
 * it holds the bit square. A sight slot down its centreline is how it meets the line.
 */
export interface ConfirmatJigSpec {
  /** Panel widths — front to back — this one printed part serves. */
  boardWidths: number[]
  /** Guide hole centres, measured from the fence face. */
  holes: number[]
  /** Hole positions the schedule wants on the board, from the front edge. */
  covers: number[]
  /**
   * Positions this jig cannot reach without outgrowing the bed — always middle
   * fixings on a deep panel.
   *
   * Dropping them is sound rather than a compromise. The hole lands on an edge that
   * runs the panel's whole width, so how far in from the front it sits has
   * centimetres of slack; it is the position ALONG the board that has millimetres,
   * and that comes from the pencil line, not from this jig.
   */
  omitted: number[]
  /**
   * Both outer fixings come off one short jig, turned end for end to work from the
   * back edge. False when the back edge carries a rebate and cannot be registered
   * against, in which case the jig has to reach the whole way across.
   */
  turnable: boolean
  clearance: number
  pilot: number
  pilotDepth: number
  head: { diameter: number; depth: number } | null
  /** Thickest board this jig will be used on, for the bit-depth note. */
  boardThickness: number
  size: { length: number; width: number; height: number }
  bed: BedSize
  panels: string[]
}

const FACE_PLATE_T = 12
const FACE_SPAN = 70
const FACE_FENCE_T = 8
const FACE_LEG_H = 20
const FACE_MARGIN = 14
const SIGHT_SLOT_W = 1.6
const SIGHT_BRIDGE = 7
const COLLAR = 5

/**
 * One jig per distinct set of hole positions, not one per panel.
 *
 * Panels of the same width end up with the same row of fixings, so they share a
 * jig. Where the row is symmetric about the panel's middle — which it is unless the
 * back panel pushed the rear fixing inwards — only the distances from the NEAREST
 * edge need printing: a 299mm board with fixings at 50 and 249 needs a jig that
 * reaches 50mm, used from the front edge and then from the back. That is a 72mm
 * print instead of a 271mm one that would not fit the bed at all.
 */
export function confirmatJigSpecs(
  panels: PanelJoints[],
  fixing: JointFixing,
  bed: BedSize = PRUSA_MK4,
): ConfirmatJigSpec[] {
  const groups = new Map<string, { panels: PanelJoints[]; vs: number[] }>()

  for (const panel of panels) {
    for (const joint of panel.joints) {
      // Joints at a board's end belong to the end-stop jig, which places them
      // exactly. This one exists only for uprights that land mid-board.
      if (joint.fromEnd !== null) continue
      const vs = joint.holes.map((h) => h.v)
      const key = `${Math.round(panel.width)}|${vs.join(',')}|${panel.rebated}`
      const group = groups.get(key)
      if (group) {
        if (!group.panels.includes(panel)) group.panels.push(panel)
      } else {
        groups.set(key, { panels: [panel], vs })
      }
    }
  }

  // A row of fixings produces a guide distance; several different rows often
  // produce the SAME one, because the distance in from the edge does not vary with
  // how deep the panel is. Those are one printed part, so they are merged — four
  // identical 72mm jigs is exactly the waste the pin jig grouping already avoids.
  const parts = new Map<string, ConfirmatJigSpec>()

  for (const { panels: list, vs } of groups.values()) {
    const width = Math.round(Math.min(...list.map((p) => p.width)))
    const turnable = list.every((p) => !p.rebated)

    // Measuring each hole from whichever edge is nearer collapses a symmetric row
    // to half its reach, and duplicates vanish.
    const nearest = turnable
      ? dedupe(vs.map((v) => mm(Math.min(v, width - v))))
      : dedupe(vs)

    // Anything that would not print is dropped rather than quietly generating a
    // part nobody can make. Keep the shortest guide even if nothing fits, so the
    // jig still does the job it is really for — holding the bit square.
    const maxReach = Math.max(bed.length, bed.width) - BED_CLEARANCE
    const fitting = nearest.filter((h) => h + FACE_MARGIN + FACE_FENCE_T <= maxReach)
    const holes = fitting.length > 0 ? fitting : [nearest[0]]

    const reachable = new Set<number>()
    for (const h of holes) {
      reachable.add(h)
      if (turnable) reachable.add(mm(width - h))
    }
    const covers = dedupe(vs)
    const omitted = covers.filter((v) => ![...reachable].some((r) => Math.abs(r - v) < 0.6))

    const key = `${holes.join(',')}|${turnable}|${fixing.clearance}`
    const existing = parts.get(key)
    const merged: ConfirmatJigSpec = existing ?? {
      boardWidths: [],
      holes,
      covers: [],
      omitted: [],
      turnable,
      clearance: fixing.clearance,
      pilot: fixing.pilot,
      pilotDepth: 0,
      head: fixing.head.diameter > 0 ? { ...fixing.head } : null,
      boardThickness: 0,
      size: {
        length: mm(Math.max(...holes) + FACE_MARGIN + FACE_FENCE_T),
        width: FACE_SPAN,
        height: mm(FACE_PLATE_T + FACE_LEG_H),
      },
      bed,
      panels: [],
    }

    merged.boardWidths = dedupe([...merged.boardWidths, width])
    merged.covers = dedupe([...merged.covers, ...covers])
    merged.omitted = dedupe([...merged.omitted, ...omitted])
    merged.boardThickness = Math.max(
      merged.boardThickness,
      ...list.map((p) => p.thickness),
    )
    // The bit has to clear the thickest board this one part will be used on.
    merged.pilotDepth = mm(
      fixing.length - merged.boardThickness + (merged.head?.depth ?? 0) + 3,
    )
    for (const p of list) {
      const name = `${p.cabinetName} — ${p.label}`
      if (!merged.panels.includes(name)) merged.panels.push(name)
    }
    parts.set(key, merged)
  }

  return [...parts.values()].sort((a, b) => a.size.length - b.size.length)
}

const dedupe = (values: number[]): number[] =>
  [...values].sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > 0.5)

function confirmatHeader(spec: ConfirmatJigSpec, c: string): string {
  const total = mm(FACE_PLATE_T + spec.boardThickness + spec.pilotDepth)
  return `${c} Carcass fixing jig — MID-BOARD uprights. The ones you have to mark.
${c} ${spec.panels.length} panel(s), ${spec.boardWidths.join('/')}mm front to back:
${spec.panels.map((p) => `${c}   ${p}`).join('\n')}
${c}
${c} PRINTS AT ${spec.size.length} x ${spec.size.width} x ${spec.size.height} mm  (bed ${spec.bed.length} x ${spec.bed.width})
${c}
${c} USE THE END-STOP JIG FIRST
${c}   Every upright standing flush with a board's END is placed exactly by the other
${c}   jig — an end stop, no marking. This one is for the uprights that land in the
${c}   MIDDLE, where there is nothing to register against.
${c}
${c} WHAT IT DOES AND WHAT IT DOES NOT DO
${c}   It sets the distance in from the front edge, and it holds the bit square.
${c}   It does NOT find the position along the board. Nothing printable can — the
${c}   centre of a divider can land on a fraction of a millimetre a metre and a half
${c}   along, and your board is only cut to about a millimetre anyway.
${c}
${c} SO SET OUT FROM THE PARTS, NOT FROM A TAPE MEASURE
${c}   1. Lay the board on the bench, INSIDE face up.
${c}   2. Stand the sides and dividers on it where they belong, each one butted
${c}      against the part before it — the shelves are usually cut to exactly the
${c}      opening and make perfect gauges. Check the drilling page: it lists the
${c}      order and which part gauges each gap. Starting from the END panel, which
${c}      the other jig has already located for you, costs you nothing.
${c}   3. Pencil both sides of every upright, and carry each mark over the FRONT
${c}      edge with one stroke.
${c}   4. Turn the board over. Put the jig's fence on the front edge and line the
${c}      sight slot up with the mark you carried over. Clamp. Drill.
${c}   Every position now comes from parts that exist, so the error is the saw's and
${c}   not the tape's, and it cannot accumulate.
${c}
${c} HOLES
${c}   ${spec.holes.map((h) => `${h}mm from the fence`).join(', ')} — ${mm(spec.clearance)}mm clearance${
    spec.turnable
      ? `
${c}   Turn the jig end for end and put the fence on the BACK edge for the rest of
${c}   the row. Same setting, so both fixings sit the same distance in.`
      : `
${c}   The back edge is rebated for the back panel, so the fence cannot register on
${c}   it — this jig reaches the whole way across instead.`
  }
${c}   Guided: ${spec.covers.filter((v) => !spec.omitted.includes(v)).map((v) => `${v}mm`).join(', ')} from the front edge.${
    spec.omitted.length > 0
      ? `
${c}
${c}   BY EYE: ${spec.omitted.map((v) => `${v}mm`).join(', ')}
${c}   Guiding ${spec.omitted.length === 1 ? 'that one' : 'those'} would take a part longer than the bed. Mark ${spec.omitted.length === 1 ? 'it' : 'them'} on the same
${c}   pencil line and drill freehand — and do not worry about it: the edge underneath
${c}   runs the panel's whole width, so how far in from the front these sit has
${c}   centimetres of slack. It is the position ALONG the board that has millimetres,
${c}   and that comes from the line, which this jig is not setting either way.`
      : ''
  }
${c}
${c} DRILLING IT
${c}   Clamp the assembly with the upright standing where its pencil lines say, and
${c}   drill clearance and pilot in ONE PASS with a ${mm(spec.clearance)}/${mm(spec.pilot)}mm stepped confirmat
${c}   bit. One pass is the point of this joint: the pilot is drilled down the hole
${c}   that just guided it, so the two cannot be out of line with each other.
${c}   Without a stepped bit: ${mm(spec.clearance)}mm through the board first, then the ${mm(spec.pilot)}mm pilot
${c}   through that same hole with the parts clamped. Not the other way round.
${c}
${c} DRILL DEPTH — READ THIS
${c}   The plate adds its own thickness to the bit's travel. Through the plate, the
${c}   ${spec.boardThickness}mm board and ${spec.pilotDepth}mm into the edge is ${total}mm of bit, so set the collar
${c}   there and check your bit is long enough before you start.${
    spec.head
      ? `
${c}
${c} THE HEAD
${c}   Counterbore ${spec.head.diameter}mm x ${spec.head.depth}mm AFTERWARDS, with the jig off — a ${spec.head.diameter}mm bit will
${c}   not fit the ${mm(spec.clearance)}mm guide. The clearance hole centres it for you.`
      : ''
  }`
}

/** Carcass fixing jig as OpenSCAD source. */
export function confirmatJigScad(spec: ConfirmatJigSpec, designName: string): string {
  return `${confirmatHeader(spec, '//')}
//
// ${designName}

holes     = [${spec.holes.join(', ')}];  // guide centres from the fence face
clearance = ${spec.clearance};     // through-hole. CHECK against your confirmat shank.
plate_t   = ${FACE_PLATE_T};    // guide thickness. ADDS TO YOUR BIT DEPTH.
bushing_d = 0;     // 0 = plain printed hole; else pocket dia for a steel bushing
bushing_t = 8;

fence_t   = ${FACE_FENCE_T};     // fence wall thickness
leg_h     = ${FACE_LEG_H};    // how far the fence hangs below the plate
plate_w   = ${FACE_SPAN};    // how much of the board's length the jig covers
margin    = ${FACE_MARGIN};    // material past the outermost hole
slot_w    = ${SIGHT_SLOT_W};   // sight slot — line this up with your pencil mark
bridge    = ${SIGHT_BRIDGE};     // solid material left at the far end of the slot
collar    = ${COLLAR};     // solid material around each guide hole

// ---------------------------------------------------------------------------

n_holes = len(holes);
plate_l = max(holes) + margin;
axis_y  = plate_w / 2;

module face_jig() {
  difference() {
    union() {
      // plate, with the sight slot cut down its centreline. The slot stops short
      // of the far end so the two halves stay joined there as well as at the
      // collars — a slot straight through would saw the jig in two.
      difference() {
        cube([plate_l, plate_w, plate_t]);
        translate([-1, axis_y - slot_w / 2, -1])
          cube([plate_l - bridge + 1, slot_w, plate_t + 2]);
      }
      // fence — hooks the front edge, hanging below the plate only. Slotted
      // through its full height so you can also sight a mark on the edge itself.
      difference() {
        translate([-fence_t, 0, -leg_h]) cube([fence_t, plate_w, leg_h + plate_t]);
        translate([-fence_t - 1, axis_y - slot_w / 2, -leg_h - 1])
          cube([fence_t + 2, slot_w, leg_h + plate_t + 2]);
      }
      // collars put material back around each guide hole, so the slot never
      // weakens the part of the plate that actually steers the bit
      for (i = [0 : n_holes - 1])
        translate([holes[i], axis_y, 0])
          cylinder(h = plate_t, d = clearance + collar * 2, $fn = 48);
    }
    for (i = [0 : n_holes - 1])
      translate([holes[i], axis_y, -1]) {
        cylinder(h = plate_t + 2, d = clearance, $fn = 48);
        if (bushing_d > 0)
          translate([0, 0, plate_t + 1 - bushing_t])
            cylinder(h = bushing_t + 1, d = bushing_d, $fn = 48);
      }
  }
}

face_jig();
`
}

/** Carcass fixing jig as a FreeCAD macro. */
export function confirmatJigFreecadMacro(
  spec: ConfirmatJigSpec,
  designName: string,
): string {
  return `${confirmatHeader(spec, '#')}
#
# ${designName}
#
# In FreeCAD: Macro -> Macros... -> create, paste this, Execute. Then File -> Export
# and pick STL. Or set EXPORT_STL below to a path and just run it.

import FreeCAD as App
import Part

holes     = [${spec.holes.map((h) => `${h}.0`).join(', ')}]   # guide centres from the fence face
clearance = ${spec.clearance}.0    # through-hole. CHECK against your confirmat shank.
plate_t   = ${FACE_PLATE_T}.0   # guide thickness. ADDS TO YOUR BIT DEPTH.
bushing_d = 0.0
bushing_t = 8.0

fence_t = ${FACE_FENCE_T}.0
leg_h   = ${FACE_LEG_H}.0
plate_w = ${FACE_SPAN}.0
margin  = ${FACE_MARGIN}.0
slot_w  = ${SIGHT_SLOT_W}
bridge  = ${SIGHT_BRIDGE}.0
collar  = ${COLLAR}.0

EXPORT_STL = ""   # set to a file path to also write an STL

# ---------------------------------------------------------------------------

plate_l = max(holes) + margin
axis_y = plate_w / 2.0

# Plate, less the sight slot. The slot stops short of the far end so the two halves
# stay joined there as well as at the collars.
plate = Part.makeBox(plate_l, plate_w, plate_t)
plate = plate.cut(
    Part.makeBox(plate_l - bridge + 1.0, slot_w, plate_t + 2.0,
                 App.Vector(-1.0, axis_y - slot_w / 2.0, -1.0)))

# Fence, slotted through its full height so a mark on the edge itself can be sighted.
fence = Part.makeBox(fence_t, plate_w, leg_h + plate_t,
                     App.Vector(-fence_t, 0.0, -leg_h))
fence = fence.cut(
    Part.makeBox(fence_t + 2.0, slot_w, leg_h + plate_t + 2.0,
                 App.Vector(-fence_t - 1.0, axis_y - slot_w / 2.0, -leg_h - 1.0)))

body = plate.fuse(fence)

# Collars put material back around each guide hole.
for x in holes:
    body = body.fuse(Part.makeCylinder((clearance + collar * 2) / 2.0, plate_t,
                                       App.Vector(x, axis_y, 0.0)))

cutters = []
for x in holes:
    cutters.append(Part.makeCylinder(clearance / 2.0, plate_t + 2.0,
                                     App.Vector(x, axis_y, -1.0)))
    if bushing_d > 0:
        cutters.append(Part.makeCylinder(bushing_d / 2.0, bushing_t + 1.0,
                                         App.Vector(x, axis_y, plate_t - bushing_t)))
body = body.cut(Part.makeCompound(cutters))
body = body.removeSplitter()

doc = App.ActiveDocument or App.newDocument("CarcassJig")
obj = doc.addObject("Part::Feature", "CarcassJig")
obj.Shape = body
doc.recompute()

bb = body.BoundBox
print("carcass jig: %d guide(s) at %s, %.1f x %.1f x %.1f mm, valid=%s"
      % (len(holes), holes, bb.XLength, bb.YLength, bb.ZLength, body.isValid()))
print("bed ${spec.bed.length} x ${spec.bed.width}: fits=%s"
      % (bb.XLength <= ${spec.bed.length} and bb.YLength <= ${spec.bed.width}))

if EXPORT_STL:
    import Mesh
    Mesh.export([obj], EXPORT_STL)
    print("wrote " + EXPORT_STL)
`
}

/**
 * A jig for the carcass fixings at a board's ENDS.
 *
 * Most carcass joints are not mid-board at all: a side panel stands flush with the
 * end of the top and bottom it sits between, so its centre is exactly half its own
 * thickness in from that end — 9mm on an 18mm side. That is a number an end stop
 * can hold, which makes these the joints you never have to mark. The sight-slot jig
 * is for the ones that land in the middle, where nothing but a pencil line can
 * place them; this one is for the rest, and it is the more accurate of the two.
 *
 * Two references, two stops: the end stop finds the position along the board, the
 * fence finds the distance in from the front edge. Both stand proud on BOTH faces,
 * so one small print does all four corners of a board — flip it about the end stop
 * to work the other end, flip it about the fence to work from the back edge.
 */
export interface EndJigSpec {
  /** End stop face to the guide — half the thickness of the panel standing there. */
  fromEnd: number
  mateThickness: number
  /** Guide centres from the fence face. */
  holes: number[]
  /** Positions across the width this reaches, from the front edge. */
  covers: number[]
  /** Positions it cannot reach without outgrowing the bed. */
  omitted: number[]
  clearance: number
  pilot: number
  pilotDepth: number
  head: { diameter: number; depth: number } | null
  boardThickness: number
  boardWidths: number[]
  size: { length: number; width: number; height: number }
  bed: BedSize
  panels: string[]
}

const END_PLATE_T = 12
const END_WALL_H = 14
const END_FENCE_T = 8
const END_STOP_T = 8
const END_MARGIN = 16
/** Keep the plate long enough along the board to sit flat, not teeter on the stop. */
const END_MIN_LEN = 45

export function endJigSpecs(
  panels: PanelJoints[],
  fixing: JointFixing,
  bed: BedSize = PRUSA_MK4,
): EndJigSpec[] {
  const parts = new Map<string, EndJigSpec>()
  const maxReach = Math.max(bed.length, bed.width) - BED_CLEARANCE

  for (const panel of panels) {
    for (const joint of panel.joints) {
      if (joint.fromEnd === null) continue

      const width = Math.round(panel.width)
      const vs = joint.holes.map((h) => h.v)
      // The fence works from either edge, so each hole is only ever as far from a
      // fence as the nearer edge — unless the back edge is rebated and unusable.
      const nearest = panel.rebated
        ? dedupe(vs)
        : dedupe(vs.map((v) => mm(Math.min(v, width - v))))
      const fitting = nearest.filter((h) => h + END_MARGIN + END_FENCE_T <= maxReach)
      const holes = fitting.length > 0 ? fitting : [nearest[0]]

      const reachable = new Set<number>()
      for (const h of holes) {
        reachable.add(h)
        if (!panel.rebated) reachable.add(mm(width - h))
      }
      const covers = dedupe(vs)
      const omitted = covers.filter((v) => ![...reachable].some((r) => Math.abs(r - v) < 0.6))

      const key = `${joint.fromEnd}|${holes.join(',')}|${fixing.clearance}`
      const existing = parts.get(key)
      const spec: EndJigSpec = existing ?? {
        fromEnd: joint.fromEnd,
        mateThickness: joint.mateThickness,
        holes,
        covers: [],
        omitted: [],
        clearance: fixing.clearance,
        pilot: fixing.pilot,
        pilotDepth: 0,
        head: fixing.head.diameter > 0 ? { ...fixing.head } : null,
        boardThickness: 0,
        boardWidths: [],
        size: {
          length: mm(Math.max(joint.fromEnd + END_MARGIN, END_MIN_LEN) + END_STOP_T),
          width: mm(Math.max(...holes) + END_MARGIN + END_FENCE_T),
          height: mm(END_PLATE_T + END_WALL_H * 2),
        },
        bed,
        panels: [],
      }

      spec.covers = dedupe([...spec.covers, ...covers])
      spec.omitted = dedupe([...spec.omitted, ...omitted])
      spec.boardWidths = dedupe([...spec.boardWidths, width])
      spec.boardThickness = Math.max(spec.boardThickness, panel.thickness)
      spec.pilotDepth = mm(
        fixing.length - spec.boardThickness + (spec.head?.depth ?? 0) + 3,
      )
      const name = `${panel.cabinetName} — ${panel.label}`
      if (!spec.panels.includes(name)) spec.panels.push(name)
      parts.set(key, spec)
    }
  }

  return [...parts.values()].sort((a, b) => a.fromEnd - b.fromEnd)
}

function endHeader(spec: EndJigSpec, c: string): string {
  const total = mm(END_PLATE_T + spec.boardThickness + spec.pilotDepth)
  return `${c} Carcass fixing jig — END joints. Two stops, nothing to mark.
${c} ${spec.panels.length} board(s), ${spec.boardWidths.join('/')}mm front to back:
${spec.panels.map((p) => `${c}   ${p}`).join('\n')}
${c}
${c} PRINTS AT ${spec.size.length} x ${spec.size.width} x ${spec.size.height} mm  (bed ${spec.bed.length} x ${spec.bed.width})
${c}
${c} THIS IS THE ACCURATE ONE — USE IT WHEREVER IT FITS
${c}   A side panel stands flush with the end of the board it sits between, so its
${c}   centre is half its own thickness in from that end: ${spec.fromEnd}mm on your ${spec.mateThickness}mm sides.
${c}   An end stop holds that exactly. No pencil line, no tape, no accumulated
${c}   error — butt it up and drill.
${c}   The other jig, the one with the sight slot, is only for uprights that land in
${c}   the MIDDLE of a board, where there is nothing to register against.
${c}
${c} HOW IT REGISTERS
${c}   end stop -> butts the board's END, guide at ${spec.fromEnd}mm
${c}   fence    -> hooks the FRONT edge, guide${spec.holes.length === 1 ? '' : 's'} at ${spec.holes.join(', ')}mm
${c}
${c} IT DOES ALL FOUR CORNERS — BOTH WALLS STAND PROUD ON BOTH FACES
${c}   Near end, front edge:  as printed.
${c}   Far end, front edge:   flip it over about the END STOP. The stop then butts
${c}                          the other end and the fence still hooks the front.
${c}   Near end, back edge:   flip it over about the FENCE instead. The fence hooks
${c}                          the back edge, the stop stays on the same end.
${c}   Far end, back edge:    flip it both ways.
${c}   The guide never moves relative to the two walls, so every corner comes out at
${c}   the same ${spec.fromEnd}mm and ${spec.holes.join('/')}mm whichever way round it is.
${c}   Reaches: ${spec.covers.filter((v) => !spec.omitted.includes(v)).map((v) => `${v}mm`).join(', ')} from the front edge.${
    spec.omitted.length > 0
      ? `
${c}   By eye:  ${spec.omitted.map((v) => `${v}mm`).join(', ')} — too far in to guide from either edge on this bed.
${c}            Mark it off the board's end with a rule; the edge underneath runs the
${c}            panel's whole width, so that axis has centimetres of slack.`
      : ''
  }
${c}
${c} DRILLING IT
${c}   Clamp the two parts in assembly position, jig on the outside face, and drill
${c}   clearance and pilot in ONE PASS with a ${mm(spec.clearance)}/${mm(spec.pilot)}mm stepped confirmat bit.
${c}   Without a stepped bit: ${mm(spec.clearance)}mm through the board first, then the ${mm(spec.pilot)}mm pilot
${c}   through that same hole with the parts still clamped. Not the other way round.
${c}
${c} DRILL DEPTH — READ THIS
${c}   The plate adds its own thickness to the bit's travel. Through the plate, the
${c}   ${spec.boardThickness}mm board and ${spec.pilotDepth}mm into the edge is ${total}mm of bit. Set the collar there,
${c}   and check your bit is long enough before you start.${
    spec.head
      ? `
${c}
${c} THE HEAD
${c}   Counterbore ${spec.head.diameter}mm x ${spec.head.depth}mm afterwards with the jig off — a ${spec.head.diameter}mm bit will not
${c}   fit the ${mm(spec.clearance)}mm guide. The clearance hole centres it for you.`
      : ''
  }`
}

/** End-joint carcass jig as OpenSCAD source. */
export function endJigScad(spec: EndJigSpec, designName: string): string {
  return `${endHeader(spec, '//')}
//
// ${designName}

from_end  = ${spec.fromEnd};     // end stop face to the guide
holes     = [${spec.holes.join(', ')}];  // guide centres from the fence face
clearance = ${spec.clearance};     // through-hole. CHECK against your confirmat shank.
plate_t   = ${END_PLATE_T};    // guide thickness. ADDS TO YOUR BIT DEPTH.
bushing_d = 0;     // 0 = plain printed hole; else pocket dia for a steel bushing
bushing_t = 8;

fence_t   = ${END_FENCE_T};     // fence wall thickness
stop_t    = ${END_STOP_T};     // end stop thickness
wall_h    = ${END_WALL_H};    // both walls stand proud this much EACH side
margin    = ${END_MARGIN};    // material past the outermost hole
min_len   = ${END_MIN_LEN};    // keep the plate long enough to sit flat

// ---------------------------------------------------------------------------

n_holes = len(holes);
plate_l = max(from_end + margin, min_len);
plate_w = max(holes) + margin;
wall_z  = plate_t + wall_h * 2;   // spans both faces, so the jig can be flipped

module end_jig() {
  difference() {
    union() {
      cube([plate_l, plate_w, plate_t]);
      // fence — hooks the front edge
      translate([0, -fence_t, -wall_h]) cube([plate_l, fence_t, wall_z]);
      // end stop — butts the board's end, and runs past the fence so the two
      // meet in a square inside corner rather than leaving a gap at the join
      translate([-stop_t, -fence_t, -wall_h]) cube([stop_t, plate_w + fence_t, wall_z]);
    }
    for (i = [0 : n_holes - 1])
      translate([from_end, holes[i], -1]) {
        cylinder(h = plate_t + 2, d = clearance, $fn = 48);
        if (bushing_d > 0)
          translate([0, 0, plate_t + 1 - bushing_t])
            cylinder(h = bushing_t + 1, d = bushing_d, $fn = 48);
      }
  }
}

end_jig();
`
}

/** End-joint carcass jig as a FreeCAD macro. */
export function endJigFreecadMacro(spec: EndJigSpec, designName: string): string {
  return `${endHeader(spec, '#')}
#
# ${designName}
#
# In FreeCAD: Macro -> Macros... -> create, paste this, Execute. Then File -> Export
# and pick STL. Or set EXPORT_STL below to a path and just run it.

import FreeCAD as App
import Part

from_end  = ${spec.fromEnd}.0    # end stop face to the guide
holes     = [${spec.holes.map((h) => `${h}.0`).join(', ')}]   # guide centres from the fence face
clearance = ${spec.clearance}.0    # through-hole. CHECK against your confirmat shank.
plate_t   = ${END_PLATE_T}.0   # guide thickness. ADDS TO YOUR BIT DEPTH.
bushing_d = 0.0
bushing_t = 8.0

fence_t = ${END_FENCE_T}.0
stop_t  = ${END_STOP_T}.0
wall_h  = ${END_WALL_H}.0   # both walls stand proud this much EACH side
margin  = ${END_MARGIN}.0
min_len = ${END_MIN_LEN}.0

EXPORT_STL = ""   # set to a file path to also write an STL

# ---------------------------------------------------------------------------

plate_l = max(from_end + margin, min_len)
plate_w = max(holes) + margin
wall_z = plate_t + wall_h * 2

plate = Part.makeBox(plate_l, plate_w, plate_t)
fence = Part.makeBox(plate_l, fence_t, wall_z, App.Vector(0, -fence_t, -wall_h))
stop = Part.makeBox(stop_t, plate_w + fence_t, wall_z,
                    App.Vector(-stop_t, -fence_t, -wall_h))
body = plate.fuse(fence).fuse(stop)

cutters = []
for y in holes:
    cutters.append(Part.makeCylinder(clearance / 2.0, plate_t + 2.0,
                                     App.Vector(from_end, y, -1.0)))
    if bushing_d > 0:
        cutters.append(Part.makeCylinder(bushing_d / 2.0, bushing_t + 1.0,
                                         App.Vector(from_end, y, plate_t - bushing_t)))
body = body.cut(Part.makeCompound(cutters))
body = body.removeSplitter()

doc = App.ActiveDocument or App.newDocument("EndJig")
obj = doc.addObject("Part::Feature", "EndJig")
obj.Shape = body
doc.recompute()

bb = body.BoundBox
print("end jig: guide %.1fmm from the stop, %d across, %.1f x %.1f x %.1f mm, valid=%s"
      % (from_end, len(holes), bb.XLength, bb.YLength, bb.ZLength, body.isValid()))
print("bed ${spec.bed.length} x ${spec.bed.width}: fits=%s"
      % (bb.XLength <= ${spec.bed.length} and bb.YLength <= ${spec.bed.width}))

if EXPORT_STL:
    import Mesh
    Mesh.export([obj], EXPORT_STL)
    print("wrote " + EXPORT_STL)
`
}
