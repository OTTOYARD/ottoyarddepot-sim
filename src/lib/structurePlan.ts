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
import { chargerPad } from '@/lib/ottoChargeArm/depotPlacement';

/** Axis-aligned rectangle in plan units. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export function rectOf(r: { x: number; y: number; w: number; h: number }): Rect {
  return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
}

/**
 * An ORIENTED rectangle in plan units: centre (cx, cy), half-length `hl` along plan
 * heading `th` (atan2(dy, dx), y south), half-width `hw` across it. An axis-aligned
 * Rect is the case th = 0 (boxOf).
 *
 * Why it exists: since 2026-09-28 every charger stall is ANGLED 60° to its lane, so
 * its car, its cabinet and its L2 post all lie at 60° too. An axis-aligned box round
 * a 60° car is 10.5 x 8.4u instead of 9.8 x 4.0 — it would put a phantom solid over
 * the lane beside the car and over the neighbouring stall, and every clearance test
 * that uses it would fail on nothing. Solids are measured as the shapes they are.
 */
export interface OBox { cx: number; cy: number; hl: number; hw: number; th: number }

export function boxOf(r: Rect): OBox {
  return { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, hl: (r.x1 - r.x0) / 2, hw: (r.y1 - r.y0) / 2, th: 0 };
}

/** The four corners of an oriented box, in order round it. */
export function boxCorners(b: OBox): { x: number; y: number }[] {
  const c = Math.cos(b.th), s = Math.sin(b.th);
  return [[b.hl, b.hw], [b.hl, -b.hw], [-b.hl, -b.hw], [-b.hl, b.hw]]
    .map(([a, w]) => ({ x: b.cx + a * c - w * s, y: b.cy + a * s + w * c }));
}

/** The axis-aligned bounding rectangle of an oriented box. */
export function boxAabb(b: OBox): Rect {
  const ex = Math.abs(b.hl * Math.cos(b.th)) + Math.abs(b.hw * Math.sin(b.th));
  const ey = Math.abs(b.hl * Math.sin(b.th)) + Math.abs(b.hw * Math.cos(b.th));
  return { x0: b.cx - ex, x1: b.cx + ex, y0: b.cy - ey, y1: b.cy + ey };
}

/** Grow (or, negative, shrink) an oriented box by `d` on every side. */
export function inflateBox(b: OBox, d: number): OBox {
  return { ...b, hl: b.hl + d, hw: b.hw + d };
}

/**
 * The separation between two oriented boxes along their four candidate axes (the
 * separating-axis theorem for rectangles): > 0 is the clear gap on the best axis,
 * <= 0 means they overlap by at least that much on every axis.
 */
export function boxGap(a: OBox, b: OBox): number {
  let best = -Infinity;
  for (const th of [a.th, a.th + Math.PI / 2, b.th, b.th + Math.PI / 2]) {
    const ax = Math.cos(th), ay = Math.sin(th);
    const ra = Math.abs(a.hl * Math.cos(a.th - th)) + Math.abs(a.hw * Math.sin(a.th - th));
    const rb = Math.abs(b.hl * Math.cos(b.th - th)) + Math.abs(b.hw * Math.sin(b.th - th));
    const d = Math.abs((b.cx - a.cx) * ax + (b.cy - a.cy) * ay);
    best = Math.max(best, d - ra - rb);
  }
  return best;
}

