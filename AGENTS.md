# AGENTS.md — ottoyarddepot-sim (OTTO-TWIN)

**This repo is OTTO-TWIN's cockpit and renderer** — the digital twin of an OTTOYARD depot, plus the
operator console that starts and stops simulation runs.

## What the twin is for

It is not a demo animation. It is a **world generator** whose job is to manufacture maximally real,
maximally *random* conditions so that OTTO-Q can be proven to handle them. The founder's framing:
**almost a video game — a 4K, hyper-realistic world model.** The realism is the *proof surface* for
the intelligence layer. If a viewer can watch a vehicle arrive, take an assigned lane, pull into a
specific stall, dwell for a physically sensible time, and leave — and every movement traces back to a
decision OTTO-Q made and can justify — the intelligence is **visible, not asserted.**

**The swap test is the pitch:** unplug the twin, plug in a real depot's telemetry, and OTTO-Q cannot
tell the difference. **If you build a code path that only works because this is a simulation, you
have broken the pitch.**

## The clean split

The twin owns **discrete truth** (which stall, which state, what time). The renderer owns **only
interpolation.** Zero world logic client-side.

## Landmines specific to this repo

- **1 plan unit = 0.4785 m = 1.57 ft.** `src/lib/sitePlan.ts` is drawn to real dimensions and the 3D
  frame is **1:1 with plan units, no scale factor**. ⚠️ A *different* yardstick (1.5699 ft/unit)
  exists in the site-plan export — mixing them caused a 1.57× outage.
- **The lane network is founder-locked.** Charging lanes stay **all northbound**; perimeter avenues
  stay **two-way divided**; gates stay **enter east / exit west**. Chase chose all three explicitly.
  Do not "improve" them.
- **Lane paint is generated from the LaneGraph, never hand-drawn** — so painted right-of-way can
  never drift from routed motion. Both renderers once carried hand-drawn arrows that *contradicted
  the actual rules*. Do not reintroduce them.
- **Measure oriented body overlap** (the 4.0 × 9.8 box actually drawn), **never centre distance** —
  perimeter stalls are pitched 5.7u apart, so a distance test flags every pair of parked neighbours
  and once reported **31 phantom collisions**.
- **Sample during motion, not after the scene settles.** And **replay the captured fixture**
  (`src/engine/__fixtures__/twinRun.busyday.json` + `replay.ts`), not a live run — these bugs are
  intermittent and a frozen recording makes a fix falsifiable.
- **Measured worse, do not re-propose:** correcting the parked heading (305 → **378**) · enabling
  `separationSteer` (its radius 5.5 exceeds the 4.8u opposing-lane separation — **it would
  manufacture the head-on swerve**) · letting two tail-to-tail back-outs pass each other by id (a
  reverse is kinematic; it backs straight through the waiting car) · admitting junctions 20u apart as
  a pair · sizing staging back-outs to the aisle depth (all measured 2026-09-22; see below).
  ⚠️ The old line "routing cars onto the parking access aisle before departing (305 → 728)" was
  **superseded on 2026-09-22**: that measurement routed the car on from the NEAREST graph node after
  the back-out. With the back-out joining the aisle lane ahead of the nose it measures better, and it
  is what stops cars wedging (see `TwinMotionDriver.flow.test.ts`).
