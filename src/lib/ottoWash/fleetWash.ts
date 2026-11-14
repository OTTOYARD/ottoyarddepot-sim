/**
 * THE DETAIL ARMS' PROGRAM FOR ONE FLEET VEHICLE, MADE BY RULE.
 *
 * Chase, 2026-11-13: "train all robotics individually for each vehicle type ... That includes sensor cleaning at the
 * detail line ... Our system knows which car is pulling into which stall so that should activate different training
 * sets for our robotics ... Make sure all clearance and individual robotics match per vehicle."
 *
 * The generic car's program (detailArm.GENERIC) is 12 places a side, written by hand for one shape. A fleet vehicle's
 * is made here from its sensor map (fleetModels/sensorMap.ts) and its solid (fleetModels/washSolid.ts):
 *
 *   1. PLACES. Each face of the map is a place. Faces that one pad covers together (PLACE_MERGE) are one place.
 *   2. THE ORDER. Front, sides, roof, rear, as on the generic car. In a zone: the nose from the centre out, the
 *      sides and the roof from front to rear, the tail from the corner in.
 *   3. HOW THE PAD MEETS EACH PLACE. The pad looks straight into the face if the arm can come that way. If not, it
 *      tilts: toward the way the surface round the sensor looks, up, and toward its own side of the bay, by the least
 *      that works (TILTS). A tilt is allowed only while the face stays inside what the pad's foam gives (PAD_GIVE_M).
 *   4. WHERE THE CARRIAGE STANDS. Each stop along the track is tried (RAIL_OFFSETS). A stop is good when the arm
 *      reaches the place, its hover and its safe point inside its limits, with every part off the vehicle, and the
 *      way there from the place before is clear. If only that way is not clear, the arm tucks, rides and comes in
 *      from the tuck (`viaCarry`).
 *   5. A PLACE THE MACHINE CANNOT DO IS LEFT OUT, with the reason and the measured shortfall (`skipped`). Nothing
 *      is fudged to keep it.
 *   6. THE TWO ARMS. Where both would be at places too near each other in the same turn, the west arm goes round the
 *      zone the other way. If they are still too near, the arms take the zone one after the other (`lead`).
 *   7. THE TIME. Each turn is as long as its move needs, with a touch, a polish and a lift (TURN_S). The four zones
 *      together are never shorter than the generic program's 120 s. A vehicle with more places takes longer, and the
 *      gantry's passes give up that time, so the twin's seat is the same length for every vehicle (washSession).
 *
 * Pure. The result is cached for each model.
 */
import { MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import type { VehicleSpec } from '@/lib/fleetModels/spec';
import { PAD_RADIUS_M, sensorMap, type SensorFace } from '@/lib/fleetModels/sensorMap';
import { fleetWashSolid, type WashSolid } from '@/lib/fleetModels/washSolid';
import {
  DETAIL_FOLD, DETAIL_SPEC, DOCK_DY_M, SIDES, TRACK_TO_M, TRACK_X_M, aim, along, carryWay, hoverWay, onWays, route,
  safePoint, taken, toCarry, waitWay, zoneEnd, zoneSensors, zoneStart, zoneTurns, type ArmState, type B3, type DetailProgram, type End,
  type Sensor, type Side, type TurnParts, type Way,
} from './detailArm';
import { DETAIL_ARM, WASH_GANTRY, WASH_HOME_DY, WASH_PHASE_S, WIPE_STATIONS, type WipeStation } from './washSpec';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';

// ── the margins: the generic program's own tests hold these, and a fleet program is planned to them ──

/** Every link of an arm keeps this off the vehicle (detailArm.test.ts, washPose.test.ts). */
export const LINK_GAP_M = 0.10;
/** The pad's foam gives this much: no point of its face goes deeper into the vehicle (cadYard.test.ts). */
export const PAD_GIVE_M = 0.015;
/** The head behind the pad, and the camera beside it, stay this far off the vehicle (cadYard.test.ts). */
export const HEAD_GAP_M = 0.045;
/** The arm's own housings, as the CAD draws them, stay this far off the vehicle (cadYard.test.ts). */
export const HOUSING_GAP_M = 0.08;
/** The pad is 62 mm of foam. The plate behind it is 52 mm in radius, and the force sensor behind that 55 mm. */
export const PAD_THICK_M = 0.062;
export const PLATE_RADIUS_M = 0.052;
export const HEAD_RADIUS_M = 0.055;
/** The two pads keep this apart, and the two wrists this (detailArm.test.ts). */
export const PADS_APART_M = 0.28;
export const WRISTS_APART_M = 0.45;
/** The gantry's north face, stowed, stays this far south of every part of an arm (washPose.test.ts). */
export const GANTRY_ROOM_M = 0.5;
/** The wrist's bend stays under this (detailArm.test.ts: the CAD measured it clear at 1.66 rad). */
export const WRIST_BEND_MAX = 1.66;
/** The forearm's roll stays under this near the vehicle (detailArm.test.ts). */
export const ROLL_MAX = 2.7;

// ── the rule's own numbers ──

/** The rule plans with this much more than each margin, so a finer check does not find it on the wrong side. */
const PLAN_SLACK_M = 0.008;
/** One pad covers two faces when the second is inside the pad's disc, on its plane, and looks the same way. */
export const PLACE_MERGE = { radiusM: PAD_RADIUS_M, planeM: 0.005, cos: Math.cos((20 * Math.PI) / 180), faceM: 0.02 } as const;
/** The tilts tried, degrees: [toward straight up, toward the arm's own side of the bay]. The least is taken first. */
export const TILTS: readonly (readonly [number, number])[] = [
  [0, 0], [7, 0], [10, 0], [14, 0], [0, 7], [0, 14], [10, 10], [20, 0], [14, 15], [0, 30], [20, 20], [30, 0], [20, 30], [0, 45], [40, 0],
  [30, 30], [20, 45], [45, 0], [50, 0], [40, 30], [40, 45],
];
/** The most a pad's face may be turned from a sensor's face, whatever the sensor's size. */
export const TILT_MAX_DEG = 50;
/** Where the carriage is tried, metres north of the wrist (negative: south of it). */
export const RAIL_OFFSETS: readonly number[] = [1.65, 1.45, 1.2, 0.9, 0.6, 0.3, 0, -0.3, -0.65, -1.0, -1.3, -1.65, 2.0, -2.0];
/** The wrist stays this far from straight, where its two ways meet, radians. */
const WRIST_BEND_MIN = 0.12;
/**
 * A turn's fixed parts, s: the touch (0.15 m in from the hover), the polish (a quarter turn each way) and the lift.
 * The generic program's shortest turn gives them 0.53 s, 2.8 s and 0.53 s (washSpec.WIPE_PARTS of 7 s).
 */
export const TURN_S = { touch: 0.55, polish: 2.8, lift: 0.55 } as const;
/** No move is given less than this, s. */
export const MOVE_MIN_S = 1.2;
/** The carriage's speed a move is planned to, m/s: under its drive's 1.5 (washSpec.DETAIL_ARM.railMps). */
export const RAIL_PLAN_MPS = 1.3;
/**
 * A joint's top speed, rad/s: a 1.75 m collaborative arm's (base and shoulder 120 deg/s, elbow 150, wrists 210;
 * detailArm.test.ts has the source). A move is planned to SPEED_PLAN of it.
 */
export const JOINT_SPEED = { j1: (120 * Math.PI) / 180, j2: (120 * Math.PI) / 180, j3: (150 * Math.PI) / 180, j4: (210 * Math.PI) / 180, j5: (210 * Math.PI) / 180 } as const;
export const SPEED_PLAN = 0.8;
const MOVE_STEPS = 600;
/** The least time any move is spread over, s, and how many steps each side a part of a path shares its pace with. */
const PACE_FLOOR_S = 0.8;
const PACE_BLUR = 4;
/** How much a carriage stop is marked down for each metre it is from the stop before: an arm does not ride the track between two places it can do from one stop. */
const RAIL_STAY = 0.2;
/** The elbow stays this far from straight on every path, radians: near straight, a small move of the pad is a fast move of the joints. */
const ELBOW_MIN = 0.2;
/** How much a stop is marked down for turning the wrist over from the way the place before used: a turn-over is a trip to above the track and back. */
const FLIP_STAY = 0.15;
/** On a path the wrist stays this far from straight, radians: near straight, the forearm must roll fast to turn the pad a little. */
const PATH_BEND_MIN = 0.2;
/** The ride to the dock and the fold into it, s: the generic program's (8.4 s and 3.6 s of its 15 s). */
export const STOW_RIDE_S = 8.4;
export const STOW_FOLD_S = 3.6;


/** How far over the vehicle's highest part the pad crosses it, metres. */
export const OVER_TOP_M = 0.25;
/** A zone with no place for either arm is given this long. */
export const ZONE_IDLE_S = 1;

const TOOL_BACK_M = DETAIL_SPEC.wrist + DETAIL_SPEC.tool;
const D2R = Math.PI / 180;

const add = (a: B3, b: B3, k = 1): B3 => ({ x: a.x + b.x * k, dy: a.dy + b.dy * k, y: a.y + b.y * k });
const dot = (a: B3, b: B3) => a.x * b.x + a.dy * b.dy + a.y * b.y;
const unit = (a: B3): B3 => { const n = Math.hypot(a.x, a.dy, a.y) || 1; return { x: a.x / n, dy: a.dy / n, y: a.y / n }; };
const dist = (a: B3, b: B3) => Math.hypot(a.x - b.x, a.dy - b.dy, a.y - b.y);
const cross = (a: B3, b: B3): B3 => ({ x: a.dy * b.y - a.y * b.dy, dy: a.y * b.x - a.x * b.y, y: a.x * b.dy - a.dy * b.x });

/** A place the machine does not do, and why. */
export interface Skipped {
  /** the spec's sensors at this place */
  sensors: string[];
  face: string;
  label: string;
  side: Side;
  /** what stopped it */
  why: 'pad' | 'head' | 'reach' | 'wrist' | 'roll' | 'fold' | 'links' | 'gantry' | 'path';
  /** the best any tilt and any carriage stop did against that limit, and the limit */
  best: number;
  limit: number;
  text: string;
}

export interface FleetDetail extends DetailProgram {
  solid: WashSolid;
  skipped: Skipped[];
  /** the four zones' lengths, sim seconds */
  zoneS: Record<WipeStation, number>;
  /** for each of the spec's sensors that is cleaned: the place that cleans it, by arm */
  cleaned: Map<string, { side: Side; place: string }[]>;
  /** the time the four zones need at the rule's own pace, s. They are never played in less than the generic program's 120 s. */
  needS: number;
  /** `arms_stow`'s length for this vehicle, and `retract`'s (a seat that ends early), sim seconds */
  stowS: number;
  retractS: number;
  /** what the rule planned to: the least room over the margins, the deepest the pad's face goes, the least the head keeps, the most a pad is tilted off a face */
  planned: { room: number; pad: number; head: number; tiltDeg: number };
}

// ── an arm against a vehicle ─────────────────────────────────────────────────

const shoulderOf = (a: ArmState): B3 => ({ x: a.side * TRACK_X_M, dy: a.rail, y: MOUNT_HEIGHT_M + DETAIL_SPEC.shoulderHeight });
function lineGap(gap: (p: B3) => number, a: B3, b: B3, r: number, n: number): number {
  let m = Infinity;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    m = Math.min(m, gap({ x: a.x + (b.x - a.x) * f, dy: a.dy + (b.dy - a.dy) * f, y: a.y + (b.y - a.y) * f }) - r);
  }
  return m;
}
/** The least an arm's links are off a vehicle: the upper arm, the forearm and the wrist's housing (the tests' measure). */
export function armLinkGap(a: ArmState, gap: (p: B3) => number, n = 12): number {
  return Math.min(
    lineGap(gap, shoulderOf(a), a.elbow, DETAIL_SPEC.radii.upper, n), lineGap(gap, a.elbow, a.wrist, DETAIL_SPEC.radii.fore, n),
    gap(a.wrist) - DETAIL_SPEC.radii.wristR);
}

