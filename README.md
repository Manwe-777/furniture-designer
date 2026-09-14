# Furniture Designer

Design a piece of furniture in 3D, get an exact cut list, and nest it onto sheets.

Built for the case where the numbers have to be right: an L-shaped desk made of two
pedestals and a worktop, cut from 2440 × 1220 MDF, where a panel that is 18mm out is a
panel you cut again.

```
npm install
npm run dev      # http://localhost:5173
npm test         # the maths — 128 tests, no browser needed
npm run build
```

Your work is saved in the browser as you go. **Save** downloads the project as JSON and
**Import** reads it back. `?tab=cutplan` (or `bom`, `designer`) deep-links a tab.

## The one idea

```
buildDesign(design) → Part[]
```

A design becomes a flat list of world-placed panels, and everything else is a *view* of
that list: the 3D viewport renders the boxes, the bill of materials groups them, the
nester packs their cut rectangles. Geometry is computed exactly once, in pure code with
no React and no three.js, so those three views cannot disagree with each other.

Everything under `src/core/` is that pure layer, and it is where the tests live.

## Designing

A cabinet's interior is a **recursive split tree**. You take a space and either divide
it — into columns or rows, with a divider panel between each child — or fill it with
shelves, drawers, or a door. That is the whole editing vocabulary.

Each child of a split is either **Fixed** (an exact size) or **Fill** (a weighted share
of what is left):

```
available = span − (childCount − 1) × dividerThickness
flex children share (available − Σ fixed) by weight
```

So "left column exactly 400mm, the rest fills" survives a change to the cabinet's width
without re-entering a single number.

Editing happens in the 2D front elevation and the inspector rather than by dragging in
3D — hitting an exact millimetre with a gizmo is hard, and interior parts are hard to
even select. The 3D view is for looking: orbit, explode, click a part to select it
everywhere at once, and **Persp / Ortho**. In orthographic there is no perspective
distortion, so Front / Side / Top are true elevations — parallel edges stay parallel and
equal lengths measure equal anywhere on screen, which is what you want when checking a
design rather than admiring it.

### Modules that share a panel

Where two modules butt together, only one of them should cut the panel between them.
Untick that face under **Panels** and this cabinet contributes no material there.

The cabinet still occupies its full width and height — the omitted face simply has no
panel of its own, so the remaining panels and the interior grow out to that boundary and
meet the neighbour's panel. Place the two modules directly adjacent and the shared panel
is cut exactly once:

```
module A (800, closed)        module B (600, left omitted)
┌──┬──────────────────┬──┐    ┌──────────────────────┬──┐
│  │                  │  │    │                      │  │
│  │   interior 764   │  ├────┤    interior 582      │  │
│  │                  │  │    │                      │  │
└──┴──────────────────┴──┘    └──────────────────────┴──┘
                        └─ one panel, cut once, closes both
```

A's top is 764 (800 − 2 × 18); B's is 582 (600 − 18), because B only has one side of its
own. A rebated back gets no groove allowance on an omitted face either — you cannot cut
a groove into a panel that is not there.

## Why the panel sizes come out right

`src/core/build/buildCabinet.ts` applies real construction rules, which is the
difference between a cut list and a drawing:

| | effect on the cut size |
|---|---|
| **Carcass joint** | `sides-full` cuts the sides full height and the top/bottom at `width − 2t`; `topbottom-full` is the reverse |
| **Back panel** | `overlay` covers the rear face and pushes the carcass forward; `inset` fits the opening; `rebate` is oversize by the groove depth on every side |
| **Shelves** | interior depth less the back panel, less a front setback |
| **Drawers** | box is `opening − 2 × slideClearance` wide (12.7mm/side for ball-bearing runners), shorter than its face, and stops short of the cabinet back |
| **Edge banding** | banded parts are cut *undersize* by the banding thickness so they finish on the nominal dimension |
| **Omitted faces** | a face shared with a neighbouring module cuts no panel, and the panels that remain grow to meet the neighbour's |

A part carries both its **finished** size (the 3D box you see) and its **cut** size
(what you take to the saw). When banding is compensated those differ, and that gap is
exactly the mistake this app exists to prevent.

Anything that cannot be built — a split whose fixed children overflow, shelves that do
not fit — surfaces as a warning next to the design rather than as a silently wrong part.

### L-shaped worktops

An L is generated as **two butt-joined rectangles, never one L-shaped piece**. Cutting
an L from a sheet wastes the inside corner and no guillotine saw can produce it, so
keeping every part rectangular is what makes the cut plan runnable. You choose which leg
swallows the corner; the 3D view draws them flush so it still reads as one surface.

## Drilling

Shelf pins go on the **32mm system** — the open cabinetmaking standard: 5mm holes at
32mm pitch, 37mm in from the front edge. It is what every downloadable parametric
drilling jig already assumes, and it is the reason a cabinet can be assembled without
measuring anything twice.

Turn it on per cabinet and adjustable shelves snap to the grid. **Outer dimensions never
move** — only shelf positions inside the carcass change, so a design sized to a wall
stays sized to that wall.

The Drilling tab then lists, for every vertical panel, where to put the holes in *that
panel's own coordinates* — along its length from the bottom edge, across its width from
the front edge — because that is how you hold the piece and register a jig against it,
and you do not have an assembled cabinet to measure from while you are drilling. Holes
a shelf actually uses are highlighted; the rest are what keep the shelves adjustable.
Exports as CSV.

