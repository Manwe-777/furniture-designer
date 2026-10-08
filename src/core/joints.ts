import { buildCabinet } from './build/buildCabinet'
import { materialLookup } from './build/buildDesign'
import { mm } from './geom'
import type { PanelDrilling } from './holes'
import type { Axis, Design, JointFixing, Part, PartRole } from './types'

/**
 * A carcass joint hole, in the coordinates of the panel being drilled.
 *
 * One hole, two diameters. The fixing passes THROUGH this panel and on into the
 * mating panel's edge, so the clearance hole is drilled first and the pilot is
 * drilled down the same axis without moving the work — which is the whole reason
 * this joint beats dowels in sheet goods. There is nothing to align.
 */
export interface JointHole {
  /** Along the panel's length, from the datum end. */
  u: number
  /** Across the panel's width, from the front edge. */
  v: number
  /** Through this panel. */
  clearance: number
  /** On into the mating panel's edge. */
  pilot: number
  pilotDepth: number
  /** Counterbore for the head, or null to drive it proud. */
  head: { diameter: number; depth: number } | null
  /**
   * Clear space between this hole's edge and the nearest shelf-pin hole's. Negative
   * means they overlap and one of the two will blow out. Null when the panel carries
   * no pin holes.
   */
  pinGap: number | null
}

/**
 * Which of the board's two ends this joint is flush with, if either.
 *
 * It is the difference between a joint you can place exactly and one you can only
 * mark. A panel standing flush with the board's end can be found by an end stop —
 * no measuring, no pencil, no accumulated error. A divider in the middle cannot.
 */
export type JointEnd = 'datum' | 'far' | null

export interface PanelJoint {
  mateLabel: string
  mateRole: PartRole
  /** Width of the edge the pilot goes into — what it has to stay inside. */
  mateThickness: number
  /** Centre of that edge, along the drilled panel's length. */
  centre: number
  /** How far the centre may wander before the pilot breaks out of that edge. */
  tolerance: number
  /** The board end this joint is flush with, or null when it lands mid-board. */
  atEnd: JointEnd
  /** Distance from that end to the centre. Null when it is not at an end. */
  fromEnd: number | null
  holes: JointHole[]
}

/**
 * One step in laying out a board. A `panel` step is a part standing on the board;
 * a `gap` step is the opening between two of them, and `gauge` names a part already
 * cut to exactly that length.
 */
export type SetOutStep =
  | { kind: 'panel'; label: string; size: number }
  | { kind: 'gap'; size: number; gauge: string | null }

export interface PanelJoints {
  partId: string
  cabinetName: string
  label: string
  /** Cut size of the panel you are about to drill. */
  length: number
  width: number
  thickness: number
  /** Which end `u` is measured from, in the words you would use at the bench. */
  datum: string
  /**
   * The cabinet's back sits in a groove cut near this panel's back edge, so the
   * back edge is not a reliable thing to register a jig against.
   */
  rebated: boolean
  joints: PanelJoint[]
  /**
   * Butt the parts along the panel in this order and every centre above falls out
   * of the cut sizes — no measuring along the length at all. Empty when the panel
   * has only one joint, where there is nothing to chain.
   */
  setOut: SetOutStep[]
  warnings: string[]
}

/** Two faces count as the same plane within this. */
const TOUCH = 0.6
/** Minimum overlap before two panels are considered to actually meet. */
const MEET = 1
/** Keep the outermost fixings at least this far apart. */
const MIN_SPREAD = 40
/** Never put a fixing closer than this to the front edge — it is the banded one. */
const FRONT_MIN = 15
/** Clear space to leave between a fixing and the back panel. */
const BACK_CLEAR = 3
/** Drill the pilot this much past the screw tip so it is not bottoming out in dust. */
const PILOT_OVERRUN = 3
/** Flag a fixing this close to a shelf-pin hole. */
const PIN_CLASH = 2

const AXES: Axis[] = ['x', 'y', 'z']
const IDX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

const lo = (p: Part, a: Axis) => p.box.pos[IDX[a]]
const hi = (p: Part, a: Axis) => p.box.pos[IDX[a]] + p.box.size[IDX[a]]
const span = (p: Part, a: Axis) => p.box.size[IDX[a]]
const otherAxis = (t: Axis, l: Axis) => AXES.find((a) => a !== t && a !== l)!

/**
 * Panels that are part of the carcass and therefore screwed to something.
 *
 * Adjustable shelves are excluded: they rest on pins and are fixed to nothing. A
 * fixed shelf is housed into the sides and counts.
 */
const CARCASS: PartRole[] = ['side', 'top', 'bottom', 'divider', 'shelf']
const isCarcass = (p: Part) =>
  CARCASS.includes(p.role) && (p.role !== 'shelf' || p.fixed === true)

