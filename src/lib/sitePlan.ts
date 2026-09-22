/**
 * OTTOYARD SITE PLAN v2 — single source of truth for depot geometry.
 *
 * Logical 2D coordinates: x 0..300 (west→east), y 0..220 (north→south).
 * 3D world mapping via coordUtils.toWorld(): worldX = x-150, worldZ = 110-y.
 * 1 logical unit ≈ 1.57 ft (lot ≈ 470ft × 345ft).
 *
 * Flow (continuous, user-locked 2026-06-10):
 *  - Ingress (S-W gate) → west aisle N → NORTH COLLECTOR (two-way artery).
 *  - Charging = gas-pump: ride a flanking pull-out lane to depth, sidestep
 *    into the stall; exit by sidestepping back out and heading N to the
 *    collector. The canopy gaps are TRAVEL LANES — never obstructed.
 *  - Service/wash sit directly ahead through the concrete FORECOURT throat;
 *    every bay is full pull-through: in the front, out the REAR into a 30ft
 *    clear maneuvering APRON (no parking abuts it), then left via the WEST
 *    LINK or right to the east aisle → parking or egress (S-E gate).
 *  - NW corner: secured BESS yard. Perimeter parking W/E/S under solar
 *    carports. 3 central canopies: 10 DCFC + 30 L2.
 */

import type { StallState } from '@/store/depotStore';

// ---- Flow constants (consumed by SimulationEngine / ArrivalGenerator) ----
// INGRESS is the EAST opening — deliberately co-located with the east-side
// temp/overflow staging block (TEMP_LANE_X ≈ 247) and OPPOSITE the west BESS/
// switchgear yard, so an arriving car has a short taxi to staging and departing
// bay cars route east (away from the fenced battery yard). EGRESS is the WEST
// opening. Both are single-sourced: the LaneGraph, spawns, staging-fill order,
// and the 2D labels all read these, so the two stay in lockstep.
export const INGRESS = { x: 200, y: 215 };  // EAST (right) — same side as temp staging
export const EGRESS = { x: 100, y: 215 };   // WEST (left)
export const QUEUE_Y = 184;
export const WEST_AISLE_X = 30;   // west avenue (two-way divided; drains to west EGRESS)
// East avenue centreline. Was 275, which put the NORTHBOUND lane body 0.90u INSIDE
// the E-column stalls; that was fixed by shifting the E column east and centring the
// road in its corridor at 272.25.
//
// THE "14.31u CORRIDOR" NOTE THAT USED TO LIVE HERE WAS STALE, and it was talking the
// reader out of the founder's spec. It derived the corridor from E.x0 = 284.5 — the
// value that same fix had already replaced with 286.5. Re-measured on the built seed,
// footprint face to footprint face: TE east 408.535 ft, E west 432.921 ft => 24.39 ft.
// Before this change it measured 23.60 ft, and the guard had been printing that number
// all along ("tightest overall NASH-STG-E008 at 23.6 ft"). The founder's 24 ft two-way
// spec was 0.40 ft away, not 2.8 ft away.
//
// FOUNDER'S CALL (2026-08-11): build the east avenue and the temp aisle to the
// real-world ~24 ft two-way / 90-degree-parking standard. Two columns move EAST to buy
// it — the perimeter fence does not move:
//     E  column x0  286.5 -> 287.5   (+1.00u = 1.57 ft)
//     TE column x0  260   -> 260.5   (+0.50u = 0.79 ft)
// Corridor 15.534u = 24.39 ft, centred here at 274, so BOTH flanks get 2.465u (3.87 ft)
// of shy space instead of the lopsided 1.91 / 5.05 ft this layout had. ZERO stalls are
// lost to the avenue; the cost is setback — the E column's gap to the fence goes
// 2.77 -> 1.21 ft, and the E carport narrows 13 -> 12.5u so its roof keeps 0.79 ft off
// the fence.
//
// WHAT "24 FT" MEANS HERE, stated plainly so the render cannot imply more: it is the
// CLEAR AISLE between the stall faces, which is the dimension the parking standard
// specifies. The PAINTED road is narrower — 4 x rightOffset = 12.8u = 20.09 ft —
// because the lane offset stays 3.2 (widened from 2.4 for passing clearance; lanePaint
// derives from it). Widening the paint to exactly 24.00 ft needs rightOffset = 3.8219,
// which re-routes every car and is a separate, separately-measured decision.
//
// checkLayoutGeometry.mjs checks 7 and 9 and migration 0010 section 6.6 all assert
// clearance against these lanes, so this cannot regress.
export const EAST_AISLE_X = 274;  // east avenue (two-way divided; feeds from east INGRESS)
// North block, top to bottom: REAR APRON (full-width 30ft+ maneuvering zone
// behind the pull-through bays — no parking abuts it) → bay row → concrete
// FORECOURT (approach throat into the bay fronts) → NORTH COLLECTOR (two-way
// main artery). Collectors are two-way boulevards; aisles are one-way.
export const REAR_LANE_Y = 16;    // centerline of the rear apron (y 6..26)
export const FORECOURT_Y = 62;    // bay approach throat (y 56..68)
export const NORTH_LANE_Y = 74;   // main collector (y 68..80)
export const SOUTH_LANE_Y = 172;  // south collector (y 166..178, two-way)
// N1 APPROACH — the east-west lane serving the open NE overflow row.
//
// It had no lane of its own. routeToStall()'s `inTemp` predicate swallowed the N1
// row along with the TW/TE block and sent N1 traffic up TEMP_LANE_X to y=36 —
// straight THROUGH N1 stall 5, whose footprint spans render x 246.16..251.84 with
// the aisle centreline at x=247. So the one route into that row drove over a parked
// car. Splitting the predicate needs a lane to route onto; this is it.
//
// y=50 is the only band that fits. Measured in database feet against the built seed:
// the N1 stall faces sit at relative_y 257.88 and this lane's body reaches 253.23
// (4.65 ft of shy space), while the forecourt band's north edge is 234.38 and this
// lane's body starts at 236.58 (2.19 ft). Both are pavement-to-pavement gaps on the
// same concrete apron, so paint them as ONE mat, not as two separate roads.
export const N1_LANE_Y = 50;      // NE overflow approach (y 44.7..55.3)