/** Do two oriented boxes overlap by more than `eps` (touching is not overlapping)? */
export function boxesOverlap(a: OBox, b: OBox, eps = 1e-6): boolean {
  return boxGap(a, b) < -eps;
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
/** Wash gantries: two frames per bay, 6u fore and aft of the parked car. */
export const WASH_FRAME_DY = 6;
/** Side-brush centres (brushes at rest, retracted outboard of the car's path). */
export const WASH_BRUSH_OFFSET = 4.3;
export const WASH_BRUSH_RADIUS = 0.9;
/** Gantry frame legs, further out still. */
export const WASH_GANTRY_LEG_OFFSET = 6.8;
export const WASH_GANTRY_LEG = 0.8;
/** Pre-soak spray arch just inside the entry door. */
export const WASH_ARCH_INSET = 3.5;      // from the south wall's inner face
export const WASH_ARCH_OFFSET = 5.9;     // arch uprights from the drive line
/** Service-bay casework against the bay's west partition: tool chest (south), tyre rack (north). */
export const SERVICE_CASEWORK_DEPTH = 1.6;

export function bayEquipmentSolids(s: ShellDef): { kind: string; r: Rect }[] {
  const out: { kind: string; r: Rect }[] = [];
  const sq = (kind: string, x: number, y: number, size: number) =>
    out.push({ kind, r: { x0: x - size / 2, x1: x + size / 2, y0: y - size / 2, y1: y + size / 2 } });
  const f = s.footprint;
  for (const b of s.bays) {
    if (b.kind === 'service') {
      for (const side of [-1, 1]) sq('lift-post', b.x + side * LIFT_POST_OFFSET, BAY_STALL_Y, LIFT_POST_SIZE);
      const cx0 = b.x0 + PARTITION_T / 2 + 0.2, cx1 = cx0 + SERVICE_CASEWORK_DEPTH;
      out.push({ kind: 'tool-chest', r: { x0: cx0, x1: cx1, y0: f.y1 - s.wallT - 6.5, y1: f.y1 - s.wallT - 3.0 } });
      out.push({ kind: 'tyre-rack', r: { x0: cx0, x1: cx1, y0: f.y0 + s.wallT + 2.5, y1: f.y0 + s.wallT + 8.5 } });
    } else {
      for (const dy of [-WASH_FRAME_DY, WASH_FRAME_DY]) {
        const y = BAY_STALL_Y + dy;
        for (const side of [-1, 1]) {
          sq('wash-brush', b.x + side * WASH_BRUSH_OFFSET, y, WASH_BRUSH_RADIUS * 2);
          sq('wash-gantry-leg', b.x + side * WASH_GANTRY_LEG_OFFSET, y, WASH_GANTRY_LEG);
        }
      }
      const ay = f.y1 - s.wallT - WASH_ARCH_INSET;
      for (const side of [-1, 1]) sq('wash-arch', b.x + side * WASH_ARCH_OFFSET, ay, 0.4);
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
/** How far a spine column must stand from any parked car's body. The spine is
 *  where two columns of angled noses meet (1.53u either side of it at the closest),
 *  so this is a daylight gap, not a walkway: enough that no column stands touching
 *  a bumper. */
const HEAD_CLEAR = 0.3;

export interface CabinetFootprint {
  stallId: string;
  /** the cabinet and its pad, as the oriented box it is */
  box: OBox;
  /** its axis-aligned bounds, for coarse filtering only */
  r: Rect;
  dc: boolean;
}

/**
 * Charger footprints (body plus pad), exactly as ChargingField pours them
 * (depotPlacement.chargerPad): the body plus 0.4u on the side facing the car and
 * 0.3u along it, its wide face along the car, turned with the car.
 *   - DCFC: on the car's charge-port flank, CABINET_BACKSET_PU behind the
 *     OTTO-CHARGE ARM's base, abeam the car's centre — and since 2026-09-30 the
 *     arm's riser and the bridge into the cabinet stand on the same pad, so the
 *     solid runs from behind the cabinet to just past the arm (one unit);
 *   - L2: beside the car's front quarter on the same flank.
 */
export function cabinetFootprints(stalls = generateStallsV2()): CabinetFootprint[] {
  const out: CabinetFootprint[] = [];
  for (const s of stalls) {
    if (s.type !== 'dcfc' && s.type !== 'l2') continue;
    const dc = s.type === 'dcfc';
    const p = chargerPad(s.type, s.position.x, s.position.y, s.position.angle);
    const box: OBox = { cx: p.cx, cy: p.cy, hl: p.hl, hw: p.hw, th: p.th };
    out.push({ stallId: s.id, dc, box, r: boxAabb(box) });
  }
  return out;
}

/**
 * Spine column positions (plan y) for one canopy: the fewest columns that keep
 * every span <= CANOPY_MAX_SPAN, stand within 3u of each roof end, clear every
 * charger cabinet by CABINET_CLEAR, and clear every parked car's body by
 * HEAD_CLEAR (parkedBox — the car as it lies, at its angle). Deterministic.
 */
export function canopyColumnYs(c: CanopyDef, cabinets = cabinetFootprints(), stalls = generateStallsV2()): number[] {
  const half = CANOPY_COLUMN / 2;
  const reach = half + CABINET_CLEAR + 8;
  const nearCabs = cabinets.filter((k) => Math.abs(k.box.cx - c.cx) < reach);
  const nearCars = stalls
    .filter((s) => Math.abs(s.position.x - c.cx) <= c.w / 2 + 2)
    .map((s) => parkedBox(s.position));
  const feasible = (y: number) => {
    const col: OBox = { cx: c.cx, cy: y, hl: half, hw: half, th: 0 };
    return nearCabs.every((k) => boxGap(col, k.box) >= CABINET_CLEAR)
      && nearCars.every((b) => boxGap(col, b) >= HEAD_CLEAR);
  };
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

/** Bollards guarding each bay door's outer corners, front (forecourt) and rear (apron). */
export const BOLLARD_RADIUS = 0.42;
export function bayBollards(): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const s of SHELLS) {
    for (const d of s.doors) {
      const off = d.width / 2 + 1.5;
      for (const side of [-1, 1]) {
        pts.push({ x: d.x + side * off, y: s.footprint.y1 + 1.5 });
        pts.push({ x: d.x + side * off, y: s.footprint.y0 - 1.5 });
      }
    }
  }
  return pts;
}

/** A built solid: its exact oriented shape, and its axis-aligned bounds. */
export interface Solid { kind: string; r: Rect; box: OBox }

const solid = (kind: string, r: Rect): Solid => ({ kind, r, box: boxOf(r) });

/** Every built solid a car must never overlap. */
export function allStructureSolids(): Solid[] {
  return [
    ...SHELLS.flatMap(shellSolids).map((k) => solid(k.kind, k.r)),
    ...SHELLS.flatMap(bayEquipmentSolids).map((k) => solid(k.kind, k.r)),
    ...canopyColumnSolids().map((k) => solid(k.kind, k.r)),
    ...carportColumnSolids().map((k) => solid(k.kind, k.r)),
    ...bayBollards().map((p) => solid('bay-bollard', {
      x0: p.x - BOLLARD_RADIUS, x1: p.x + BOLLARD_RADIUS, y0: p.y - BOLLARD_RADIUS, y1: p.y + BOLLARD_RADIUS,
    })),
    // Charger cabinets on their pads: the one piece of street furniture a car
    // pulls right up beside. In the set so the clearance replay drives every
    // recorded car against them, and so a widened corner has to clear them. They
    // stand at their stall's 60°, so they are the one solid that is not square.
    ...cabinetFootprints().map((k) => ({ kind: k.dc ? 'dcfc-cabinet' : 'l2-cabinet', r: k.r, box: k.box })),
  ];
}

// ═════════════════════════════════════════════════════════════ BODY TESTS ═══

/**
 * The body of a car parked at a stall, as it lies: CAR_LENGTH (9.8u) along the
 * stall's axis, CAR_WIDTH (4.0u) across. The stall's angle is a compass bearing (0 = N, 90 = E); a box is the
 * same shape end for end, so an axis is all that matters here — a staging stall's
 * 90/270 lies east-west, a charger's 60/300 lies at 60° to its lane.
 */
export function parkedBox(p: { x: number; y: number; angle: number }): OBox {
  return { cx: p.x, cy: p.y, hl: CAR_LENGTH / 2, hw: CAR_WIDTH / 2, th: ((p.angle - 90) * Math.PI) / 180 };
}

export function rectsOverlap(a: Rect, b: Rect, eps = 1e-6): boolean {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

/**
 * Does an ORIENTED car body (centre, heading θ in the plan frame, 9.8 x 4.0)
 * overlap an oriented box? Separating-axis test on the 4 candidate axes.
 * `shrink` trims the body per side (a tolerance for sampling noise); a negative
 * shrink grows it (a clearance margin). Touching is not overlapping.
 */
export function bodyHitsBox(pose: { x: number; y: number; heading: number }, b: OBox, shrink = 0): boolean {
  const body: OBox = { cx: pose.x, cy: pose.y, hl: CAR_LENGTH / 2 - shrink, hw: CAR_WIDTH / 2 - shrink, th: pose.heading };
  return boxGap(body, b) < 0;
}

/** bodyHitsBox for an axis-aligned rectangle. */
export function bodyHitsRect(pose: { x: number; y: number; heading: number }, r: Rect, shrink = 0): boolean {
  return bodyHitsBox(pose, boxOf(r), shrink);
}