/** Do two panels share more than a token area, ignoring the joint axis? */
function meets(a: Part, b: Part, skip: Axis): boolean {
  return AXES.filter((x) => x !== skip).every(
    (x) => Math.min(hi(a, x), hi(b, x)) - Math.max(lo(a, x), lo(b, x)) > MEET,
  )
}

/**
 * Every carcass fixing in the design, grouped by the panel it is drilled through.
 *
 * A carcass joint is always end to face: one panel's END butts the broad FACE of
 * another. The hole goes in whichever panel's face is being met, because that is
 * the one the screw has to pass through — so the search is "find a panel whose end
 * lands on this panel's face", and the answer follows the carcass style for free
 * rather than having to be special-cased for it.
 *
 * Pin holes are passed in so each fixing can be checked against them. Drilling a
 * 7mm hole through a 5mm pin hole ruins the panel, and the two schedules are worked
 * out independently, so nothing else would notice.
 */
export function buildJoints(design: Design, pins: PanelDrilling[] = []): PanelJoints[] {
  const fixing = design.settings.joints
  const mat = materialLookup(design)
  const pinsByPart = new Map(pins.map((p) => [p.partId, p]))
  const out: PanelJoints[] = []

  for (const cab of design.cabinets) {
    const { parts } = buildCabinet(cab, mat)
    const carcass = parts.filter(isCarcass)
    const back = parts.find((p) => p.role === 'back')

    for (const board of carcass) {
      const t = board.thicknessAxis
      const l = board.lengthAxis
      const w = otherAxis(t, l)
      const warnings: string[] = []

      // A panel's end lies in a plane perpendicular to its length, so only a panel
      // whose length runs along this board's thickness can butt into its face.
      const mates = carcass.filter((mate) => {
        if (mate.id === board.id || mate.lengthAxis !== t) return false
        const ends = [lo(mate, t), hi(mate, t)]
        const faces = [lo(board, t), hi(board, t)]
        return (
          ends.some((e) => faces.some((f) => Math.abs(e - f) < TOUCH)) &&
          meets(board, mate, t)
        )
      })
      if (mates.length === 0) continue

      // +Z is the front of the furniture and every carcass panel has its width
      // running front to back, so `v` is measured from the high end of the width
      // axis and the back panel, if there is one, eats into the low end.
      const backIntrusion = back
        ? Math.max(
            0,
            Math.min(hi(back, w), hi(board, w)) - Math.max(lo(back, w), lo(board, w)),
          )
        : 0
      const rearLimit =
        backIntrusion + (cab.back.style === 'rebate' ? cab.back.rebateDepth : 0) + BACK_CLEAR

      // The screw loses this panel's thickness before it reaches the edge, less
      // however far the head sinks into its counterbore.
      const head = fixing.head.diameter > 0 ? { ...fixing.head } : null
      const reach = fixing.length - board.thickness + (head?.depth ?? 0)
      if (reach < 20) {
        warnings.push(
          `A ${fixing.length}mm screw only reaches ${mm(reach)}mm into the edge through a ` +
            `${board.thickness}mm panel. Use a longer one.`,
        )
      }

      const joints = mates
        .map((mate) => {
          const edge = span(mate, l)
          const centre = mm(lo(mate, l) + edge / 2 - lo(board, l))
          const atEnd: JointEnd =
            Math.abs(lo(mate, l) - lo(board, l)) < TOUCH
              ? 'datum'
              : Math.abs(hi(mate, l) - hi(board, l)) < TOUCH
                ? 'far'
                : null
          const vs = fixingRow(board.width, span(mate, w), rearLimit, fixing, warnings)
          const pinHoles = pinsByPart.get(board.id)?.holes ?? []
          const pinRadius = (pinsByPart.get(board.id)?.grid.diameter ?? 0) / 2

          return {
            mateLabel: mate.label,
            mateRole: mate.role,
            mateThickness: mm(edge),
            centre,
            tolerance: mm((edge - fixing.pilot) / 2),
            atEnd,
            fromEnd: atEnd === null ? null : mm(edge / 2),
            holes: vs.map((v) => ({
              u: centre,
              v,
              clearance: fixing.clearance,
              pilot: fixing.pilot,
              pilotDepth: mm(reach + PILOT_OVERRUN),
              head,
              pinGap: pinHoles.length
                ? mm(
                    Math.min(
                      ...pinHoles.map((h) => Math.hypot(h.u - centre, h.v - v)),
                    ) -
                      fixing.clearance / 2 -
                      pinRadius,
                  )
                : null,
            })),
          }
        })
        .sort((a, b) => a.centre - b.centre)

      for (const joint of joints) {
        if (joint.tolerance < 1) {
          warnings.push(
            `A ${fixing.pilot}mm pilot leaves only ${joint.tolerance}mm either side of the ` +
              `${joint.mateThickness}mm ${joint.mateLabel.toLowerCase()} edge. Use a thinner pilot.`,
          )
        }
        for (const hole of joint.holes) {
          if (hole.pinGap !== null && hole.pinGap < PIN_CLASH) {
            warnings.push(
              `The fixing at ${joint.centre}mm / ${hole.v}mm is ${hole.pinGap}mm from a shelf-pin ` +
                `hole. Move the fixing, or leave that pin hole out.`,
            )
          }
        }
      }

      out.push({
        partId: board.id,
        cabinetName: cab.name,
        label: board.label,
        length: board.length,
        width: board.width,
        thickness: board.thickness,
        datum: l === 'y' ? 'bottom edge' : 'left end',
        rebated: cab.back.style === 'rebate',
        joints,
        setOut: joints.length > 1 ? setOut(board, mates, parts, l) : [],
        warnings: [...new Set(warnings)],
      })
    }
  }

  return out.sort(
    (a, b) => a.cabinetName.localeCompare(b.cabinetName) || a.label.localeCompare(b.label),
  )
}