// Pull-out travel lanes flanking each canopy (gas-pump flow: chargers feed
// out both sides into these, then north to the collector). NO landscaping or
// obstructions live in these lanes.
export const GAP_LANES = { westOfA: 80, AB: 126.5, BC: 173.5, eastOfC: 220 };
const GAP_LANE_XS = [GAP_LANES.westOfA, GAP_LANES.AB, GAP_LANES.BC, GAP_LANES.eastOfC];
/** The pull-out lane a charging stall feeds into = the nearest flanking lane. */
export function gapLaneX(stallX: number): number {
  return GAP_LANE_XS.reduce((best, x) =>
    Math.abs(x - stallX) < Math.abs(best - stallX) ? x : best, GAP_LANE_XS[0]);
}

// ---- Zone rectangles (logical coords; w/h in logical units) ----
export const LOT = { x: 6, y: 6, w: 288, h: 200 };

/** Feet per plan unit: 1u = 0.4785 m. The same yardstick scripts/buildLayoutSeed.mjs
 *  writes the database with (its UNIT_FT), stated here so the renderer can read
 *  database positions back instead of trusting a stall's CODE to say where it is. */
export const UNIT_FT = 0.4785 / 0.3048;
/** public.stalls relative_x / relative_y (feet; y NORTH-positive, origin at the lot's
 *  SW corner) -> plan units (y SOUTH-positive). The exact inverse of
 *  buildLayoutSeed's toX / toY. */
export function planFromDbFeet(xFt: number, yFt: number): { x: number; y: number } {
  return { x: LOT.x + xFt / UNIT_FT, y: LOT.y + LOT.h - yFt / UNIT_FT };
}
export const BESS_YARD = { x: 12, y: 12, w: 50, h: 36 };
export const BUILDING = { x: 70, y: 26, w: 80, h: 30 };   // office (west) + 2 service bays (east)
export const WASH = { x: 160, y: 26, w: 52, h: 30 };      // 3 pull-through bays
export const GATE_W = 14;

