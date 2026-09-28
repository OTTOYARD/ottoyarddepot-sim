/**
 * STRUCTURE PLAN — where the depot's built things stand, derived from the site
 * plan so they cannot drift from where the cars drive.
 *
 * Pure geometry, no React. The 3D shells (DepotBuilding, WashBays), the charging
 * canopies and the perimeter carports all draw FROM this module, and
 * structurePlan.test.ts measures it against the routes, stalls and chargers.
 *
 * Why it exists — three defects, all the same shape (a structure placed by a
 * number typed into a renderer, never checked against the thing it must clear):
 *
 *   1. The operations building and the wash hall were SOLID boxes with a dark
 *      rectangle painted where each door should be, and the door x-positions
 *      used a formula written before toWorld negated X — so the service "doors"
 *      were drawn 60 units east of the service bays. Every car routed into a bay
 *      drove into a wall.
 *   2. The perimeter carport posts stood on the carport CENTRELINE, which is the
 *      stall centreline: the first W-column post sat exactly on stall 1's centre.
 *   3. The canopy spine columns were spaced every 19u from an arbitrary origin,
 *      and three of them landed on charger cabinets.
 *
 * Plan units throughout (1u = 0.4785 m), plan y is SOUTH-positive: a building's
 * SOUTH wall is at y1 (the forecourt entry side) and its NORTH wall at y0 (the
 * rear-apron exit side). Bays are pull-through: in the south door, out the north.
 */
import {
  BUILDING, WASH, CANOPIES, PARK_RUNS, SERVICE_BAY_XS, WASH_BAY_XS, BAY_STALL_Y,
  generateStallsV2, type CanopyDef, type ParkRun,
} from './sitePlan';
import { CAR_LENGTH, CAR_WIDTH } from '@/engine/motion/traffic';
import { PEDESTAL_OFFSET_PU } from '@/lib/ottoChargeArm/cobotSpec';
import { DCFC_CABINET_PU, L2_CABINET_PU, CABINET_BACKSET_PU } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { towardFor } from '@/lib/ottoChargeArm/depotPlacement';

/** Axis-aligned rectangle in plan units. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export function rectOf(r: { x: number; y: number; w: number; h: number }): Rect {
  return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
}

// ═══════════════════════════════════════════════════════════════ BUILDINGS ═══

/** Clear door opening width: 11u = 5.26 m (17.3 ft), a common fleet-bay door.
 *  10u (15.7 ft) was measured too tight: on the busy_day capture a car squaring up
 *  to wash bay 2 from the forecourt put its front corner 0.18u into the wall run
 *  beside the opening (structureClearance.replay.test.ts). */
export const DOOR_WIDTH = 11;
/** Service doors clear 4.12 m (13.5 ft) — room for a sensor pod and a lift. */
export const SERVICE_DOOR_HEIGHT = 8.6;
/** Wash doors clear 3.73 m (12.2 ft). */
export const WASH_DOOR_HEIGHT = 7.8;
/** Exterior wall thickness: 0.6u = 0.29 m insulated metal panel on girts. */
export const WALL_T = 0.6;
/** Interior partition thickness. */
export const PARTITION_T = 0.4;
/** Minimum daylight between a car body and a door jamb, per side (0.72 m). */
export const MIN_JAMB_CLEARANCE = 1.5;

export interface DoorDef {
  /** plan x of the opening's centreline (== the bay's drive line) */
  x: number;
  width: number;
  height: number;
  bayId: string;
  kind: 'service' | 'wash';
}

export interface ShellDef {
  id: 'ops' | 'wash';
  footprint: Rect;
  /** top of parapet, plan units */
  height: number;
  /** the roof deck sits this far below the parapet top */
  parapet: number;
  wallT: number;
  /** cut IDENTICALLY into the south (entry) and north (exit) walls */
  doors: DoorDef[];
  /** interior partition walls, full depth, at these plan x */
  partitions: number[];
  /** enclosed office block (ops only) — everything west of the first partition */
  office?: Rect;
  /** each bay's interior span between its bounding walls/partitions */
  bays: { id: string; kind: 'service' | 'wash'; x: number; x0: number; x1: number }[];
}