/**
 * THE WRIST AS THE CAD DRAWS IT (cad/otto_cad/robots/wash_gantry.py, measured from public/cad/wash_gantry.depot.glb
 * in fleetWash.test.ts). The links above are lines with a radius. The real wrist has more on it, and a place between
 * two housings of a vehicle is where it shows:
 *   - the J5 actuator stands 0.165 m out of the wrist's centre along the wrist's own axis, to one side;
 *   - the wrist tube and the J6 actuator run 0.25 m along the tool, 0.07 m and 0.06 m in radius, with square ends;
 *   - the sensor bracket and the camera stand on the other side of the tool from the J5 actuator, the camera's face
 *     76 mm behind the pad's and its far corner 0.134 m off the tool's line.
 * In the wrist's frame: `t` along the tool from the wrist's centre, `s` along the wrist's axis, `w` across both. Metres.
 */
export const WRIST_CAD = {
  /** the yoke and the forearm's last actuator: inside this of the wrist's centre */
  ball: 0.125,
  /** the J5 actuator: a cylinder along the wrist's axis; measured at rings round it */
  j5: { s: [-0.03, -0.1, -0.165], r: 0.07 },
  /** the wrist tube, and the J6 actuator past it: cylinders along the tool */
  tube: { t: [-0.056, 0.03, 0.114], r: 0.069 },
  j6: { t: [0.114, 0.18, 0.246], r: 0.059 },
  bracket: { t: [0.056, 0.19, 0.329], s: 0.089, w: 0.055 },
  camera: { t: [0.259, 0.333], s: [0.089, 0.133], w: 0.022 },
} as const;

/** Eight points round a ring: cosine and sine. */
const RIM: readonly (readonly [number, number])[] = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)] as const);
/** The wrist's own axis (J5's), in the bay frame. */
function wristAxis(a: ArmState): B3 {
  const q23 = a.q.j2 + a.q.j3;
  const c4 = Math.cos(a.q.j4), s4 = Math.sin(a.q.j4), c1 = Math.cos(a.q.j1), s1 = Math.sin(a.q.j1);
  const v = { x: c4, y: Math.sin(q23) * s4, z: -Math.cos(q23) * s4 };
  const arm = { x: c1 * v.x + s1 * v.z, y: v.y, z: -s1 * v.x + c1 * v.z };
  return { x: -a.side * arm.z, dy: a.side * arm.x, y: arm.y };
}
/** How far an arm's parts are off a vehicle, each less the margin it must keep: under zero is too near. */
export interface ArmRoom { links: number; housings: number; head: number }
export function armRoom(a: ArmState, gap: (p: B3) => number, n = 8): ArmRoom {
  const links = armLinkGap(a, gap, n);
  const t = a.axis, s = wristAxis(a), w = cross(t, s);
  const at = (tt: number, ss: number, ww: number): B3 => ({
    x: a.wrist.x + t.x * tt + s.x * ss + w.x * ww, dy: a.wrist.dy + t.dy * tt + s.dy * ss + w.dy * ww, y: a.wrist.y + t.y * tt + s.y * ss + w.y * ww,
  });
  let housings = gap(a.wrist) - WRIST_CAD.ball;
  // nothing of the wrist is farther than 0.36 m from its centre: well clear, the rest is not measured
  if (housings > 0.36) return { links, housings, head: housings };
  // each cylinder at rings round it: its end's rim is what comes nearest when the tool leans on a surface
  for (const [c, sn] of RIM) {
    for (const ss of WRIST_CAD.j5.s) housings = Math.min(housings, gap(at(WRIST_CAD.j5.r * c, ss, WRIST_CAD.j5.r * sn)));
    for (const tt of WRIST_CAD.tube.t) housings = Math.min(housings, gap(at(tt, WRIST_CAD.tube.r * c, WRIST_CAD.tube.r * sn)));
    for (const tt of WRIST_CAD.j6.t) housings = Math.min(housings, gap(at(tt, WRIST_CAD.j6.r * c, WRIST_CAD.j6.r * sn)));
  }
  let head = Infinity;
  for (const tt of WRIST_CAD.bracket.t) for (const ww of [-1, 1]) head = Math.min(head, gap(at(tt, WRIST_CAD.bracket.s, ww * WRIST_CAD.bracket.w)));
  for (const tt of WRIST_CAD.camera.t) for (const ss of WRIST_CAD.camera.s) for (const ww of [-1, 1]) head = Math.min(head, gap(at(tt, ss, ww * WRIST_CAD.camera.w)));
  return { links, housings, head };
}
/** The least of an arm's parts' room over their margins: zero or more is clear. */
export const roomOver = (r: ArmRoom): number => Math.min(r.links - LINK_GAP_M, r.housings - HOUSING_GAP_M, r.head - HEAD_GAP_M);