- **Traffic flow (2026-09-22) — read before touching exits, junctions or lane offsets:**
  - A parked car leaves by an **exit manoeuvre**, never a straight line to the nearest node: charger
    cars back out onto their one-way northbound gap lane (`chargerBackOut`, since 2026-09-28; they
    used to sidestep into it), staging cars back out and join the aisle ahead of the nose
    (`backOutFrom` + `LaneGraph.routeFacing`). The nearest-node exit drove cars into their parked
    neighbours and wedged them for the rest of a run.
  - Junctions admit **compatible movements** together (`RailLocks`, `movementsConflict`); the old
    one-car-per-node lock serialised the opposing stream of every divided road.
  - `offsetRight` takes **miter** joins. That moved right-turn paths 5.7u from their node, so
    `NODE_MATCH` is 7 — shrink it and right-turners stop registering junctions.
  - `contractPace` converts the leg's SIM deadline into MOTION time (`viewMult / speed_x`). The two
    clocks agree up to `MAX_VIEW_MULT`; they differ only above it. Floored at a walk (`MIN_PACE`).
  - Twin stalls map to renderer stalls **by position** (`setTwinStallMap`, `planFromDbFeet`). The code
    mapping drew 113 of 113 staging stalls in the wrong run slot.
  - Replays run on a **simulated clock** (`replay.ts`, `flowReplay.ts`). On the real clock the 12 s
    dwell floor never expires inside a replay and no car ever leaves a charger.
  - A wait that comes back round is a **deadlock, not a queue**: junction admission and merge gap
    acceptance follow the `waitsOn` chain (`waitsOnMe`, up to 6 cars). A fresh start
    (`twinRun.fresh0922.json`) had a four-car loop at Ts / Sg3 that only the 45 s watchdog broke.
  - **Motion follows playback up to 8x** (`MAX_VIEW_MULT`, the backend's own playback clamp). It was
    capped at 3x while play went to 8x, so a dispatch wave left the stalls at 8x, drained at 3x, and
    the picture ran behind the twin. Lifted 2026-09-22 on Chase's call ("as long as everything works
    and nothing is sacrificed"): on every capture stopped time, stuck cars and overlap on screen
    measured better or equal, and cars behind their OTTO-Q leg halved. When you compare flow
    across multipliers, use `overlapRate` and `viewer` (pairs on screen per poll), never the raw
    overlap count: samples are per MOTION second, so 8x motion holds 8/3 as many per wall window.
- **Corners and docking (2026-09-28) — read before touching `roundCorners`, `routeToStall` or the dock blend:**
  - **Built things live in `src/lib/structurePlan.ts`** (walls, doors, lifts, wash gantries, canopy and
    carport columns, bollards, charger cabinets). The renderer draws from it and
    `structureClearance.replay.test.ts` drives every recorded car against it: add a solid there, never
    only in a component, or the clearance test cannot see it.
  - A corner takes the **widest cut in `WIDE_CUTS` (up to 2.4u, R 5.8u at 90°) whose swept body
    clears every structure and parked-car footprint by 0.4u** (`setCornerObstacles`), else the old
    1.2u. Fillet legs are measured between REAL corners (`dropCollinear`), and junction membership
    reads the ROUTED path as well as the rounded rail — without that, a wider right-turn arc leaves
    `NODE_MATCH` and the car stops registering the junction.
  - **Every charger stall is ANGLED 60° to its gap lane (founder's call, 2026-09-28)**, leaning the
    way the lane runs: `sitePlan.chargingStalls` bearing 60 (west column, noses north-east) / 300
    (east column, north-west), `CHARGER_STALL_ANGLE`, one frame helper (`chargerStallFrame`). A
    perpendicular head-in layout was built first and **rejected on sight** (*"This looks horizontal
    pull-in/parking which is not viable"*) — do not re-propose it. A car rides its northbound lane to
    where the stall's own axis crosses it (`chargerTurnIn`, 9.2–9.5u south of the stall), turns 60° in
    at R = 11u and drives in nose first; it leaves by **backing out** (`chargerBackOut`, solved for any
    bearing by `chargerBackOutStraight`: 12.1–12.7u straight back along the axis, then a full-lock 60°
    swing to face north on the lane's centreline, ~16u south of the stall — the arc it came in on,
    backwards) and rides that centreline to the north collector. The wheel is put over half a
    steering ramp early (`rampLag`) so it lands on the centreline within ~0.1u.
  - **The rows MOVED to make that possible; the columns did not.** A 60° car needs ~15.6u of straight
    lane south of its stall to turn in, and a car arriving along the south collector's westbound
    stream (y 168.8) needs ~5.8u more to turn onto the lane at all. At the old rows the southernmost
    L2 stalls' axes met their lane SOUTH of that stream — unreachable — and their back-outs ended with
    the tail at y 181, across the collector. So DCFC went 16 → 14u pitch (rows 88..144, both columns
    level) and L2 10.6 / 11 → 8.4u (`L2_ROW_PITCH`; east column half a pitch behind the west, so the
    noses interleave across the spine). Every stall keeps its x, code and count; `buildLayoutSeed`
    writes the rows and otto-q-core migration 0561 moves `public.stalls`. Until the database carries
    them, charger stalls map **by column and rank** (`setTwinStallMap`, before position): nearest
    position is WORSE than nothing across a re-pitch (old L2 row 117.7 lies 1.8u from new row 119.5,
    one rank off). The reservation glow reads the driver's map (`rendererStallFor`) for the same reason.
  - Neighbours share one stretch of lane — and lane AB takes back-outs from BOTH sides, the DCFC east
    column and canopy B's L2 west column — so a back-out waits (`chargerBackOutBlocked`) for (a) a
    neighbour's back-out under way, (b) a car standing anywhere its swing sweeps
    (`CHARGER_BACKOUT_SWEEP_AHEAD`), (c) a moving car near its finish, (d) a car about to merge there,
    and (e) south-collector traffic if the tail would reach the collector. No stall's does any more
    (worst 1.0u short of the westbound stream); (e) stays, tested with a hand-moved finish. Once
    committed it is published where it will finish (`backOutClaims`). At the cusp the centreline lead
    stops ONE LANE OFFSET short of the north collector's junction: ending on the node, the graph route
    dropped it as a duplicate and drew a 3.2u drift across ~47u of collector (test E: 227 contacts → 0).
  - **Solids are oriented boxes now** (`structurePlan.OBox`, `boxGap`, `bodyHitsBox`, `parkedBox`):
    an angled car or cabinet's axis-aligned bounds are 10.5 x 8.4u for a 9.8 x 4.0 body, and would
    put phantom solids over the lane and the next stall. `RailFlow.setCornerObstacles` takes them; the
    layout guard (`checkLayoutGeometry.mjs`) measures stall footprints as turned rectangles (SAT);
    the seed caps an angled stall's width at the pitch square to the car and its depth at the canopy
    spine (`chargerDepthCap`), and refuses rather than trims if an angled stall ever clips.
  - **Chargers stand on the car's charge-port flank** (the south-side flank: the car's right on a
    west column, its left on an east column, `depotPlacement.portFlank`), turned with the car. The
    OTTO-CHARGE ARM's pedestal is abeam the car's centre `PEDESTAL_OFFSET_PU` off the centreline
    (`pedestalPlanPoint`), the cabinet `CABINET_BACKSET_PU` behind it; `placeArm` yaws the arm so its
    +Z runs pedestal → car. In the ARM's own frame nothing changed (same standoff, service window,
    clearance sweep; `portInArmFrame`'s `x = -toward * along` holds at every bearing).
    `depotIntegration.test.ts` asserts the IK target and the port ring `Vehicle3D` draws are one
    world point. **The arm and its DCFC cabinet are ONE unit** (founder, 2026-09-30: the arms were
    "floating beside the hardware cabinets"): a riser carries the arm's mount plate from the pad and a
    cable trunk joins it to the cabinet face (`cabinetEnvelope.ARM_MOUNT_PU`, `mountSolidInArmFrame`),
    all on one pad (`depotPlacement.chargerPad`, which the 3D field, the 2D plan and the car solids
    share). J1 did not move: nothing stands above the plate's underside, and `cabinetClearance.test.ts`
    keeps every moving link 0.36 m clear of it through stow, approach, mate and the transit between.
    An L2 post stands beside the car's front quarter (`L2_POST_ALONG_PU`,
    `L2_POST_LATERAL_PU`), clear of the spine, and is fed from below (no conduit drop). ONE placement
    (`depotPlacement.chargerCabinet`) feeds ChargingField, the 2D plan and the solids. Canopy spine
    columns clear every cabinet and every parked car's BODY (`canopyColumnYs`).
  - Ratchets: `turnRadius.replay.test.ts` (share of turning at R < 5u, crab, spin), docking test D
    (0 contacts, DCFC and L2, pulling in between parked neighbours), test E (0 contacts between cars
    AND 0 against any structure solid — cabinets, posts, spine columns — filling all 40 stalls and
    backing 26 out; mutation-checked: an L2 post moved 1u toward its car reads 1636) and the traffic
    tests' 40-stall back-out finish check and south-collector case.
  - **Measured worse, do not re-propose:** a GLOBAL corner cut of 3.6 (fresh-start overlap 49 → 70,
    all in the temp-staging aisle and SE ring corner) · a right-turn cap above 2.4 (R < 5u share flat,
    overlap +7%) · routing a finished charger back-out by the graph (`routeFacing`): graph lanes run
    3.2u right of centre, so it drove beside the charger cars on the centreline (test E 0 → 51
    contacts) · ending that centreline lead ON the north collector's junction node (see above).
    (Historical, the DCFC pull-alongside layout: a 7u straight pull-in tail put the rear 0.17u into
    the next stall's car, and publishing a lean-out at its merge point cost +53 stuck samples.)
    · perpendicular (90°) head-in charger stalls — founder rejected the look, see above.
  - **Known open (pre-existing, not charger motion):** a mass egress wave bunches staging
    departers on the south-east collector (busy_day frame 30). It surfaces or moves when departure
    timing shifts; it does not involve a charger car. (Two STAGING neighbours backing out together
    was the other one: closed 2026-10-01 by `stagingBackOutBlocked`, below.)
- **Staging arrivals pull straight in (2026-10-01) — read before touching `routeToStall`'s staging
  branch or `LaneGraph.routeOff`:** founder: *"they go past their designated stall first and then
  come back to it ... It needs to immediately turn into that spot."* The staging route used to end
  at the graph node NEAREST the stall's turn-in, which was as often past the stall as short of it
  (the temp aisle is one 98u lane), so the car drove by, hairpinned and came back — the heading lag
  drew it as reversing in. `routeOff` projects the turn-in onto every lane and leaves the road
  abreast of it (a candidate must lie within `OFF_SLIP` of the lane's extent, within `OFF_REACH` of
  its lane line, and be reached within `OFF_ALIGN` of the parked heading — or a car pulls off
  sideways from the gate spur beside S2/S3); no candidate falls back to the old route. Overshoot
  went 102/299 arrivals → 0/299 over the five replays (`arrivalProbe.ts`,
  `parkDirect.replay.test.ts`). Cars now reach their stall sooner, which put two neighbours'
  back-outs into the same tick more often (busy_day +4 overlap), so a staging back-out now waits
  for a neighbour's COMMITTED back-out within `STAGING_BACKOUT_REACH` (`stagingBackOutBlocked`).
  Still a double-back, by geometry: S3's first stall (x 212) is beside the gate, nose south, so a
  car entering northbound loops on the collector to come at it from the north.
- **Spinning, collisions and the median (2026-10-06/07) — read before touching `RailFlow`'s
  openings, `LaneGraph` offsets or routing, back-outs, merges or junction stops.** Chase, watching run
  fd6ed035 (`twinRun.chase1006.json`): *"the vehicle still spin in place when they approach other
  vehicles or potential traffic jams ... making sure as vehicles approach each other they don't
  collide or pass through one another"*, and the two streams *"spaced wide enough with potential
  slight median"*.
  - **Measure with `__fixtures__/motionAudit.ts`, never by eye or by spin steps.** A spin step (turn
    at < 0.001u of travel) cannot see a pivot: a car creeping in a queue turned 143° in one unit of
    travel and was "moving". The audit counts PIVOT events (drawn heading >= 45° within 4u = p45,
    >= 90° within 9.8u = p90), each with its mechanism (cusp, corner, dock, retask, start…), oriented
    overlap by situation, structure contacts, stopped/stuck, and how every rail STARTS against the
    car's heading. `MOTION_AUDIT=1 npx vitest run src/engine/motionAudit.measure.test.ts` reports all
    seven captures (~9 min; `MOTION_AUDIT_OUT=file.json` for the events); `motionAudit.replay.test.ts`
    ratchets three windows on every verify. Founder's run, base -> now: first 30 min p45 383 -> 66,
    p90 253 -> 40, R < 5u 23.0% -> 5.5%, overlap 17 -> 5; whole 2 h 844 -> 175, 526 -> 104, overlap
    34 -> 5, structure contacts 0. Docking D/E stay 0.
  - **A rail starts the way its car points** (`RailFlow.startOnHeading`): an R 7u arc tangent to the
    heading, then a straight to the first route point it can reach within 45° of the route's own
    direction, with legs that round that corner at >= 0.8·R. It may not overlap a structure or any
    stall's footprint (`setCornerObstacles`) — an opening aimed past a U-turn cut through the car in
    S1's last stall — except what the car stands within 0.3u of and the stall the route ends in.
    **U-turns are priced** (`U_TURN_COST`, LaneGraph's search over node + came-from), and a staging
    back-out's swing is chosen by `drivenCost` (length as driven, + U_TURN_COST per hairpin and for an
    opening still > 30° off) with `swingHits`. Cusp rails starting > 60° off the car: 83 -> 2 on the
    founder's whole run.
  - **The ring is DIVIDED (founder's call):** every lane has its own offset (`LaneGraph.offsetOf`;
    aisles and one-way lanes keep `rightOffset` 3.2u); the ring's two drive lines are `DIVIDED_SPAN` =
    8u apart (opposing bodies 4.0u = 1.91 m apart, was 2.4u), and `lanePaint` draws the 1.6u between
    the 6.4u lanes as a flush median (solid yellow edge lines, light hatching) ending 8u short of every
    junction, for the 2D overlay and the 3D decals alike. Avenues split 4.0/4.0. Collectors split
    3.2 (canopy side) / 4.8, because 0.8u further south the north collector's eastbound turn into wash
    bay 3 met canopy C's column or the brushes at every forecourt point tried (best -0.19u, drawn), and
    0.8u further north the south collector's westbound passed the charger back-out tails at 0.2u and
    the end-cap poles at 0.3u. Junction stops are PER APPROACH (`LaneGraph.stopDistance`: 0.6u short
    of the nearest stream crossing the way in — 7.6u on the ingress spur and down the N1 aisle, 6.8u
    from the N1 lane, 6u elsewhere) and the claim distance moves with the stop (stop + 6u); `joinAhead`
    never joins a lane the car stands at the END of. Layout guard: east-avenue stall clearance 3.87 ->
    2.61 ft; the tightest stall/lane (NASH-L2-STALL-01, 1.27 ft) and structure/lane (LIGHT-07, 2.19 ft)
    are unchanged; the seed md5 is unchanged (lanes are not in it).
  - **Waits that used to be collisions.** RailFlow finds a leader by its CENTRE on the follower's
    path, so a body standing ACROSS a lane was invisible to the lane. A committed staging back-out, and
    the car at its cusp for its first 15u, now stand as stopped bodies on every lane their bodies reach
    (`streamClaims`, same id so `waitsOn` chains still resolve); a back-out waits for any car standing
    in its sweep (`sweepOccupied`) and for traffic within 26u of its claims; a car pulling out waits for
    every stream it CROSSES, not only the lane it joins (`LaneGraph.streamsCrossed`,
    `Rail.merge.cross`); a gate-queue arrival rides the road's line to `INGRESS.x + 8` before turning in
    (`GATE_QUEUE_TURN_X`; queued cars ran converging diagonals into the car in front). A cusp keeps 2u
    (`CUSP_CLEAR`) from every other stall's footprint by giving up to 1.5u of the straight (`cuspGap`):
    temp-block cusps stopped 0.0u from the car opposite. Cost, measured: stopped time +1-2 points
    (fresh0922 @3x 2.7% -> 4.7%: +33 s gate queue, +56 s back-outs and cusps, -15 s at junctions), and
    the 30-car deploy wave drains in ~135 s (was ~120). The flow test's stopped/stuck budgets moved up
    for that reason only; its overlap and on-screen budgets moved down.
  - **Measured worse, do not re-propose:** symmetric 4.0/4.0 collectors (see above) · one global
    junction stop of 7.6u (busy_day stopped 4.8% -> 7.2%; per approach 5.7%) · a junction box sized to
    the 4.8u streams, BOX 12 / RELEASE 12.5 (the founder's first 30 min: overlap 31 vs 20) · treating
    standing and backing cars as leaders by their oriented body in the forward window (busy_day overlap
    79, stuck 61: gridlock) · falling back to a WIDER fillet at wash bay 3 (the look-ahead heading still
    clips the column; the turn point moves instead, `BAY_TURN_SHIFTS`) · stream claims that leave out
    the lane being joined (the waiting car's nose stands in it) · rules on the ROUTE for openings: "at
    least 0.75 of the route it replaces" (refuses openings that hit nothing: p45 523 vs 530 summed over
    seven captures, overlap 58 vs 54) and "never past a 120° turn" (p45 609) · `CUSP_CLEAR` 1u (the
    opening's first turn swings the tail ~0.8u) · a back-out that "asks for a gap" by publishing its
    claims after 6 s (it held the car standing in its own sweep, which held it: 4 cars ~60 s;
    traffic-only asking changed nothing).
  - **Known open:** W-24, the west column's last stall, has no clear back-out when W-23 and S1-2 are
    parked: both swings and every straight down to 6u sweep a car (6.9 s of motion overlap, 2.3 s on
    screen at 3x, in the founder's first 10 min). That is the south-west corner — the seed already trims S1-1 and W-24 0.46 ft where
    their footprints clip — so it needs layout, not motion. S1 cars bound for the egress whose cusp is
    7-16u from the spur turn into it off a short leg (R ~ 3u, 3 p45 events on the founder's run). Two
    S-row neighbours' cusps can face each other (1.6 s), and a car crossing the eastbound stream at
    (88, 173) is not serialised: neither place is a junction. The arrival probe's one N1 "overshoot"
    (45.8u on chase1006, unchanged since base) is the instrument counting a car passing BEHIND the row
    on the one-way rear apron.
- **Keep Yuka's `SeparationBehavior.weight` low (0.35).** At 2.2 it was *stronger* than
  path-following and shoved cars sideways off the lanes.
- **One car, one size: 9.8 x 4.0u (4.69 x 1.91 m)** — `traffic.CAR_BODY_*` is the traffic model's
  body, the 2D `VehicleDot`, the 3D mesh (`vehicleBody.ts`, shaped in `vehicleEnvelope.ts`) and the
  replay metric's body (`replay.ts`, pinned equal by `RailFlow.gap.test.ts`). It was 10.2 x 4.2
  until the founder asked for "slightly less big/boxy/bulky" (2026-09-28); the glass and roof now
  lean in above the highest charge-port line (`TUMBLEHOME`), so every inlet stays on a vertical
  flank. **The arm's swept quantity is its standoff from the car's FLANK** (`FLANK_STANDOFF_PU`,
  1.866 m): the pedestal offset is derived from it and the car's width, so a narrower car moves the
  pedestal in rather than making the arm reach further than it was measured to.
  ⚠️ Changing `rightOffset` or the car's size moves routed motion and every replay: measure all of
  them (fixture, flow, turn radius, docking, structure clearance, arm clearance), not a drive-by edit.
- **`ResponsiveGuard` routes phones to the PHONE cockpit** (`src/components/phone`, since 2026-09-30):
  a touch-first screen whose short side is < 600 px, or any window < 900 px (`phoneLayout.isPhoneViewport`;
  `?phone=1` forces it). Everything else gets the desktop cockpit, unchanged — test the desktop at
  1440×900 or larger (the side panel auto-collapses below 1200 px). The phone cockpit REUSES the
  desktop's tab components and run calls (`useTwinControl`, `blackbox.stopAndReset`): do not fork a
  panel for the phone, and do not change a shared panel for phone-only reasons without checking the
  desktop. Its Start/Pause/Stop are the real controls for everyone watching the run.
- **The city around the depot is scenery, not world** (2026-10-04, `cityPlan.ts` → `cityMesh.ts` →
  `UrbanSurround.tsx`): streets, ~1,900 buildings, a downtown skyline to the north with one
  two-spired tower, a river with bridges, street trees, lamps and signals, built once from a seed
  into ~33 draw calls that cast and receive no shadows. Nothing reads it and nothing in it moves
  but the night lights. `cityPlan.test.ts` pins what it must never do: stand on the depot block,
  the south road the fleet drives, the lawn the Entrance camera stands on, or in any preset's or
  live-view camera's way. Add a camera, and the test checks it. DepotGround draws only the depot's
  own block and its stretch of the road; the camera's far plane is `CITY_VIEW_FAR`, and the sky and
  haze now dim with the sun (`DayNightLighting`), so the city's lit windows read at night.
- **3D perf and phone tooling:** `scripts/perfHarness.mjs` (draw calls, triangles, memory, frame times
  per camera preset, profile and render tier; `?perf=1` shows the same probe on a real phone) and
  `scripts/phoneShots.mjs` (the phone cockpit in an emulated iPhone, both orientations). Both play a
  recorded run read-only. The render tiers live in `src/components/canvas/three/quality/tiers.ts`;
  High is the desktop look and is pinned by `tiers.test.ts`.
- **The RTX tab needs the AWS Isaac box running.** Blank is normal when it is stopped. IP override:
  `localStorage.setItem('ottoq_omniverse_ip','<ip>')`.

## Viewer copy: ASD-STE100 (2026-10-05)

Chase, 2026-10-05: the twin is shown to investors and OEMs, and its text must be *"more concise and
direct."* Write all text a viewer reads in **ASD-STE100** (Simplified Technical English, Issue 9,
January 2025): **100%** for labels, statements, lists, status lines, buttons and tooltips; **about
80%** for narrative (the Background tab, the layer cards' *why* and *chosen*). STE alone does not
shorten text, so also cut detail that does not earn its place. Source:
[Wikipedia, Simplified Technical English](https://en.wikipedia.org/wiki/Simplified_Technical_English)
(the official PDF at asd-ste100.org refuses automated reads).

**Scope.** Text on screen: JSX text, titles, taglines, chips, tooltips, toasts, empty states, card
and feed lines built in `src/lib`. **Not** comments, console output, test names, ids and keys,
`refs` (code object names), text that comes from the engine database, or quotes (keep them verbatim).

**Rules.**
- One idea per sentence. A sentence has 20 words or fewer (25 in narrative); aim for 15.
- Active voice. Simple tenses. No *-ing* verbs in sentences ("the car charges", not "the car is
  charging"). Names of states and zones (Charging, Staging, Waiting) are names, so they stay.
- Keep the articles ("the", "a") in sentences. Labels and chips can be short ("Charger fault").
- No more than 3 nouns in a row. No idioms or metaphors. No marketing words.
- Simple words: use, make sure, show, start, stop, get, help, before, after, about, more, but, so.
  Not: utilize, leverage, ensure, via, in order to, prior to, approximately, indicate, obtain,
  terminate, initiate, facilitate, therefore, however.
- No semicolons and no dashes between clauses: start a new sentence. Parentheses only for a
  unit, an abbreviation or a number.
- 3 or more items: a vertical list where the component can show one, else short sentences.
- A narrative paragraph has 4 sentences or fewer (never more than 6).
- Numbers as digits, with units. Real clock in CT; the sim clock says "sim".

**One word, one meaning.**

| Use | For | Not |
|---|---|---|
| car | one vehicle, in sentences | vehicle, unit, asset (tab and feed titles may keep "Vehicles") |
| stall | a space a car stands in | spot, space, slot |
| fast charger / DCFC | a DC fast charger | rapid charger |
| standard charger / L2 | a level-2 charger | slow charger |
| bay | a wash, detail or service bay | station |
| booking | a held time window on a stall or bay | reservation, slot, hold (except "staging hold") |
| plan / step | what OTTO-Q schedules for a car / one operation in it | itinerary, leg, atom, task |
| run | one simulation run | session, scenario run |
| tick | one OTTO-Q decision cycle | cycle, beat |
| agent / pass | the AI language model / one call to it | AI, LLM, model (except in "model call") |
| planner / solver | the lexicographic, GPU, heuristic or service-priority planner (`src/lib/publicNames.ts`) | a product name (see below), optimizer engine |
| the decide path | the deterministic part that makes every final decision | arbiter, deterministic core, kernel |
| safety shield | the rule layer that checks each decision | rule gate, guard ("gate" is the depot gate) |
| propose / decide | what agents and solvers do / what the decide path does | suggest, dispose, enact |
| ready / dispatch | a car with no open needs / a ready car sent out | released, deployed |

**No vendor product names on screen (Chase, 2026-10-07).** *"I want to remove all specific tool naming from our
descriptions ... rather terms like 'leverages Nvidia open source model for…'"*. A model or solver is named by what it
does, and a vendor only as the maker of the hardware or open model underneath: "the agent, on an NVIDIA open model",
"the lexicographic planner", "the GPU planner". Every viewer name comes from `src/lib/publicNames.ts`; text the app does
not write (a model's review, an upstream error) goes through `publicText()`. `publicNames.test.ts` parses every string
literal, template and JSX text in `src` and fails on a product name with its file and line, so add a name to the table,
never to a component. Sources for vendor facts go in a code comment beside the claim, dated, not in a link on screen
(a link names the product in its address). And the layer cards say how OTTO-Q is built without the formula: no code
object names on screen (`refs` stay in `layerInfo.ts` for engineers and tests).

**Honesty is not cut.** Keep every number with its denominator and unit, every run id, and every
word that limits a claim (simulated, in the twin, advisory, not yet, measured on run X). Never make a
claim stronger or add a fact. Cut history instead: dates of decisions, migration, check and finding
numbers (0412, G293), and anything said twice.

**Example** (Background tab). Before, 82 words: *"Every model and solver only proposes. The AI agent
chooses what the next decisions should optimize, solvers offer assignments, and one deterministic
path decides, behind the rule shield. The agent chooses among options the engine already allows; it
cannot book a stall or move a car itself ..."* After, 52 words: *"Models and solvers only propose. One
deterministic path decides. • The agent sets the goal for the next decisions. • Solvers offer stall
assignments. • The decide path checks each offer against the rules, then decides. No agent can book
a stall or move a car. A ledger records each call and its result."*

## Verify before you PR

```bash
npm run verify        # typecheck && vitest run && vite build
npm run layout:verify # if you touched geometry — rebuilds the seed and asserts no diff
MOTION_AUDIT=1 npx vitest run src/engine/motionAudit.measure.test.ts  # if you touched motion (~9 min)
```

`verify` ratchets only three windows of the motion audit; a change to `RailFlow`, `LaneGraph` or
`TwinMotionDriver` brings the audit's before/after table for all seven captures into its PR (pivots,
overlap by situation, stopped, stuck), and explains anything that got worse.

**Then look at it in the twin, 2D and 3D** — Chase, 2026-09-22: *"Make sure to always validate
against the twin 2D/3D for final confirmation."* The replays measure motion; they are not the
final word. `scripts/cockpitPlayback.mjs` plays a recorded run (`twinRun.fresh0922.json`: a fresh
start's dispatch wave) through the running cockpit (`npm run dev`), read-only, in either view — so
the hardest case can be watched without starting a run, which would purge the live one. Run it
against `main` too and compare. ⚠️ A headless browser in a sandbox renders 3D in software (~1 fps):
good for placement (stalls, lanes, headings, no interpenetration), not for smoothness — say so.
Seen once: with a second dev server running from a worktree whose `node_modules` was symlinked to
this one, the first logged "Re-optimizing dependencies" and its 3D view threw a duplicate-React
error (`reading 'useMemo'`) until restarted alone with `--force`. Give each server its own cache.
A sandbox without IPv6 cannot bind the dev server's default `::` host: run a second server as
`PORT=8093 npx vite --host 127.0.0.1 --port 8093` and point `--url` at it; if Playwright's bundled
browser is missing, pass the installed one with `--chromium`. `--cams @x:y:z/tx:ty:tz` frames any
world view (world x = 150 − plan x, z = 110 − plan y, y up).

⚠️ **This repo is Lovable-synced with two-way sync on `main`.** Chase's edits in Lovable commit
straight to `main` (as `gpt-engineer-app[bot]`), and merging your PR is picked up by Lovable
automatically. Fetch before you push.
---

## The full context lives elsewhere

**Read this first, before any substantive work:**

```bash
git clone https://github.com/OTTOYARD/ottoyard-agent-context.git
```

That repository is the shared brain for agents on this project: architecture, the founder's binding
doctrine, the known-issues register, a ranked backlog, hard-won lessons, and a verbatim copy of the
79 memory files Claude Code accumulated while building this system. Start with its `README.md` and
`docs/16_FIRST_SESSION_RUNBOOK.md`.

## Rules that apply in every OTTOYARD repo

**⚖️ The law.** *OTTO-Q decides. OTTO-TWIN executes and owns world state. The renderer only draws.*
Decision-layer code that mutates world state is a defect on sight. Renderer code containing world
logic is a defect on sight.

**Branch, verify, PR. Never merge.** Chase Ballenger (founder) is the only one who merges. Branch as
`hermes/<slug>` or `claude/<slug>`, prove it works yourself, then open a PR whose description carries
**the evidence** — real numbers, real row counts, real screenshots — plus what you did *not* verify
and what could break. Half-done labelled half-done is fine; half-done labelled done is not.

**🚨 `git fetch origin` before you reason about anything.** The clones on the founder's Desktop have
been up to **77 commits behind**. Compare against `origin/main`, never local `main`. A branch still
existing is not evidence it is unmerged — check
`git rev-list --count origin/main..origin/<branch>` (0 means merged).

**Two identity traps.** `OTTOYARD` on GitHub is a **personal account, not an organization**
(`/orgs/OTTOYARD/...` returns 404 — use `/user/repos`). And GitHub **rejects pushes authored as
`chase@ottoyard.com`** — commit as a noreply identity.

**Three Supabase projects — the engine is `gxdrcyphqjzjsuhxuqtg` (otto-q-core, us-east-1).**
`ycsisvozzgmisboumfqc` is the **OTTOYARD MVP** (us-east-2): the original demo backend, OrchestrAV's
auth/billing/retail (`ottoq_ps_*`) home, and the live intelligence pipeline (`intelligence_events`,
written every ≤3 min by its own pg_cron + `intelligence-*` edge functions) — active, never the
engine. `sovyxwtrqfmizelrammm` (Fleet Dashboard) is INACTIVE with zero live callers. ⚠️ **Every
`supabase/config.toml` in every OTTOYARD repo points somewhere else** — at dead refs
(`hfjaofyfxsyniohdfacg`, `odhpbdhnpcrjeaxvbrzd`), at the MVP, or at a placeholder. The real ref is
hardcoded in client code instead. **Pass `--project-ref gxdrcyphqjzjsuhxuqtg` explicitly to any
Supabase CLI command that writes.** (DB labels reconciled 2026-08-18 by Run 1 C1 — see
`SYSTEM_TOPOLOGY.md` in `otto-q-core`.)

**Never disable pg_cron job 12** (`ottoq-demo-metronome`). It **is** the simulation run engine.
Disabling it stops every run while everything still looks green.

**Honesty about numbers is a hard requirement here.** Always state your denominator. Never quote
`vehicles_turned_around`, `fleet_ready_pct`, or `gate_backlog` — they are final-frame instantaneous
counts that structurally penalise OTTO-Q. Interrogate the baseline before believing a win: it has
been invalid twice, both times in our favour. Read
`ottoyard-agent-context/memory/reference_ottoq_real_edge.md` before quoting any comparative figure.