export interface CanopyDef {
  id: 'A' | 'B' | 'C';
  cx: number;        // center x
  x: number; w: number;
  y: number; h: number;
  kind: 'dcfc' | 'l2';
}
// West link: the corridor between the BESS yard (ends x=62) and the building
// (starts x=70) tying the rear apron to the collector for left-hand exits.
export const WEST_LINK_X = 66;

export const CANOPIES: CanopyDef[] = [
  { id: 'A', cx: 103, x: 88, w: 30, y: 80, h: 84, kind: 'dcfc' },
  { id: 'B', cx: 150, x: 135, w: 30, y: 80, h: 84, kind: 'l2' },
  { id: 'C', cx: 197, x: 182, w: 30, y: 80, h: 84, kind: 'l2' },
];

// Perimeter parking runs (solar carports above each; temp/overflow runs are open-air)
export interface ParkRun {
  id: string;
  // first stall center + per-stall step
  x0: number; y0: number; dx: number; dy: number; n: number;
  angle: number; // parked car orientation (deg: 0=N, 90=E, 180=S, 270=W)
  carport?: { x: number; y: number; w: number; h: number };
}
// Central access aisle of the temporary/overflow staging block (retail-style
// double-loaded: facing stall columns pull in off this aisle from both sides).
export const TEMP_LANE_X = 247;
// NOTE: no parking abuts the rear apron — bay-rear exits need clear
// maneuvering room before any stall. W/E columns stop short of the south
// rows so corner stalls never overlap.
export const PARK_RUNS: ParkRun[] = [
  { id: 'W',  x0: 15.5, y0: 58,  dx: 0,   dy: 5.7, n: 24, angle: 90,  carport: { x: 9,   y: 54,  w: 13, h: 141 } },
  // E column moved +1.0u east (see EAST_AISLE_X) to buy the 24 ft avenue. The carport
  // narrows 13 -> 12.5u at x=281 so its roof still clears the fence by 0.79 ft while
  // covering every stall centre. No stall is lost.
  { id: 'E',  x0: 287.5, y0: 46,  dx: 0,   dy: 5.7, n: 25, angle: 90,  carport: { x: 281, y: 42,  w: 12.5, h: 147 } },
  { id: 'S1', x0: 24,  y0: 197,  dx: 6.4, dy: 0,   n: 11, angle: 0,   carport: { x: 20,  y: 191, w: 72, h: 13 } },
  { id: 'S2', x0: 112, y0: 197,  dx: 6.9, dy: 0,   n: 12, angle: 0,   carport: { x: 108, y: 191, w: 84, h: 13 } },
  { id: 'S3', x0: 212, y0: 197,  dx: 6.4, dy: 0,   n: 10, angle: 0,   carport: { x: 208, y: 191, w: 68, h: 13 } },
  // open-air overflow, NE zone: a short row south of the rear-apron buffer.
  // x0 228 -> 225 pulls the row WEST off the east avenue. Its last stall used to end
  // at relative_x 418.91, which is 9.2 ft INSIDE the avenue's southbound lane body
  // (409.71..416.31) — the avenue really runs from the rear apron down, so that row
  // end stood in live road. The guard never saw it: check 7's avenue rectangle stops
  // at the north collector, well SOUTH of this row. It now clears by 7.62 ft, and
  // check 9 extends the rectangle so the blind spot is closed.
  { id: 'N1', x0: 225, y0: 36,   dx: 6,   dy: 0,   n: 7,  angle: 0 },
  // …and the retail-style temp block: two facing columns off the central aisle.
  //
  // 13 -> 12 STALLS PER COLUMN. FOUNDER'S DECISION (2026-08-11), taken with the cost
  // stated: two spaces are given up to get parked cars out of the road. The 13th stalls
  // (NASH-STG-B013 / I013) had their CENTRES on the south collector's centreline and
  // overlapped its eastbound lane body by 6.42 ft — the guard's only FAIL on main.
  //
  // dy 7 -> 6.7 is the tightest pitch that still declares a full 10.00 ft stall width:
  // buildLayoutSeed caps the along-run dimension at (pitch - 0.5 ft), so the floor is
  // dy = 10.5 / 1.56988 = 6.6884u. At 6.7u the pitch is 10.518 ft and the declared
  // width is min(10, 10.018) = 10.00 ft — nothing is narrowed to buy the room.
  // y0 86 -> 86.15 re-centres the shortened column between the two collectors: it now
  // clears the north collector by 5.75 ft AND the south collector by 5.75 ft, where
  // before it was +5.52 north and -6.42 (overlapping) south.
  //
  // The two columns move symmetrically about TEMP_LANE_X (-0.5u west, +0.5u east), so
  // the aisle constant itself never moves and the aisle opens 22.82 -> 24.39 ft.
  { id: 'TW', x0: 233.5, y0: 86.15, dx: 0, dy: 6.7, n: 12, angle: 270 },
  { id: 'TE', x0: 260.5, y0: 86.15, dx: 0, dy: 6.7, n: 12, angle: 90 },
];