/** The farthest south any part of an arm is. */
export const armSouth = (a: ArmState) => Math.max(a.rail, a.elbow.dy, a.wrist.dy, a.pad.dy);
/** The stowed gantry's north face, metres south of the car's centre. */
export const GANTRY_NORTH_M = (WASH_HOME_DY + WASH_GANTRY.beam.dy0) * METRES_PER_PLAN_UNIT;

/** Points round a disc of radius `r` whose centre is `c` and whose face looks along `n`. */
function ring(c: B3, n: B3, r: number, count = 12): B3[] {
  const ref: B3 = Math.abs(n.y) < 0.9 ? { x: 0, dy: 0, y: 1 } : { x: 1, dy: 0, y: 0 };
  const u = unit(cross(n, ref)), v = cross(n, u);
  const out: B3[] = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * 2 * Math.PI;
    out.push(add(add(c, u, r * Math.cos(a)), v, r * Math.sin(a)));
  }
  return out;
}
/** The pad on a place: how deep the deepest point of its face is in the vehicle (negative), and the least the head behind it is off it. */
export function padOnPlace(p: B3, axis: B3, gap: (p: B3) => number): { pad: number; head: number } {
  const n: B3 = { x: -axis.x, dy: -axis.dy, y: -axis.y };
  let pad = gap(p);
  for (const q of ring(p, n, PAD_RADIUS_M)) pad = Math.min(pad, gap(q));
  for (const q of ring(p, n, PAD_RADIUS_M * 0.5, 6)) pad = Math.min(pad, gap(q));
  // the backing plate, 62 mm behind the face, and the force sensor's rim, 100 mm behind it
  let head = gap(add(p, n, PAD_THICK_M));
  for (const q of ring(add(p, n, PAD_THICK_M), n, PLATE_RADIUS_M)) head = Math.min(head, gap(q));
  for (const q of ring(add(p, n, 0.1), n, HEAD_RADIUS_M)) head = Math.min(head, gap(q));
  return { pad, head };
}

// ── one place ────────────────────────────────────────────────────────────────

