/**
 * OTTOYARD SITE PLAN v2 — single source of truth for depot geometry.
 *
 * Logical 2D coordinates: x 0..300 (west→east), y 0..220 (north→south).
 * 3D world mapping via coordUtils.toWorld(): worldX = x-150, worldZ = 110-y.
 * 1 logical unit ≈ 1.57 ft (lot ≈ 470ft × 345ft).
 *
 * Layout (locked 2026-06-08, mirrors depot-3d-v2.html):
 *  - Fenced perimeter, one-way flow: ingress (S-W gate) → west aisle north →
 *    north travel lane → south down a canopy charge lane (gas-pump pull-through,
 *    2-deep) or into service/wash bays (pull-through to rear lane) → east aisle
 *    south → egress (S-E gate).
 *  - NW corner: secured BESS yard. North-center: office + 2 service bays.
 *    Beside them (travel lane between): 3 wash bays. Perimeter parking on all
 *    sides under solar carports. 3 central solar canopies: 10 DCFC + 30 L2.
 */

import type { StallState } from '@/store/depotStore';

// ---- Flow constants (consumed by SimulationEngine / ArrivalGenerator) ----
export const INGRESS = { x: 100, y: 215 };
export const EGRESS = { x: 200, y: 215 };
export const QUEUE_Y = 184;
export const WEST_AISLE_X = 30;   // one-way northbound
export const EAST_AISLE_X = 275;  // one-way southbound (to egress)
// North block, top to bottom: rear egress lane (behind the bays) → bay row →
// concrete FORECOURT (dedicated approach throat into the bay fronts) → the
// NORTH COLLECTOR (main east-west artery off the charging lanes).
export const REAR_LANE_Y = 11;    // pull-through lane behind service/wash bays (y 8..16)
export const FORECOURT_Y = 53;    // bay approach throat (y 46..60)
export const NORTH_LANE_Y = 67;   // main collector (y 60..74)
export const SOUTH_LANE_Y = 168;  // south collector (y 160..176)

// ---- Zone rectangles (logical coords; w/h in logical units) ----
export const LOT = { x: 6, y: 6, w: 288, h: 200 };
export const BESS_YARD = { x: 12, y: 12, w: 50, h: 36 };
export const BUILDING = { x: 70, y: 16, w: 80, h: 30 };   // office (west) + 2 service bays (east)
export const WASH = { x: 160, y: 16, w: 52, h: 30 };      // 3 pull-through bays
export const GATE_W = 14;

export interface CanopyDef {
  id: 'A' | 'B' | 'C';
  cx: number;        // center x
  x: number; w: number;
  y: number; h: number;
  kind: 'dcfc' | 'l2';
}
export const CANOPIES: CanopyDef[] = [
  { id: 'A', cx: 103, x: 88, w: 30, y: 74, h: 84, kind: 'dcfc' },
  { id: 'B', cx: 150, x: 135, w: 30, y: 74, h: 84, kind: 'l2' },
  { id: 'C', cx: 197, x: 182, w: 30, y: 74, h: 84, kind: 'l2' },
];

// Perimeter parking runs (solar carports above each)
export interface ParkRun {
  id: string;
  // first stall center + per-stall step
  x0: number; y0: number; dx: number; dy: number; n: number;
  angle: number; // parked car orientation (deg, 0 = facing north/south axis)
  carport: { x: number; y: number; w: number; h: number };
}
export const PARK_RUNS: ParkRun[] = [
  { id: 'W',  x0: 15.5, y0: 58,  dx: 0,   dy: 5.8, n: 27, angle: 90, carport: { x: 9,   y: 54,  w: 13, h: 158 } },
  { id: 'E',  x0: 284.5, y0: 54, dx: 0,   dy: 5.8, n: 27, angle: 90, carport: { x: 278, y: 50,  w: 13, h: 162 } },
  { id: 'S1', x0: 24,  y0: 197,  dx: 6.4, dy: 0,   n: 11, angle: 0,  carport: { x: 20,  y: 191, w: 72, h: 13 } },
  { id: 'S2', x0: 112, y0: 197,  dx: 6.9, dy: 0,   n: 12, angle: 0,  carport: { x: 108, y: 191, w: 84, h: 13 } },
  { id: 'S3', x0: 212, y0: 197,  dx: 6.4, dy: 0,   n: 10, angle: 0,  carport: { x: 208, y: 191, w: 68, h: 13 } },
  { id: 'NE', x0: 222, y0: 13,   dx: 6.4, dy: 0,   n: 10, angle: 0,  carport: { x: 218, y: 7,   w: 68, h: 13 } },
];