// ---- Painted pavement, derived from the parking ----------------------------
//
// The 2D and 3D renderers used to draw each drive aisle as a hand-typed rectangle:
// the temp aisle was `TEMP_LANE_X - 5, width 10` = 15.70 ft of tint over what is now
// 24.39 ft of real aisle, and the east avenue was a flat `width 12`. A number typed
// into a paint layer cannot track a column that moves, so the picture drifted from the
// plan — and the picture is what gets walked through.
//
// So the pavement is DERIVED from the stall faces it runs between.
//
/** Half the depth of a parked car's footprint, in render units.
 *  = (staging nominal depth 18 ft) / 2 / 1.56988 ft-per-unit = 5.7329 u.
 *  The counterpart is NOMINAL.staging.depth in scripts/buildLayoutSeed.mjs, which is
 *  what the database declares. They are bound by a test (sitePlan.aisles.test.ts) that
 *  reads the committed seed, so this cannot quietly disagree with the DB. */
export const STALL_HALF_DEPTH_U = 18 / 2 / 1.5698818897637796;

/** Clear pavement between two facing parking columns: the drive aisle, in render
 *  units. Both runs must be x-fixed columns (dx = 0) facing each other. */
export function clearAisleBetween(westRunId: string, eastRunId: string) {
  const w = PARK_RUNS.find((r) => r.id === westRunId);
  const e = PARK_RUNS.find((r) => r.id === eastRunId);
  if (!w || !e) throw new Error(`clearAisleBetween: unknown run ${westRunId}/${eastRunId}`);
  if (w.dx !== 0 || e.dx !== 0) throw new Error('clearAisleBetween: both runs must be x-fixed columns');
  const x0 = w.x0 + STALL_HALF_DEPTH_U;   // east face of the west column
  const x1 = e.x0 - STALL_HALF_DEPTH_U;   // west face of the east column
  return { x0, x1, width: x1 - x0, centre: (x0 + x1) / 2 };
}

/** The two aisles the founder specified to the ~24 ft two-way standard. */
export const TEMP_AISLE = clearAisleBetween('TW', 'TE');
export const EAST_AVENUE = clearAisleBetween('TE', 'E');