/** `v` turned toward `to` by `deg` degrees, or all the way if it is nearer than that. */
function toward(v: B3, to: B3, deg: number): B3 {
  const c = Math.max(-1, Math.min(1, dot(v, to)));
  const ang = Math.acos(c);
  if (deg <= 0 || ang < 1e-6) return v;
  const f = Math.min(1, (deg * D2R) / ang);
  // the part of `to` square to `v`
  const sq = unit(add(to, v, -c));
  const th = ang * f;
  return unit(add({ x: v.x * Math.cos(th), dy: v.dy * Math.cos(th), y: v.y * Math.cos(th) }, sq, Math.sin(th)));
}
const angleDeg = (a: B3, b: B3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / D2R;

interface Group { faces: SensorFace[]; side: Side }
type Fail = { why: Skipped['why']; best: number; limit: number };
/** How far along the rule a try got: a later stage is nearer to working. */
const STAGE: Record<Skipped['why'], number> = { pad: 0, head: 1, reach: 2, wrist: 3, roll: 4, fold: 5, links: 6, gantry: 7, path: 8 };

interface Frame { over: DetailProgram['over']; overM: number; gap: (p: B3) => number; solid: WashSolid }
interface Solved { sensor: Sensor; room: number; pad: number; head: number; tiltDeg: number }

/** The directions the pad's back may point for a face, the nearest to the face's own first. */
function padNormals(f: SensorFace, side: Side, faceR: number, frame: Frame): B3[] {
  // the way the surface round the sensor looks: its own part left out
  const around = frame.solid.away(add(f.p, f.out, 0.004), f.sensor);
  const bases = [f.out];
  if (angleDeg(around, f.out) > 3) bases.push(toward(f.out, around, angleDeg(around, f.out) / 2), around);
  const up: B3 = { x: 0, dy: 0, y: 1 }, mine: B3 = { x: side, dy: 0, y: 0 };
  const all: { n: B3; a: number }[] = [];
  for (const b of bases) for (const [u, r] of TILTS) {
    const n = toward(toward(b, mine, r), up, u);
    const a = angleDeg(n, f.out);
    // the face must stay inside what the foam gives when the pad is turned off it
    if (a > TILT_MAX_DEG || Math.min(faceR, PAD_RADIUS_M) * Math.sin(a * D2R) > PAD_GIVE_M) continue;
    if (!all.some((x) => angleDeg(x.n, n) < 1)) all.push({ n, a });
  }
  return all.sort((x, y) => x.a - y.a).map((x) => x.n);
}

/** Is a path clear: in reach, inside the wrist's limits, every part off the vehicle? The least room over the margins, or -1 where a joint fails. */
function pathClear(side: Side, ways: Way[], gap: (p: B3) => number, steps: number): number {
  // the joints first, finely: they cost little
  const fine = steps * 5;
  const sts: ArmState[] = [];
  let prev: ArmState | null = null;
  for (let i = 0; i <= fine; i++) {
    const f = i / fine;
    const { a, b, u } = along(side, ways, f);
    const st = onWays(side, ways, f, null);
    if (a.flip === b.flip) {
      const p = { x: a.p.x + (b.p.x - a.p.x) * u, dy: a.p.dy + (b.p.dy - a.p.dy) * u, y: a.p.y + (b.p.y - a.p.y) * u };
      const ax = unit({ x: a.axis.x + (b.axis.x - a.axis.x) * u, dy: a.axis.dy + (b.axis.dy - a.axis.dy) * u, y: a.axis.y + (b.axis.y - a.axis.y) * u });
      const k = aim(side, a.rail + (b.rail - a.rail) * u, p, ax, a.flip);
      if (!k.reachable || Math.abs(k.q.j5) > WRIST_BEND_MAX - 0.02 || Math.abs(k.q.j5) < PATH_BEND_MIN || Math.abs(k.q.j3) < ELBOW_MIN) return -1;
      // near the vehicle the forearm's roll stays well inside its limit
      if (Math.abs(k.q.j4) > ROLL_MAX - 0.05 && gap(p) < DETAIL_ARM.safeM + 0.02) return -1;
    }
    // no joint may jump between two steps: the forearm's roll going round the other way shows as one
    if (prev) for (const j of ['j1', 'j2', 'j3', 'j4', 'j5'] as const) if (Math.abs(st.q[j] - prev.q[j]) > 0.5) return -1;
    prev = st;
    if (i % 5 === 0) sts.push(st);
  }
  let least = Infinity;
  for (const st of sts) {
    least = Math.min(least, roomOver(armRoom(st, gap)));
    if (GANTRY_NORTH_M - armSouth(st) < GANTRY_ROOM_M + 0.03) return -1;
    if (least < PLAN_SLACK_M / 2) return least;
  }
  return least;
}

/**
 * The way the pad meets a place and where the carriage stands for it, or why no way works. `from`: where the arm
 * comes from. The way in from there, and the way home from the place, must be clear too.
 */
function solvePlace(g: Group, frame: Frame, from: End, prog: DetailProgram, id: string): Solved | Fail {
  const f = g.faces[0];
  const side = g.side;
  const faceR = Math.max(...g.faces.map((x) => x.r));
  let fail: Fail = { why: 'pad', best: -Infinity, limit: -PAD_GIVE_M };
  const note = (why: Skipped['why'], best: number, limit: number) => {
    if (STAGE[why] > STAGE[fail.why] || (STAGE[why] === STAGE[fail.why] && best > fail.best)) fail = { why, best, limit };
  };
  const label = g.faces.length > 1 ? `${f.label} and ${g.faces.length - 1} more` : f.label;
  const covers = [...new Set(g.faces.map((x) => x.sensor))];
  for (const n of padNormals(f, side, faceR, frame)) {
    const axis: B3 = { x: -n.x, dy: -n.dy, y: -n.y };
    const on = padOnPlace(f.p, axis, frame.gap);
    if (on.pad < -PAD_GIVE_M + 0.001) { note('pad', on.pad, -PAD_GIVE_M); continue; }
    if (on.head < HEAD_GAP_M + 0.001) { note('head', on.head, HEAD_GAP_M); continue; }
    const hoverP = add(f.p, n, DETAIL_ARM.hoverM), outP = add(f.p, n, DETAIL_ARM.safeM);
    const safe = safePoint(f.p, axis, frame);
    const wristDy = f.p.dy + n.dy * TOOL_BACK_M;
    const tries: { rail: number; flip: boolean; score: number; room: number }[] = [];
    const seen = new Set<string>();
    // the wrist's way the zone uses first (the roof's is the other one), then the other: the camera and the wrist's
    // actuator change sides with it
    for (const flip of [f.zone === 'roof', f.zone !== 'roof']) for (const off of RAIL_OFFSETS) {
      const rail = Math.min(TRACK_TO_M - 0.05, Math.max(DOCK_DY_M + 0.25, wristDy - off));
      if (seen.has(`${flip}${rail.toFixed(3)}`)) continue;
      seen.add(`${flip}${rail.toFixed(3)}`);
      // the place, its hover, the point straight out and the safe point, and half way between each
      const pts = [f.p, add(f.p, n, DETAIL_ARM.hoverM / 2), hoverP, add(f.p, n, (DETAIL_ARM.hoverM + DETAIL_ARM.safeM) / 2), outP];
      if (dist(safe, outP) > 1e-6) pts.push({ x: (hoverP.x + safe.x) / 2, dy: (hoverP.dy + safe.dy) / 2, y: (hoverP.y + safe.y) / 2 }, safe);
      let ok = true, bend = 0, south = -Infinity;
      const poses: ArmState[] = [];
      for (const p of pts) {
        const k = aim(side, rail, p, axis, flip);
        if (!k.reachable) { ok = false; note('reach', 0, 0); break; }
        const b = Math.abs(k.q.j5);
        if (b > WRIST_BEND_MAX - 0.03) { ok = false; note('wrist', -b, -WRIST_BEND_MAX); break; }
        if (b < WRIST_BEND_MIN || Math.abs(k.q.j4) > ROLL_MAX - 0.1) { ok = false; note('roll', -Math.abs(k.q.j4), -ROLL_MAX); break; }
        if (Math.abs(k.q.j3) > DETAIL_FOLD.elbowMax - 0.02) { ok = false; note('fold', -Math.abs(k.q.j3), -DETAIL_FOLD.elbowMax); break; }
        bend = Math.max(bend, b);
        poses.push(onWays(side, [{ p, axis, rail, flip }, { p, axis, rail, flip }], 0, null));
      }
      if (!ok) continue;
      let room = Infinity;
      for (const a of poses) {
        room = Math.min(room, roomOver(armRoom(a, frame.gap)));
        south = Math.max(south, armSouth(a));
        if (room < PLAN_SLACK_M) break;
      }
      if (room < PLAN_SLACK_M) { note('links', room, 0); continue; }
      if (GANTRY_NORTH_M - south < GANTRY_ROOM_M + 0.05) { note('gantry', GANTRY_NORTH_M - south, GANTRY_ROOM_M); continue; }
      tries.push({
        rail, flip, room,
        score: Math.min(room, 0.2) + 0.1 * Math.min(WRIST_BEND_MAX - bend, 0.5) - RAIL_STAY * Math.abs(rail - from.rail) - (flip === (from.carry ? f.zone === 'roof' : from.flip) ? 0 : FLIP_STAY),
      });
    }
    // the best stop whose way in and way home are clear; the straight way first, then by the tuck
    tries.sort((a, b) => b.score - a.score);
    for (const viaCarry of [false, true]) {
      if (viaCarry && from.carry) break;
      for (const tr of tries.slice(0, 5)) {
        const sensor: Sensor = { id, label, zone: f.zone, p: f.p, axis, rail: tr.rail, safe, flip: tr.flip, covers, faces: g.faces.map((x) => x.id), ...(viaCarry ? { viaCarry } : {}) };
        const start = from.carry ? carryWay(side, tr.rail) : from;
        const inn = pathClear(side, route(side, start, sensor, prog), frame.gap, viaCarry ? 70 : 40);
        if (inn < PLAN_SLACK_M / 2) { note('path', inn, 0); continue; }
        const home = pathClear(side, toCarry(side, hoverWay(sensor), safe, prog), frame.gap, 30);
        if (home < PLAN_SLACK_M / 2) { note('path', home, 0); continue; }
        return { sensor, room: Math.min(tr.room, inn, home), pad: on.pad, head: on.head, tiltDeg: angleDeg(n, f.out) };
      }
    }
  }
  return fail;
}

const WHY_TEXT: Record<Skipped['why'], (best: number, limit: number) => string> = {
  pad: (b, l) => `The pad's face would go ${(-b * 1000).toFixed(0)} mm into the vehicle beside the sensor. Its foam gives ${(-l * 1000).toFixed(0)} mm.`,
  head: (b, l) => `The plate behind the pad would come ${(b * 1000).toFixed(0)} mm from the vehicle. It must keep ${(l * 1000).toFixed(0)} mm.`,
  reach: () => 'The arm cannot reach the place, its hover and its safe point from any stop on its track.',
  wrist: (b, l) => `The wrist would bend ${(-b).toFixed(2)} rad. It may bend ${(-l).toFixed(2)} rad.`,
  roll: (b, l) => `The forearm would roll ${(-b).toFixed(2)} rad, or the wrist would be straight. Near the vehicle the forearm may roll ${(-l).toFixed(2)} rad, and the rule plans to ${(-l - 0.1).toFixed(2)}.`,
  fold: (b, l) => `The place is too near the arm's own track: the elbow would fold ${(-b).toFixed(2)} rad. It may fold ${(-l).toFixed(2)} rad.`,
  links: (b) => `A part of the arm would be ${(-b * 1000).toFixed(0)} mm inside the room it must keep from the vehicle.`,
  gantry: (b, l) => `The arm would come ${b.toFixed(2)} m from the stowed gantry. It must keep ${l.toFixed(2)} m.`,
  path: (b) => (b <= -1 ? 'On the way to the place or home from it a joint would pass its limit.' : `On the way to the place or home from it a part of the arm would be ${(-b * 1000).toFixed(0)} mm inside the room it must keep from the vehicle.`),
};

// ── the whole program ────────────────────────────────────────────────────────

/** The order of an arm's places in a zone. */
function ordered(zone: WipeStation, list: Group[]): Group[] {
  const by = (f: (g: Group) => number) => [...list].sort((a, b) => f(a) - f(b) || a.faces[0].id.localeCompare(b.faces[0].id));
  if (zone === 'front') return by((g) => Math.abs(g.faces[0].p.x));    // the nose from the centre out to its corner
  if (zone === 'rear') return by((g) => -Math.abs(g.faces[0].p.x));    // the tail from its corner in
  return by((g) => g.faces[0].p.dy);                                   // the sides and the roof from front to rear
}

/**
 * The time a move needs, s. The path is walked finely, and the time is the least that keeps every joint and the
 * carriage inside its planned speed where the path asks the most of it. A move's pace peaks at 1.25 times its mean
 * (detailArm.glide).
 */
function moveTime(side: Side, ways: Way[], peak = 1.25, n = MOVE_STEPS): number {
  let t = 0;
  let prev = onWays(side, ways, 0, null);
  for (let i = 1; i <= n; i++) {
    const st = onWays(side, ways, i / n, null);
    for (const j of ['j1', 'j2', 'j3', 'j4', 'j5'] as const) t = Math.max(t, (peak * Math.abs(st.q[j] - prev.q[j]) * n) / (SPEED_PLAN * JOINT_SPEED[j]));
    t = Math.max(t, (peak * Math.abs(st.rail - prev.rail) * n) / RAIL_PLAN_MPS);
    prev = st;
  }
  return t;
}
/**
 * A move with its own pace (detailArm.paced): the time it needs, and the table of the share of that time used up at
 * each even step along the path. Each short part of the path is given the time its busiest joint, or the carriage,
 * needs at its planned speed. So the whole move is as long as its parts need, not as long as its worst part would
 * make it at one even pace.
 */
function movePlan(side: Side, ways: Way[]): { s: number; pace: number[] } {
  const n = MOVE_STEPS;
  const need = new Float64Array(n);
  let prev = onWays(side, ways, 0, null);
  for (let i = 0; i < n; i++) {
    const st = onWays(side, ways, (i + 1) / n, null);
    // never less than a walking pace along the path: a part where no joint turns is not crossed in no time
    let c = PACE_FLOOR_S / n;
    for (const j of ['j1', 'j2', 'j3', 'j4', 'j5'] as const) c = Math.max(c, Math.abs(st.q[j] - prev.q[j]) / (SPEED_PLAN * JOINT_SPEED[j]));
    need[i] = Math.max(c, Math.abs(st.rail - prev.rail) / RAIL_PLAN_MPS);
    prev = st;
  }
  // each part takes the most its near neighbours need, so the pace does not change in one step
  const pace: number[] = [0];
  let total = 0;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let k = Math.max(0, i - PACE_BLUR); k <= Math.min(n - 1, i + PACE_BLUR); k++) c = Math.max(c, need[k]);
    total += c;
    pace.push(total);
  }
  for (let i = 0; i <= n; i++) pace[i] /= total;
  pace[n] = 1;
  // the move's pace peaks at 1.25 times its mean (detailArm.glide)
  return { s: 1.25 * total, pace };
}