/**
 * Where the fixings sit across the panel's width.
 *
 * The count follows the same rule the hardware list uses, so the schedule and the
 * screw count cannot disagree. The outermost two sit at the nominal setback unless
 * something is in the way — the banded front edge, or the back panel — in which
 * case they move in and the rest redistribute between them.
 */
function fixingRow(
  boardWidth: number,
  mateDepth: number,
  rearLimit: number,
  fixing: JointFixing,
  warnings: string[],
): number[] {
  const jointLength = Math.min(boardWidth, mateDepth)
  const count = Math.max(2, Math.ceil(jointLength / fixing.spacing))

  const first = Math.max(fixing.setback, FRONT_MIN)
  const last = Math.min(boardWidth - fixing.setback, boardWidth - rearLimit)

  if (last - first < MIN_SPREAD) {
    // Too narrow to spread two fixings usefully — one on the centreline, and say so.
    warnings.push(
      `${mm(boardWidth)}mm is too narrow to spread ${count} fixings at a ${fixing.setback}mm ` +
        `setback, so this joint gets one on the centreline. Add a dowel if it needs more.`,
    )
    return [mm(boardWidth / 2)]
  }

  return Array.from({ length: count }, (_, i) =>
    mm(first + (i * (last - first)) / (count - 1)),
  )
}

/**
 * The order to butt parts along a board, and which cut part gauges each opening.
 *
 * This is the answer to locating a hole 1401.84mm along a 2090mm board: you do not.
 * You stand the parts on the board against each other, pencil them, and drill the
 * lines. Error then accumulates as a sum of saw cuts rather than of tape readings,
 * and the openings are usually gauged by a shelf that is already cut to exactly
 * that length.
 */
function setOut(board: Part, mates: Part[], parts: Part[], l: Axis): SetOutStep[] {
  const steps: SetOutStep[] = []
  const origin = lo(board, l)
  const ordered = [...mates].sort((a, b) => lo(a, l) - lo(b, l))
  let cursor = 0

  const gaugeFor = (size: number): string | null =>
    parts.find(
      (p) =>
        p.id !== board.id &&
        !mates.some((m) => m.id === p.id) &&
        Math.abs(p.length - size) < 0.5,
    )?.label ?? null

  const gap = (to: number) => {
    const size = mm(to - cursor)
    if (size > 0.5) steps.push({ kind: 'gap', size, gauge: gaugeFor(size) })
  }

  for (const mate of ordered) {
    gap(mm(lo(mate, l) - origin))
    steps.push({ kind: 'panel', label: mate.label, size: span(mate, l) })
    cursor = mm(hi(mate, l) - origin)
  }
  gap(board.length)

  return steps
}

/** Total carcass fixings, for a quick sense of the job ahead. */
export function countJointHoles(panels: PanelJoints[]): number {
  return panels.reduce(
    (sum, p) => sum + p.joints.reduce((n, j) => n + j.holes.length, 0),
    0,
  )
}

export function jointsToCsv(panels: PanelJoints[]): string {
  const rows = panels.flatMap((panel) =>
    panel.joints.flatMap((joint) =>
      joint.holes.map((h) => [
        panel.cabinetName,
        panel.label,
        `${panel.length}x${panel.width}x${panel.thickness}`,
        h.u,
        h.v,
        h.clearance,
        h.pilot,
        h.pilotDepth,
        h.head ? `${h.head.diameter} x ${h.head.depth}` : 'none',
        `${joint.mateLabel} (${joint.mateThickness}mm)`,
        joint.tolerance,
      ]),
    ),
  )
  const header = [
    'Cabinet',
    'Panel drilled',
    'Cut size (mm)',
    `From the datum end (mm)`,
    'From front edge (mm)',
    'Clearance dia (mm)',
    'Pilot dia (mm)',
    'Pilot depth (mm)',
    'Counterbore (mm)',
    'Into',
    'Tolerance (mm)',
  ]
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(escape).join(',')).join('\n')
}