// Overhead site lighting (24/7 ops) — placed at zone edges + canopy end-caps.
//
// THE CLAIM ABOVE THIS LIST USED TO BE "NEVER in a travel lane". IT WAS FALSE, and
// nothing checked it: check 7 tests stalls against lanes, and nothing tested
// STRUCTURES against lanes. Measured on the built seed, FOUR of these 1.5 ft poles
// stood inside a lane body a car actually drives:
//     {36,174}   inside the south collector westbound  (body y 45.05..51.65; pole 50.24..51.74)
//     {268,60}   inside the east avenue southbound     (body x 409.71..416.31; pole 411.31..412.81)
//     {268,120}  inside the east avenue southbound     (same body, same x)
//     {268,174}  inside the south collector westbound
// Every position below is now measured against the lane bodies, and check 9 in
// scripts/checkLayoutGeometry.mjs asserts it — so "never in a travel lane" is an
// enforced statement rather than a hopeful comment.
//
// The count stays 11 and the ORDER is unchanged, because buildLayoutSeed names these
// by index (LIGHT-01..11). Re-ordering would silently re-point every DB row.
export const LIGHT_POLES: { x: number; y: number }[] = [
  // West edge: 36 -> 38 clears the west avenue's northbound body (max 46.00 ft) by
  // 4.24 ft instead of 1.10 ft. The third pole also drops off the south collector,
  // 174 -> 162, for 7.38 ft of clearance.
  { x: 38, y: 60 }, { x: 38, y: 120 }, { x: 38, y: 162 },
  // East side: x=268 is INSIDE the east avenue. These three re-home onto the temp
  // block's own column end-caps, which is where they light the work anyway:
  // the TW/TE north caps (y=81.7, 2.26 ft north of the collector body and 1.99 ft
  // clear of stall 1) and the TE south cap (y=165, 2.67 ft off the south collector
  // and 1.58 ft clear of stall 12).
  { x: 233.5, y: 81.7 }, { x: 260.5, y: 81.7 }, { x: 260.5, y: 165 },
  // Canopy end-cap poles: one per canopy, on its centre spine (cx 103/150/197) at the
  // SOUTH cap, between the roof edge (y=164) and the south collector. 166 -> 165.3
  // splits that gap properly: collector clearance 1.09 -> 2.19 ft, roof clearance
  // 1.65 -> 0.55 ft, so the 18u pole still never pokes through the roof.
  { x: 103, y: 165.3 }, { x: 150, y: 165.3 }, { x: 197, y: 165.3 },
  { x: 52, y: 9 }, { x: 218, y: 29 },
];

// ---- Stall generation (consumed by depotStore.generateStalls) ----

function chargingStalls(dcfcCount: number, l2Count: number): StallState[] {
  const stalls: StallState[] = [];
  // Gas-pump lanes: cars at cx±7 (the lane), charger pedestal beside each car at cx±2.5.
  // 2-deep pull-through along y; angle 180 = parked facing south (direction of travel).
  const mk = (id: string, type: 'dcfc' | 'l2', x: number, y: number): StallState => ({
    id, type, status: 'available', vehicleId: null,
    position: { x, y, angle: 180 },
  });

  // Canopy A — DCFC, 2 columns × 5 (step 16 = roomy pull-in/pull-out)
  const A = CANOPIES[0];
  let n = 0;
  for (const side of [-7, 7]) {
    for (let i = 0; i < 5 && n < dcfcCount; i++) {
      n++;
      stalls.push(mk(`DCFC-${String(n).padStart(2, '0')}`, 'dcfc', A.cx + side, 88 + i * 16));
    }
  }

  // Canopies B & C — L2, west column 8 + east column 7
  //
  // WEST COLUMN PITCH 10.3 -> 10.6, y0 86 -> 85.9.
  // The 16 west-column L2 stalls were declared 10.00 x 15.67 ft against a 16.0 ft
  // design vehicle — THE STALL WAS SHORTER THAN THE CAR, and the guard had been
  // reporting it as a WARN nobody actioned. The declared depth is capped at
  // (pitch - 0.5 ft) by buildLayoutSeed, so 10.3u = 16.17 ft of pitch could only ever
  // declare 15.67 ft. 10.6u gives 16.64 ft of pitch and a 16.14 ft stall, which holds
  // the design vehicle. NO STALL IS LOST — still 8 per column, 30 L2 total, and no L2
  // code is deleted.
  //
  // Both sides measured, because the room came from somewhere: the column's clearance
  // to the north collector goes 2.68 -> 2.29 ft and to the south collector 5.66 ->
  // 2.29 ft (both still clear), and the last stall's declared footprint now extends
  // 1.95 ft past the canopy roof's south edge — a canopy that stops short of a bumper
  // is normal, and the roof is not a solid obstruction (guard check 4 excludes it).
  // If the roof edge matters more than the extra margin, pitch 10.55 / y0 85.6 gives
  // 16.06 ft of depth and 0.89 ft of overhang and is also fully green.
  //
  // buildLayoutSeed.mjs carries the matching pitch; they are asserted equal by
  // sitePlan.aisles.test.ts reading the committed seed.
  let l2 = 0;
  for (const c of [CANOPIES[1], CANOPIES[2]]) {
    for (let i = 0; i < 8 && l2 < l2Count; i++) {
      l2++;
      stalls.push(mk(`L2-${String(l2).padStart(2, '0')}`, 'l2', c.cx - 7, 85.9 + i * 10.6));
    }
    for (let i = 0; i < 7 && l2 < l2Count; i++) {
      l2++;
      stalls.push(mk(`L2-${String(l2).padStart(2, '0')}`, 'l2', c.cx + 7, 91 + i * 11));
    }
  }
  return stalls;
}