const cache = new Map<string, FleetDetail>();

/** The detail arms' program for a fleet vehicle. */
export function fleetDetailProgram(spec: VehicleSpec): FleetDetail {
  const hit = cache.get(spec.key);
  if (hit) return hit;
  const solid = fleetWashSolid(spec);
  const map = sensorMap(spec);
  const gap = (p: B3) => solid.gap(p);
  // over the vehicle's plan, grown as the generic car's is: 0.24 m a side, 0.2 m each end
  const frame: Frame = {
    gap, solid, over: { x: solid.halfWidth + 0.24, dy: solid.halfLen + 0.2 },
    // the pad crosses the vehicle this far over its highest part. Not higher: over a low roof the arm reaches the
    // centreline only if it need not lift far (the generic car's 2.05 m is 0.41 m over its roof lidar)
    overM: solid.top + OVER_TOP_M,
  };

  // 1. places: faces one pad covers together
  const groups: Group[] = [];
  for (const f of map.faces) {
    const host = groups.find((g) => g.side === f.arm && g.faces[0].zone === f.zone && dot(g.faces[0].out, f.out) >= PLACE_MERGE.cos
      && Math.abs(dot(add(f.p, g.faces[0].p, -1), g.faces[0].out)) <= PLACE_MERGE.planeM
      && dist(f.p, g.faces[0].p) + Math.min(f.r, PLACE_MERGE.faceM) <= PLACE_MERGE.radiusM);
    if (host) host.faces.push(f); else groups.push({ faces: [f], side: f.arm });
  }

  // 2-5. each arm's places in order, each solved from where the arm then is, or left out
  const skipped: Skipped[] = [];
  const planned = { room: Infinity, pad: Infinity, head: Infinity, tiltDeg: 0 };
  const sensors: Record<Side, Sensor[]> = { 1: [], [-1]: [] } as Record<Side, Sensor[]>;
  const noLead = Object.fromEntries(WIPE_STATIONS.map((z) => [z, { 1: 0, [-1]: 0 }])) as unknown as FleetDetail['lead'];
  const prog = (lead: FleetDetail['lead']): DetailProgram => ({ key: spec.key, sensors, gap, over: frame.over, overM: frame.overM, lead });
  for (const side of SIDES) {
    let from: End = carryWay(side, DOCK_DY_M);
    for (const zone of WIPE_STATIONS) {
      for (const g of ordered(zone, groups.filter((x) => x.side === side && x.faces[0].zone === zone))) {
        const r = solvePlace(g, frame, from, prog(noLead), g.faces[0].id);
        if ('why' in r) {
          skipped.push({
            sensors: [...new Set(g.faces.map((x) => x.sensor))], face: g.faces[0].id, label: g.faces[0].label, side,
            why: r.why, best: r.best, limit: r.limit, text: WHY_TEXT[r.why](r.best, r.limit),
          });
          continue;
        }
        sensors[side].push(r.sensor);
        planned.room = Math.min(planned.room, r.room); planned.pad = Math.min(planned.pad, r.pad);
        planned.head = Math.min(planned.head, r.head); planned.tiltDeg = Math.max(planned.tiltDeg, r.tiltDeg);
        from = hoverWay(r.sensor);
      }
    }
  }

  // 6. the two arms in the same turn: the west arm the other way round, or one arm after the other
  const lead = Object.fromEntries(WIPE_STATIONS.map((z) => [z, { 1: 0, [-1]: 0 }])) as Record<WipeStation, Record<Side, number>>;
  const wristAt = (side: Side, w: Way) => onWays(side, [w, w], 0, null).wrist;
  const tooNear = (e: Way, w: Way) => dist(e.p, w.p) < PADS_APART_M + 0.06 || dist(wristAt(1, e), wristAt(-1, w)) < WRISTS_APART_M + 0.08;
  for (const zone of WIPE_STATIONS) {
    const clash = (): boolean => {
      const p = prog(lead);
      const e = zoneSensors(1, zone, p), w = zoneSensors(-1, zone, p);
      if (!e.length || !w.length) return false;
      const n = zoneTurns(zone, p);
      const where = (side: Side, list: Sensor[], k: number): Way[] => {
        const j = k - lead[zone][side];
        // idle before its first place: where the zone before left it. After its last: waiting above it
        if (j < 0) { const st = zoneStart(side, zone, p); return st.carry ? [] : [st]; }
        // after its last: waiting above it, or tucked out of the way where the arms take the zone in turn
        if (j >= list.length) return taken(zone, p) ? [] : [waitWay(list[list.length - 1])];
        return [hoverWay(list[j]), { p: list[j].p, axis: list[j].axis, rail: list[j].rail, flip: list[j].flip }, ...(j > 0 ? [hoverWay(list[j - 1])] : [])];
      };
      for (let k = 0; k < n; k++) for (const a of where(1, e, k)) for (const b of where(-1, w, k)) if (tooNear(a, b)) return true;
      return false;
    };
    if (!clash()) continue;
    lead[zone][-1] = sensors[1].filter((s) => s.zone === zone).length;
  }
  // an arm that tucked out of the other's way comes to its next place from the tuck: that way is checked too
  for (const side of SIDES) {
    for (let zi = 1; zi < WIPE_STATIONS.length; zi++) {
      const zone = WIPE_STATIONS[zi];
      for (;;) {
        const p = prog(lead);
        const first = zoneSensors(side, zone, p)[0];
        const start = zoneStart(side, zone, p);
        if (!first || !start.carry || first === sensors[side][0]) break;
        const clear = pathClear(side, route(side, start, first, p), gap, 60);
        if (clear >= PLAN_SLACK_M / 2) break;
        const g = groups.find((x) => x.side === side && x.faces[0].id === first.id)!;
        skipped.push({
          sensors: [...new Set(g.faces.map((x) => x.sensor))], face: first.id, label: g.faces[0].label, side,
          why: 'path', best: clear, limit: 0, text: WHY_TEXT.path(clear, 0),
        });
        sensors[side].splice(sensors[side].indexOf(first), 1);
      }
    }
  }
  const final = prog(lead);

  // 7. the time. Each turn is as long as its longer move needs, with the touch, the polish and the lift
  const need = {} as Record<WipeStation, number>;
  const turns = {} as Record<WipeStation, { s: number; parts: TurnParts }[]>;
  const awayPace = Object.fromEntries(WIPE_STATIONS.map((z) => [z, { 1: undefined, [-1]: undefined }])) as Record<WipeStation, Record<Side, number[] | undefined>>;
  for (const zone of WIPE_STATIONS) {
    const n = zoneTurns(zone, final);
    turns[zone] = [];
    for (let k = 0; k < n; k++) {
      let move = MOVE_MIN_S, touch: number = TURN_S.touch;
      for (const side of SIDES) {
        const list = zoneSensors(side, zone, final);
        const j = k - lead[zone][side];
        if (j === list.length && list.length > 0 && taken(zone, final)) {
          // done before the other arm: its tuck out of the way is this turn's move
          const last = list[list.length - 1];
          const away = movePlan(side, toCarry(side, hoverWay(last), last.safe, final));
          awayPace[zone][side] = away.pace;
          move = Math.max(move, away.s);
        }
        if (j < 0 || j >= list.length) continue;
        const s = list[j];
        const plan = movePlan(side, route(side, j > 0 ? hoverWay(list[j - 1]) : zoneStart(side, zone, final), s, final));
        s.pace = plan.pace;
        move = Math.max(move, plan.s);
        // the touch and the lift: 0.15 m straight in and out, eased (their pace peaks at 1.5 times its mean)
        touch = Math.max(touch, moveTime(side, [hoverWay(s), { p: s.p, axis: s.axis, rail: s.rail, flip: s.flip }], 1.5, 40));
      }
      const total = move + touch + TURN_S.polish + touch;
      turns[zone].push({ s: total, parts: { move: move / total, touch: touch / total, polish: TURN_S.polish / total, lift: touch / total } });
    }
    need[zone] = n === 0 ? ZONE_IDLE_S : turns[zone].reduce((a, t) => a + t.s, 0);
  }
  const needS = WIPE_STATIONS.reduce((a, z) => a + need[z], 0);
  // never shorter than the generic program's four zones: a vehicle with few sensors is polished at a slower pace
  const fixed = WIPE_STATIONS.reduce((a, z) => a + WASH_PHASE_S[`wipe_${z}`], 0);
  const stretch = Math.max(1, fixed / needS);
  const zoneS = Object.fromEntries(WIPE_STATIONS.map((z) => [z, need[z] * stretch])) as Record<WipeStation, number>;
  const timing = Object.fromEntries(WIPE_STATIONS.map((z) => {
    let at = 0;
    const ends = turns[z].map((t) => { at += t.s; return at / need[z]; });
    if (ends.length) ends[ends.length - 1] = 1;
    return [z, { ends, parts: turns[z].map((t) => t.parts) }];
  })) as unknown as NonNullable<DetailProgram['timing']>;

  const cleaned = new Map<string, { side: Side; place: string }[]>();
  for (const side of SIDES) for (const s of sensors[side]) for (const id of s.covers ?? []) {
    cleaned.set(id, [...(cleaned.get(id) ?? []), { side, place: s.id }]);
  }
  // the way home: the longer arm's tuck from where the rear zone leaves it, then the generic ride and fold
  const tucked = { ...final, timing, awayPace };
  let tuckS = WASH_PHASE_S.arms_stow - STOW_RIDE_S - STOW_FOLD_S;
  const stowPace = { 1: undefined, [-1]: undefined } as Record<Side, number[] | undefined>;
  for (const side of SIDES) {
    const end = zoneEnd(side, 'rear', tucked);
    if (end.carry) continue;
    const plan = movePlan(side, toCarry(side, end, end.safe, tucked));
    stowPace[side] = plan.pace;
    tuckS = Math.max(tuckS, plan.s);
  }
  const stowS = tuckS + STOW_RIDE_S + STOW_FOLD_S;
  const stow = { tuck: tuckS / stowS, ride: STOW_RIDE_S / stowS, rideEnd: (tuckS + STOW_RIDE_S) / stowS, fold: STOW_FOLD_S / stowS, pace: stowPace };
  // a seat that ends early: the longest tuck from any place, pad on it
  let retractS: number = WASH_PHASE_S.retract;
  for (const side of SIDES) for (const s of sensors[side]) {
    retractS = Math.max(retractS, moveTime(side, toCarry(side, { p: s.p, axis: s.axis, rail: s.rail, flip: s.flip }, add(s.p, s.axis, -DETAIL_ARM.safeM), tucked)));
  }

  const out: FleetDetail = { ...tucked, stow, solid, skipped, zoneS, needS, stowS, retractS, cleaned, planned };
  cache.set(spec.key, out);
  return out;
}