const BAY_PITCH = 18;

function bayShell(
  id: 'ops' | 'wash',
  r: { x: number; y: number; w: number; h: number },
  xs: readonly number[],
  kind: 'service' | 'wash',
  height: number,
  doorHeight: number,
  withOffice: boolean,
): ShellDef {
  const footprint = rectOf(r);
  const mids = xs.slice(1).map((x, i) => (x + xs[i]) / 2);
  const officeWall = withOffice ? xs[0] - BAY_PITCH / 2 : null;
  const partitions = officeWall != null ? [officeWall, ...mids] : mids;
  const prefix = kind === 'service' ? 'SVC' : 'WASH';
  const bays = xs.map((x, i) => {
    const left = i === 0 ? (officeWall ?? footprint.x0 + WALL_T) : mids[i - 1];
    const right = i === xs.length - 1 ? footprint.x1 - WALL_T : mids[i];
    return { id: `${prefix}-${String(i + 1).padStart(2, '0')}`, kind, x, x0: left, x1: right };
  });
  return {
    id,
    footprint,
    height,
    parapet: 0.9,
    wallT: WALL_T,
    doors: xs.map((x, i) => ({
      x, width: DOOR_WIDTH, height: doorHeight, bayId: bays[i].id, kind,
    })),
    partitions,
    office: officeWall != null
      ? { x0: footprint.x0, y0: footprint.y0, x1: officeWall, y1: footprint.y1 }
      : undefined,
    bays,
  };
}

/** Operations building: two-storey ops centre (west) + 2 pull-through service bays (east). */
export const OPS_SHELL: ShellDef = bayShell('ops', BUILDING, SERVICE_BAY_XS, 'service', 13, SERVICE_DOOR_HEIGHT, true);
/** Wash hall: 3 pull-through wash bays. */
export const WASH_SHELL: ShellDef = bayShell('wash', WASH, WASH_BAY_XS, 'wash', 10, WASH_DOOR_HEIGHT, false);
export const SHELLS: ShellDef[] = [OPS_SHELL, WASH_SHELL];

/** [x0, x1] of a door's clear opening along its wall. */
export function doorSpan(d: DoorDef): [number, number] {
  return [d.x - d.width / 2, d.x + d.width / 2];
}

/**
 * The SOLID runs of a south or north wall: the footprint's x-range with every
 * door opening removed. Full-height wall is drawn on these; a lintel spans each
 * opening above the door head.
 */
export function solidWallRuns(s: ShellDef): [number, number][] {
  const spans = s.doors.map(doorSpan).sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  let x = s.footprint.x0;
  for (const [a, b] of spans) {
    if (a > x) runs.push([x, a]);
    x = Math.max(x, b);
  }
  if (x < s.footprint.x1) runs.push([x, s.footprint.x1]);
  return runs;
}

/** Every rectangle a car body must never overlap, for one shell (plan units). */
export function shellSolids(s: ShellDef): { kind: string; r: Rect }[] {
  const f = s.footprint;
  const out: { kind: string; r: Rect }[] = [];
  for (const [a, b] of solidWallRuns(s)) {
    out.push({ kind: `${s.id}:south-wall`, r: { x0: a, x1: b, y0: f.y1 - s.wallT, y1: f.y1 } });
    out.push({ kind: `${s.id}:north-wall`, r: { x0: a, x1: b, y0: f.y0, y1: f.y0 + s.wallT } });
  }
  out.push({ kind: `${s.id}:west-wall`, r: { x0: f.x0, x1: f.x0 + s.wallT, y0: f.y0, y1: f.y1 } });
  out.push({ kind: `${s.id}:east-wall`, r: { x0: f.x1 - s.wallT, x1: f.x1, y0: f.y0, y1: f.y1 } });
  for (const px of s.partitions) {
    out.push({ kind: `${s.id}:partition`, r: { x0: px - PARTITION_T / 2, x1: px + PARTITION_T / 2, y0: f.y0, y1: f.y1 } });
  }
  if (s.office) out.push({ kind: `${s.id}:office`, r: s.office });
  return out;
}