function bayStalls(washCount: number, serviceCount: number): StallState[] {
  const stalls: StallState[] = [];
  // Pull-through bays: enter south door driving north, exit rear (north). angle 0 = facing north.
  for (let i = 0; i < serviceCount; i++) {
    stalls.push({
      id: `SVC-${String(i + 1).padStart(2, '0')}`, type: 'service', status: 'available',
      vehicleId: null, position: { x: 120 + i * 18, y: 41, angle: 0 },
    });
  }
  for (let i = 0; i < washCount; i++) {
    stalls.push({
      id: `WASH-${String(i + 1).padStart(2, '0')}`, type: 'wash', status: 'available',
      vehicleId: null, position: { x: 168 + i * 18, y: 41, angle: 0 },
    });
  }
  return stalls;
}

function stagingStalls(count: number): StallState[] {
  const stalls: StallState[] = [];
  let n = 0;
  for (const run of PARK_RUNS) {
    for (let i = 0; i < run.n && n < count; i++) {
      n++;
      stalls.push({
        id: `STAGE-${String(n).padStart(2, '0')}`, type: 'staging', status: 'available',
        vehicleId: null,
        position: { x: run.x0 + i * run.dx, y: run.y0 + i * run.dy, angle: run.angle },
      });
    }
  }
  return stalls;
}

export function generateStallsV2(
  // stagingCount 115 -> 113: the founder's 13 -> 12 cut on the TW and TE temp columns.
  // It is a CAP, not a target — stagingStalls() stops at the runs' own total — so the
  // old default silently over-declared by 2 once the columns shrank.
  dcfcCount = 10, l2Count = 30, washCount = 3, stagingCount = 113, serviceCount = 2,
): StallState[] {
  return [
    ...chargingStalls(dcfcCount, l2Count),
    ...bayStalls(washCount, serviceCount),
    ...stagingStalls(stagingCount),
  ];
}

// ---- Routing (continuous-flow circulation; consumed by SimulationEngine) ----
// Gas-pump charging: enter a flanking pull-out lane from the collector, drop
// to stall depth, sidestep IN. Exit = sidestep OUT into the lane, head NORTH
// to the collector — service/wash is straight ahead through the forecourt.
// Bays are full pull-through: out the rear into the 30ft apron, then left
// (west link) or right (east aisle) to parking or the egress gate.
// Collectors are two-way; west aisle is northbound; east aisle southbound.

type Pt = { x: number; y: number };

const inCanopy = (p: Pt) => p.y >= CANOPIES[0].y - 2 && p.y <= CANOPIES[0].y + CANOPIES[0].h + 2 && p.x > 60 && p.x < 222;
const inBays = (p: Pt) => p.y < FORECOURT_Y - 6 && p.y > REAR_LANE_Y + 6 && p.x > 64 && p.x < 220;