// Overhead site lighting (24/7 ops)
export const LIGHT_POLES: { x: number; y: number }[] = [
  { x: 36, y: 60 }, { x: 36, y: 120 }, { x: 36, y: 174 },
  { x: 268, y: 60 }, { x: 268, y: 120 }, { x: 268, y: 174 },
  { x: 126, y: 60 }, { x: 174, y: 60 },
  { x: 126, y: 172 }, { x: 174, y: 172 },
  { x: 66, y: 16 }, { x: 218, y: 16 },
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

  // Canopy A — DCFC, 2 columns × 5 (step 16 = roomy pull-through)
  const A = CANOPIES[0];
  let n = 0;
  for (const side of [-7, 7]) {
    for (let i = 0; i < 5 && n < dcfcCount; i++) {
      n++;
      stalls.push(mk(`DCFC-${String(n).padStart(2, '0')}`, 'dcfc', A.cx + side, 82 + i * 16));
    }
  }

  // Canopies B & C — L2, west column 8 + east column 7
  let l2 = 0;
  for (const c of [CANOPIES[1], CANOPIES[2]]) {
    for (let i = 0; i < 8 && l2 < l2Count; i++) {
      l2++;
      stalls.push(mk(`L2-${String(l2).padStart(2, '0')}`, 'l2', c.cx - 7, 80 + i * 10.3));
    }
    for (let i = 0; i < 7 && l2 < l2Count; i++) {
      l2++;
      stalls.push(mk(`L2-${String(l2).padStart(2, '0')}`, 'l2', c.cx + 7, 85 + i * 11));
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
      vehicleId: null, position: { x: 120 + i * 18, y: 31, angle: 0 },
    });
  }
  for (let i = 0; i < washCount; i++) {
    stalls.push({
      id: `WASH-${String(i + 1).padStart(2, '0')}`, type: 'wash', status: 'available',
      vehicleId: null, position: { x: 168 + i * 18, y: 31, angle: 0 },
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
  dcfcCount = 10, l2Count = 30, washCount = 3, stagingCount = 97, serviceCount = 2,
): StallState[] {
  return [
    ...chargingStalls(dcfcCount, l2Count),
    ...bayStalls(washCount, serviceCount),
    ...stagingStalls(stagingCount),
  ];
}

// ---- Routing (one-way circulation; consumed by SimulationEngine) ----
// Ingress → west aisle north → north travel lane east → south down the target
// lane (gas-pump pull-through). Bays exit through their rear into the rear
// lane. Departures collect on the south lane eastbound to the egress gate.

type Pt = { x: number; y: number };
const BAY_EXIT_X = 214; // corridor between wash bays (ends x=212) and NE carport (starts x=218)

/** Route from a current position to an assigned stall. */
export function routeToStall(from: Pt, stall: Pt): Pt[] {
  if (from.y < NORTH_LANE_Y) {
    // Leaving a bay: pull through the rear lane, around the corridor, back via north lane.
    return [
      { x: from.x, y: REAR_LANE_Y },
      { x: BAY_EXIT_X, y: REAR_LANE_Y },
      { x: BAY_EXIT_X, y: NORTH_LANE_Y },
      { x: stall.x, y: NORTH_LANE_Y },
      { x: stall.x, y: stall.y },
    ];
  }
  // Standard: south collector → west aisle north → north lane → down the stall lane.
  return [
    { x: from.x, y: SOUTH_LANE_Y },
    { x: WEST_AISLE_X, y: SOUTH_LANE_Y },
    { x: WEST_AISLE_X, y: NORTH_LANE_Y },
    { x: stall.x, y: NORTH_LANE_Y },
    { x: stall.x, y: stall.y },
  ];
}

/** Route from a current position out the egress gate. */
export function routeToEgress(from: Pt): Pt[] {
  if (from.y < NORTH_LANE_Y) {
    if (from.x >= 218) {
      // NE parking row → north lane → east aisle south → south collector → gate
      return [
        { x: from.x, y: NORTH_LANE_Y },
        { x: EAST_AISLE_X, y: NORTH_LANE_Y },
        { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
        { x: EGRESS.x, y: SOUTH_LANE_Y },
        { ...EGRESS },
      ];
    }
    // Service/wash bays: pull through rear lane → corridor → north lane → east aisle → gate
    return [
      { x: from.x, y: REAR_LANE_Y },
      { x: BAY_EXIT_X, y: REAR_LANE_Y },
      { x: BAY_EXIT_X, y: NORTH_LANE_Y },
      { x: EAST_AISLE_X, y: NORTH_LANE_Y },
      { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
      { x: EGRESS.x, y: SOUTH_LANE_Y },
      { ...EGRESS },
    ];
  }
  if (from.x < 26) {
    // West parking column → west aisle → south collector → gate
    return [
      { x: WEST_AISLE_X, y: from.y },
      { x: WEST_AISLE_X, y: SOUTH_LANE_Y },
      { x: EGRESS.x, y: SOUTH_LANE_Y },
      { ...EGRESS },
    ];
  }
  if (from.x > 278) {
    // East parking column → east aisle south → south collector → gate
    return [
      { x: EAST_AISLE_X, y: from.y },
      { x: EAST_AISLE_X, y: SOUTH_LANE_Y },
      { x: EGRESS.x, y: SOUTH_LANE_Y },
      { ...EGRESS },
    ];
  }
  // Canopy lanes & south staging: continue south (pull-through) → collector east → gate
  return [
    { x: from.x, y: SOUTH_LANE_Y },
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
