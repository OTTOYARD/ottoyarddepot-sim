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
export const INGRESS = { x: 100, y: 215 };
export const EGRESS = { x: 200, y: 215 };
export const QUEUE_Y = 184;
export const WEST_AISLE_X = 30;   // one-way northbound
export const EAST_AISLE_X = 275;  // one-way southbound (to egress)
// North block, top to bottom: REAR APRON (full-width 30ft+ maneuvering zone
// behind the pull-through bays — no parking abuts it) → bay row → concrete
// FORECOURT (approach throat into the bay fronts) → NORTH COLLECTOR (two-way
// main artery). Collectors are two-way boulevards; aisles are one-way.
export const REAR_LANE_Y = 16;    // centerline of the rear apron (y 6..26)
export const FORECOURT_Y = 62;    // bay approach throat (y 56..68)
export const NORTH_LANE_Y = 74;   // main collector (y 68..80)
export const SOUTH_LANE_Y = 172;  // south collector (y 166..178, two-way)

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
  { id: 'E',  x0: 284.5, y0: 46, dx: 0,   dy: 5.7, n: 25, angle: 90,  carport: { x: 278, y: 42,  w: 13, h: 147 } },
  { id: 'S1', x0: 24,  y0: 197,  dx: 6.4, dy: 0,   n: 11, angle: 0,   carport: { x: 20,  y: 191, w: 72, h: 13 } },
  { id: 'S2', x0: 112, y0: 197,  dx: 6.9, dy: 0,   n: 12, angle: 0,   carport: { x: 108, y: 191, w: 84, h: 13 } },
  { id: 'S3', x0: 212, y0: 197,  dx: 6.4, dy: 0,   n: 10, angle: 0,   carport: { x: 208, y: 191, w: 68, h: 13 } },
  // open-air overflow, NE zone: a short row south of the rear-apron buffer…
  { id: 'N1', x0: 228, y0: 36,   dx: 6,   dy: 0,   n: 7,  angle: 0 },
  // …and the retail-style temp block: two facing columns off the central aisle
  { id: 'TW', x0: 234, y0: 86,   dx: 0,   dy: 6,   n: 13, angle: 270 },
  { id: 'TE', x0: 260, y0: 86,   dx: 0,   dy: 6,   n: 13, angle: 90 },
];

// Overhead site lighting (24/7 ops) — placed at zone edges, never in a lane
// (the apron swing at y≈16 and the West Link at x=66 stay clear).
export const LIGHT_POLES: { x: number; y: number }[] = [
  { x: 36, y: 60 }, { x: 36, y: 120 }, { x: 36, y: 174 },
  { x: 268, y: 60 }, { x: 268, y: 120 }, { x: 268, y: 174 },
  { x: 126, y: 60 }, { x: 174, y: 60 },
  { x: 126, y: 172 }, { x: 174, y: 172 },
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
  let l2 = 0;
  for (const c of [CANOPIES[1], CANOPIES[2]]) {
    for (let i = 0; i < 8 && l2 < l2Count; i++) {
      l2++;
      stalls.push(mk(`L2-${String(l2).padStart(2, '0')}`, 'l2', c.cx - 7, 86 + i * 10.3));
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
  dcfcCount = 10, l2Count = 30, washCount = 3, stagingCount = 115, serviceCount = 2,
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
// NE overflow zone: the N1 row + the TW/TE temp block, all served by TEMP_LANE_X
const inTemp = (p: Pt) => p.x > 222 && p.x < 272 && p.y > 28 && p.y < 164;

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
  if (inTemp(from)) {
    // overflow zone: sidestep into the central aisle, then north
    return [
      { x: TEMP_LANE_X, y: from.y },
      { x: TEMP_LANE_X, y: NORTH_LANE_Y },
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
  if (inTemp(stall)) {
    // overflow zone: ride the central aisle to depth, sidestep in
    return [
      { x: TEMP_LANE_X, y: NORTH_LANE_Y },
      { x: TEMP_LANE_X, y: stall.y },
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