// ---- NE overflow: TWO zones, two different lanes ----------------------------
//
// These used to be ONE predicate (`inTemp`, x 222..272, y 28..164) covering the N1 row
// AND the TW/TE block, and it routed everything it caught up TEMP_LANE_X to y=36.
// TEMP_LANE_X is 247; N1 stall 5 sits at x=247 and spans 246.16..251.84. So the single
// route into the N1 row drove the length of a parked car. The zones are separated here
// and each gets its own lane: the block rides TEMP_LANE_X, the row rides N1_LANE_Y.
//
// The bounds are DERIVED from PARK_RUNS, not retyped, so moving a column moves the
// predicate with it. Half a stall footprint plus a design-vehicle width of slack on
// each side, in RENDER UNITS (staging nominal is 10 x 18 ft = 6.37 x 11.47 u; a car
// lying on the x axis is 18 ft deep on x and 10 ft wide on y).
const RUN = (id: string) => PARK_RUNS.find((r) => r.id === id)!;
const runSpan = (id: string) => {
  const r = RUN(id);
  return { x0: r.x0, x1: r.x0 + (r.n - 1) * r.dx, y0: r.y0, y1: r.y0 + (r.n - 1) * r.dy };
};
/** The retail-style temp block: the TW and TE columns facing each other across
 *  TEMP_LANE_X. Served by the aisle, north-south. */
const inTempBlock = (p: Pt) => {
  const w = runSpan('TW'), e = runSpan('TE');
  return p.x > w.x0 - 8 && p.x < e.x0 + 8 && p.y > w.y0 - 8 && p.y < w.y1 + 8;
};
/** The open N1 overflow row along the top of the NE zone. Served by N1_LANE_Y,
 *  east-west — it is a single row, so a car sidesteps in off a lane BELOW it. */
const inN1 = (p: Pt) => {
  const r = runSpan('N1');
  return p.x > r.x0 - 8 && p.x < r.x1 + 8 && p.y > r.y0 - 8 && p.y < r.y0 + 8;
};