### The jig

The tab also generates a **printable drilling jig** as OpenSCAD source, matched to the
design: a fence that hooks the front edge (setting the setback), an end stop that butts
the bottom edge (setting the first hole), and both rows of holes in one setup so nothing
has to be flipped.

Most downloadable jigs have the fence but no end stop, which is fine when you can clamp
a cabinet's two sides together and drill them as a pair — whatever height you land on is
then identical on both. It stops being enough when shelves have to line up *across*
cabinets, as they do where an L-shaped run turns a corner. That is what the end stop is
for.

One jig per panel depth, with near-enough depths sharing one — a millimetre of edge
banding does not deserve its own print. Everything is a named parameter, so plate
thickness and bushing pocket stay adjustable.

It comes as **two pieces**, and you need both. The *start* jig carries the end stop and
places the first hole on a panel. The *continue* jig has none — because once the jig
moves off the panel's bottom edge that stop would land on the panel face and lift the
whole thing off the work. Later setups index off the last hole drilled instead: drop a
5mm pin through the jig's first hole into it, clamp, carry on. Losing the stop also
frees the dead length before the first hole, so the continuation piece fits more
positions than the start one.

Both are **reversible** — the walls stand proud on each face, so flipping the jig over
puts the fence on the back edge for the second row of holes.

It exports as a **FreeCAD macro** or **OpenSCAD source** — the same solid either way.
FreeCAD because it needs nothing else installed and can be checked headlessly:

```
freecadcmd jig.FCMacro      # prints hole count, size, and whether the solid is valid
```

That check is the point. A generated `.scad` can only be verified by opening it; the
FreeCAD macro reports `valid=True` and a single closed solid — which is what a slicer
needs — before you print anything.

Worth knowing before you drill: **the jig's thickness adds to how far the bit travels**,
so a depth stop has to be set to `plate thickness + hole depth`. The generated file says
so at the top.

### The edge jig

A separate, much smaller jig for holes into the **edge** of a panel — minifix bolts or
dowels — centred on its thickness and square to it. It straddles the edge with legs down
both faces and a fence to set the distance along it.

The hole is placed at half the *panel* thickness measured from one reference wall, not
at half the *slot* — the slot is deliberately a few tenths wider so the jig slides on,
and centring on it would put every hole off by that much. Press the jig against the same
face each time and any variation in board thickness lands identically on both mating
panels, which is what decides whether the two holes meet.

Note this is **not** needed for confirmat screws: those are drilled through both panels
in one pass, so the hole in the edge is made by the same bit that made the hole in the
face and cannot be misaligned. It is only for two-part fittings where the holes are
drilled separately.

Only shelf-pin holes are produced in the schedule. Carcass joint fixings are left to
conventional marking — there are few of them and they sit on panel edges.

## The cut plan

Guillotine packing specifically — every cut runs edge to edge, because that is what a
panel saw or a track saw physically does.

- **Kerf** is handled honestly: a part *fits* if it is no bigger than the free space, but
  what it *consumes* includes one blade width, since the saw destroys that material on
  the way past. A part that exactly fills a gap needs no kerf.
- **Grain** locks a part's orientation on any material marked as grained.
- Several strategies are tried (sort order × fit heuristic × split rule) plus seeded
  random restarts; fewest sheets wins, ties go to the biggest usable offcut. The seed is
  fixed, so reopening a project gives back the layout you already started cutting.
- **Cut lines are re-derived from the finished layout**, not from the packer's internal
  bookkeeping: repeatedly find a straight line across the region that no part straddles,
  and recurse. That doubles as a check that the plan really is cuttable.

Sheets print (`Print`, or Ctrl+P) with the panel sizes on them, and export as CSV.

## Layout

```
src/
  core/                 pure, tested, no framework
    types.ts            Design, Cabinet, Node, Part
    geom.ts             mm rounding, boxes, 90° transforms
    build/              span maths, cabinet/drawer/worktop → Part[]
    bom.ts hardware.ts  grouping, counts, cost
    nest/               guillotine packer + strategy search
    io/                 project JSON, CSV
    holes.ts            32mm hole grid -> per-panel drilling schedule
    jig.ts              drilling schedule -> printable OpenSCAD jig
  state/                zustand store, tree edits, undo/redo
  ui/                   tree · elevation · 3D viewport · inspector · BOM · cut plan · drilling
```

The 3D view is plain three.js rather than react-three-fiber: the scene is a few hundred
boxes with orbit and click-picking, which is less code written directly than it is wired
up through a renderer abstraction — and it keeps a large dependency tree (and its React
peer conflicts) out of the project.

## Verifying a design before you cut

1. Click a part in 3D — the tree, inspector and bill of materials all select it, and the
   inspector shows its exact cut size.
2. On the cut plan, add up a row of parts plus kerfs by hand and check it against the
   usable sheet width. That arithmetic check is the one that matters.
3. `npm test` covers the rest: panel sizes for every carcass and back style, split spans
   summing exactly, no overlapping placements, kerf respected, grain never rotated, cut
   lines no part straddles, and an end-to-end L-desk asserted panel by panel.