// ─── bay equipment, placed off the drive line so the car passes between it ───

/** Two-post lift columns: either side of the car, level with where it parks. */
export const LIFT_POST_OFFSET = 5.6; // from the bay centreline (car half-width 2.1)
export const LIFT_POST_SIZE = 0.8;
/** Wash gantry side-brush centres and the frame legs that carry the top rail. */
export const WASH_BRUSH_OFFSET = 4.3;
export const WASH_BRUSH_RADIUS = 0.9;
export const WASH_GANTRY_LEG_OFFSET = 6.8;

export function bayEquipmentSolids(s: ShellDef): { kind: string; r: Rect }[] {
  const out: { kind: string; r: Rect }[] = [];
  for (const b of s.bays) {
    if (b.kind === 'service') {
      for (const side of [-1, 1]) {
        const x = b.x + side * LIFT_POST_OFFSET;
        out.push({
          kind: 'lift-post',
          r: { x0: x - LIFT_POST_SIZE / 2, x1: x + LIFT_POST_SIZE / 2, y0: BAY_STALL_Y - LIFT_POST_SIZE / 2, y1: BAY_STALL_Y + LIFT_POST_SIZE / 2 },
        });
      }
    } else {
      // brushes stand in the bay at rest, parked OUTBOARD of the car's path;
      // the gantry legs sit further out still.
      for (const side of [-1, 1]) {
        const bx = b.x + side * WASH_BRUSH_OFFSET;
        for (const y of [BAY_STALL_Y - 6, BAY_STALL_Y + 6]) {
          out.push({ kind: 'wash-brush', r: { x0: bx - WASH_BRUSH_RADIUS, x1: bx + WASH_BRUSH_RADIUS, y0: y - WASH_BRUSH_RADIUS, y1: y + WASH_BRUSH_RADIUS } });
        }
        const lx = b.x + side * WASH_GANTRY_LEG_OFFSET;
        out.push({ kind: 'wash-gantry-leg', r: { x0: lx - 0.4, x1: lx + 0.4, y0: BAY_STALL_Y - 0.4, y1: BAY_STALL_Y + 0.4 } });
      }
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════ CHARGING CANOPIES ═══

/** Spine column size (square HSS), plan units: 1.2u = 0.57 m. */
export const CANOPY_COLUMN = 1.2;
/** Longest bay between spine columns (along the spine). 17u = 8.1 m. */
export const CANOPY_MAX_SPAN = 17;
/** Keep-out between a column face and a charger cabinet (0.48 m). */
const CABINET_CLEAR = 1.0;

export interface CabinetFootprint { stallId: string; r: Rect; dc: boolean }

/** Charger cabinet footprints, exactly as ChargingField places them. */
export function cabinetFootprints(stalls = generateStallsV2()): CabinetFootprint[] {
  const out: CabinetFootprint[] = [];
  for (const s of stalls) {
    if (s.type !== 'dcfc' && s.type !== 'l2') continue;
    const dc = s.type === 'dcfc';
    const dims = dc ? DCFC_CABINET_PU : L2_CABINET_PU;
    const toward = towardFor(s.position.x);
    const px = s.position.x + toward * PEDESTAL_OFFSET_PU;
    const cx = px + toward * (dc ? CABINET_BACKSET_PU : 0);
    // pad = body + 0.4 / 0.3 margins (ChargingField: [D + 0.8, W + 0.6])
    const hx = (dims.depth + 0.8) / 2;
    const hy = (dims.width + 0.6) / 2;
    out.push({ stallId: s.id, dc, r: { x0: cx - hx, x1: cx + hx, y0: s.position.y - hy, y1: s.position.y + hy } });
  }
  return out;
}

/**
 * Spine column positions (plan y) for one canopy: the fewest columns that keep
 * every span <= CANOPY_MAX_SPAN, stand within 3u of each roof end, and clear
 * every cabinet on the spine by CABINET_CLEAR. Deterministic.
 */
export function canopyColumnYs(c: CanopyDef, cabinets = cabinetFootprints()): number[] {
  const half = CANOPY_COLUMN / 2;
  const onSpine = cabinets.filter((k) => k.r.x1 > c.cx - half - CABINET_CLEAR && k.r.x0 < c.cx + half + CABINET_CLEAR);
  const feasible = (y: number) => onSpine.every((k) => y + half + CABINET_CLEAR <= k.r.y0 || y - half - CABINET_CLEAR >= k.r.y1);
  const step = 0.25;
  // a column may stand as close as 1u to a roof end (its cap plate is 0.6u)
  const lo = c.y + 1.0, hi = c.y + c.h - 1.0;
  const cands: number[] = [];
  for (let y = lo; y <= hi + 1e-9; y += step) if (feasible(y)) cands.push(Math.round(y * 100) / 100);
  if (!cands.length) return [];
  // first column: the feasible y nearest the north roof end
  const cols = [cands[0]];
  for (;;) {
    const prev = cols[cols.length - 1];
    // the south end is within one span: finish on the feasible y nearest it
    const endCands = cands.filter((y) => y > prev + 2 && y <= prev + CANOPY_MAX_SPAN);
    if (!endCands.length) break;
    const last = endCands[endCands.length - 1];
    if (hi - last <= 4) { cols.push(last); break; }
    // otherwise step as far as one span allows
    cols.push(last);
  }
  return cols;
}

export function canopyColumnSolids(): { kind: string; r: Rect }[] {
  const cabs = cabinetFootprints();
  const half = CANOPY_COLUMN / 2;
  return CANOPIES.flatMap((c) =>
    canopyColumnYs(c, cabs).map((y) => ({
      kind: `canopy-${c.id}-column`,
      r: { x0: c.cx - half, x1: c.cx + half, y0: y - half, y1: y + half },
    })));
}

// ═══════════════════════════════════════════════════════ PERIMETER CARPORTS ═══

/** Carport column size (square HSS): 0.8u = 0.38 m. */
export const CARPORT_COLUMN = 0.8;

export interface CarportFrame {
  runId: string;
  /** column centres, plan */
  columns: { x: number; y: number }[];
  /** the axis the cantilever beams run along: 'x' for the W/E runs, 'y' for S runs */
  beamAxis: 'x' | 'y';
  /** plan coordinate of the column line, and of the cantilevered (aisle) roof edge */
  columnLine: number;
  tipLine: number;
  roof: Rect;
}

/** Stall centres of a run, in order. */
function runStalls(run: ParkRun): { x: number; y: number }[] {
  return Array.from({ length: run.n }, (_, i) => ({ x: run.x0 + i * run.dx, y: run.y0 + i * run.dy }));
}

/**
 * Cantilever carports: one row of columns along the stall HEADS (the fence
 * side), beams cantilevering over the cars toward the drive aisle. Where the
 * fence leaves no room behind the car heads (the E run), the columns stand in
 * the gaps BETWEEN stalls instead. Either way no column is inside a stall.
 */
export function carportFrames(): CarportFrame[] {
  const frames: CarportFrame[] = [];
  const halfL = CAR_LENGTH / 2;
  for (const run of PARK_RUNS) {
    if (!run.carport) continue;
    const roof = rectOf(run.carport);
    const stalls = runStalls(run);
    const alongY = run.dx === 0; // W/E columns stack along y; cars lie along x
    const cols: { x: number; y: number }[] = [];
    let columnLine: number, tipLine: number;
    if (alongY) {
      const headIsWest = run.x0 < 150;
      const carHead = headIsWest ? run.x0 - halfL : run.x0 + halfL;
      const behind = headIsWest ? carHead - roof.x0 : roof.x1 - carHead; // room behind the heads
      if (behind >= CARPORT_COLUMN + 0.8) {
        columnLine = headIsWest ? carHead - 0.5 - CARPORT_COLUMN / 2 : carHead + 0.5 + CARPORT_COLUMN / 2;
        for (let y = roof.y0 + 3; y <= roof.y1 - 3 + 1e-9; y += 17) cols.push({ x: columnLine, y });
      } else {
        // E run: in the stall gaps, near the heads, every third gap
        columnLine = headIsWest ? carHead + 1.2 : carHead - 1.2;
        for (let i = 1; i < stalls.length; i += 3) cols.push({ x: columnLine, y: (stalls[i - 1].y + stalls[i].y) / 2 });
      }
      tipLine = headIsWest ? roof.x1 : roof.x0;
      frames.push({ runId: run.id, columns: cols, beamAxis: 'x', columnLine, tipLine, roof });
    } else {
      // S runs: cars lie along y, heads to the SOUTH (the fence)
      const carHead = run.y0 + halfL;
      columnLine = carHead + 0.5 + CARPORT_COLUMN / 2;
      for (let x = roof.x0 + 3; x <= roof.x1 - 3 + 1e-9; x += 17) cols.push({ x, y: columnLine });
      tipLine = roof.y0;
      frames.push({ runId: run.id, columns: cols, beamAxis: 'y', columnLine, tipLine, roof });
    }
  }
  return frames;
}

export function carportColumnSolids(): { kind: string; r: Rect }[] {
  const h = CARPORT_COLUMN / 2;
  return carportFrames().flatMap((f) => f.columns.map((c) => ({
    kind: `carport-${f.runId}-column`, r: { x0: c.x - h, x1: c.x + h, y0: c.y - h, y1: c.y + h },
  })));
}

/** Every built solid a car must never overlap. */
export function allStructureSolids(): { kind: string; r: Rect }[] {
  return [
    ...SHELLS.flatMap(shellSolids),
    ...SHELLS.flatMap(bayEquipmentSolids),
    ...canopyColumnSolids(),
    ...carportColumnSolids(),
  ];
}

// ═════════════════════════════════════════════════════════════ BODY TESTS ═══

/** Car footprint parked at a stall: 10.2u along its heading, 4.2u across. */
export function parkedFootprint(p: { x: number; y: number; angle: number }): Rect {
  const alongX = p.angle === 90 || p.angle === 270;
  const hx = (alongX ? CAR_LENGTH : CAR_WIDTH) / 2;
  const hy = (alongX ? CAR_WIDTH : CAR_LENGTH) / 2;
  return { x0: p.x - hx, x1: p.x + hx, y0: p.y - hy, y1: p.y + hy };
}

export function rectsOverlap(a: Rect, b: Rect, eps = 1e-6): boolean {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

/**
 * Does an ORIENTED car body (centre, heading θ in the plan frame, 10.2 x 4.2)
 * overlap an axis-aligned rectangle? Separating-axis test on the 4 candidate
 * axes. `shrink` trims the body per side (a tolerance for sampling noise).
 */
export function bodyHitsRect(pose: { x: number; y: number; heading: number }, r: Rect, shrink = 0): boolean {
  const hl = CAR_LENGTH / 2 - shrink, hw = CAR_WIDTH / 2 - shrink;
  const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  const corners = [
    [hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw],
  ].map(([a, b]) => ({ x: pose.x + a * c - b * s, y: pose.y + a * s + b * c }));
  // axis-aligned axes
  const minX = Math.min(...corners.map((p) => p.x)), maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y)), maxY = Math.max(...corners.map((p) => p.y));
  if (maxX <= r.x0 || minX >= r.x1 || maxY <= r.y0 || minY >= r.y1) return false;
  // body axes
  const rc = [
    { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
  ];
  for (const [ax, ay, ext] of [[c, s, hl], [-s, c, hw]] as const) {
    const p0 = pose.x * ax + pose.y * ay;
    const proj = rc.map((p) => p.x * ax + p.y * ay - p0);
    if (Math.max(...proj) <= -ext || Math.min(...proj) >= ext) return false;
  }
  return true;
}