/** Legs from a position onto the NORTH collector (the main artery). */
function toCollector(from: Pt): Pt[] {
  if (inBays(from)) {
    // pull through the rear, swing right (east aisle side) or left (west link)
    const exitX = from.x >= 150 ? EAST_AISLE_X : WEST_LINK_X;
    return [
      { x: from.x, y: REAR_LANE_Y },
      { x: exitX, y: REAR_LANE_Y },
      { x: exitX, y: NORTH_LANE_Y },
    ];
  }
  if (inTempBlock(from)) {
    // temp block: sidestep into the central aisle, then north
    return [
      { x: TEMP_LANE_X, y: from.y },
      { x: TEMP_LANE_X, y: NORTH_LANE_Y },
    ];
  }
  if (inN1(from)) {
    // N1 row: back out SOUTH onto its own approach lane, then east to the avenue
    // and down. Never up TEMP_LANE_X — that is what drove through N1 stall 5.
    return [
      { x: from.x, y: N1_LANE_Y },
      { x: EAST_AISLE_X, y: N1_LANE_Y },
      { x: EAST_AISLE_X, y: NORTH_LANE_Y },
    ];
  }
  if (inCanopy(from)) {
    // gas-pump exit: sidestep into the flanking lane, then north
    const lane = gapLaneX(from.x);
    return [
      { x: lane, y: from.y },
      { x: lane, y: NORTH_LANE_Y },
    ];
  }
  if (from.x < 26) {
    // west parking: pull out, ride the west aisle north
    return [
      { x: WEST_AISLE_X, y: from.y },
      { x: WEST_AISLE_X, y: NORTH_LANE_Y },
    ];
  }
  if (from.x > 278) {
    // east parking: east aisle is southbound — ride the full ring back up
    return [
      { x: EAST_AISLE_X, y: from.y },
      { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
      { x: WEST_AISLE_X, y: SOUTH_LANE_Y },
      { x: WEST_AISLE_X, y: NORTH_LANE_Y },
    ];
  }
  // south band (ingress road / queue / south rows): west aisle north
  return [
    { x: from.x, y: SOUTH_LANE_Y },
    { x: WEST_AISLE_X, y: SOUTH_LANE_Y },
    { x: WEST_AISLE_X, y: NORTH_LANE_Y },
  ];
}

/** Final legs from the NORTH collector into a stall. */
function fromCollector(stall: Pt): Pt[] {
  if (stall.y < FORECOURT_Y) {
    // bays: straight in through the forecourt throat
    return [
      { x: stall.x, y: NORTH_LANE_Y },
      { x: stall.x, y: stall.y },
    ];
  }
  if (inTempBlock(stall)) {
    // temp block: ride the central aisle to depth, sidestep in
    return [
      { x: TEMP_LANE_X, y: NORTH_LANE_Y },
      { x: TEMP_LANE_X, y: stall.y },
      { x: stall.x, y: stall.y },
    ];
  }
  if (inN1(stall)) {
    // N1 row: collector east -> avenue north -> the N1 approach lane, then
    // sidestep NORTH into the stall. The stall row sits ABOVE this lane.
    return [
      { x: EAST_AISLE_X, y: NORTH_LANE_Y },
      { x: EAST_AISLE_X, y: N1_LANE_Y },
      { x: stall.x, y: N1_LANE_Y },
      { x: stall.x, y: stall.y },
    ];
  }
  if (inCanopy(stall)) {
    // gas-pump entry: ride the flanking lane to depth, sidestep in
    const lane = gapLaneX(stall.x);
    return [
      { x: lane, y: NORTH_LANE_Y },
      { x: lane, y: stall.y },
      { x: stall.x, y: stall.y },
    ];
  }
  if (stall.x > 278) {
    // east parking: collector east → east aisle south → stall
    return [
      { x: EAST_AISLE_X, y: NORTH_LANE_Y },
      { x: EAST_AISLE_X, y: stall.y },
      { x: stall.x, y: stall.y },
    ];
  }
  if (stall.x < 26) {
    // west parking: ring down the east aisle, back along the south collector
    return [
      { x: EAST_AISLE_X, y: NORTH_LANE_Y },
      { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
      { x: WEST_AISLE_X, y: SOUTH_LANE_Y },
      { x: WEST_AISLE_X, y: stall.y },
      { x: stall.x, y: stall.y },
    ];
  }
  // south parking rows: east aisle down, along the south collector
  return [
    { x: EAST_AISLE_X, y: NORTH_LANE_Y },
    { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
    { x: stall.x, y: SOUTH_LANE_Y },
    { x: stall.x, y: stall.y },
  ];
}

/** Route from a current position to an assigned stall. */
export function routeToStall(from: Pt, stall: Pt): Pt[] {
  return [...toCollector(from), ...fromCollector(stall)];
}

/** Route from a current position out the egress gate. */
export function routeToEgress(from: Pt): Pt[] {
  // already in the south band → straight along the south collector to the gate
  if (from.y > CANOPIES[0].y + CANOPIES[0].h && from.x >= 26 && from.x <= 278) {
    return [
      { x: from.x, y: SOUTH_LANE_Y },
      { x: EGRESS.x, y: SOUTH_LANE_Y },
      { ...EGRESS },
    ];
  }
  if (from.x > 278) {
    return [
      { x: EAST_AISLE_X, y: from.y },
      { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
      { x: EGRESS.x, y: SOUTH_LANE_Y },
      { ...EGRESS },
    ];
  }
  // everywhere else: get to the collector, ride the east aisle down, gate
  return [
    ...toCollector(from),
    { x: EAST_AISLE_X, y: NORTH_LANE_Y },
    { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
    { x: EGRESS.x, y: SOUTH_LANE_Y },
    { ...EGRESS },
  ];
}

/** Route a fresh arrival from the ingress gate to a holding spot on the queue row. */
export function routeToQueue(queueX: number): Pt[] {
  return [
    { x: INGRESS.x, y: SOUTH_LANE_Y },
    { x: WEST_AISLE_X, y: SOUTH_LANE_Y },
    { x: WEST_AISLE_X, y: QUEUE_Y },
    { x: queueX, y: QUEUE_Y },
  ];
}
