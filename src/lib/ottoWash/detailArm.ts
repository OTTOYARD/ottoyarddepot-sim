/**
 * THE DETAIL ARMS — the two six-axis arms that polish a car's sensors in a wash bay, one each side.
 *
 * Chase, 2026-11-12: "swivel/mechanical arms similar to robocharging arm ... able to move like a hand almost to reach
 * difficult angles of cameras and sensors ... independent arms on either side of the car slide down the rail."
 *
 * Each arm IS the OTTO-CHARGE ARM's arm (cobotSpec, cobotIK) with a polishing head, on a carriage on its own floor track.
 * This file says where every sensor is, how each arm reaches it, and the path the pad takes between sensors. Pure.
 *
 * FRAMES. The BAY frame, in METRES here: `x` east of the drive line, `dy` south of the parked car's centre, `y` up from
 * grade. Each arm's own frame is the charge arm's: origin on J1's axis at the mount, +Y up, +Z toward the car, +X
 * along the track (south for the east arm, north for the west arm).
 */
import { OTTO_CHARGE_ARM, METRES_PER_PLAN_UNIT, MOUNT_HEIGHT_M, type CobotSpec } from '@/lib/ottoChargeArm/cobotSpec';
import {
  forwardElbow, forwardTCP, forwardWristCentre, lerpAngles, solveIK, type JointAngles, type Vec3,
} from '@/lib/ottoChargeArm/cobotIK';
import { carSolidInArmFrame, clearanceToCar } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { DETAIL_ARM, WASH_GANTRY, type WipeStation } from './washSpec';

const M = METRES_PER_PLAN_UNIT;
const D = WASH_GANTRY.detail;

/** The arm: the charge arm's links, joints and limits, with the polishing head's length for a tool. */
export const DETAIL_SPEC: CobotSpec = { ...OTTO_CHARGE_ARM, tool: DETAIL_ARM.toolM };
/** Each track's line from the drive line, metres. */
export const TRACK_X_M = D.trackX * M;
export const DOCK_DY_M = D.dockDy * M;
export const TRACK_TO_M = D.trackTo * M;

/** A point or a direction in the bay frame, metres. */
export interface B3 { x: number; dy: number; y: number }
/** Which side of the car an arm works: +1 east, -1 west. */
export type Side = 1 | -1;
export const SIDES: readonly Side[] = [1, -1];

const add = (a: B3, b: B3, k = 1): B3 => ({ x: a.x + b.x * k, dy: a.dy + b.dy * k, y: a.y + b.y * k });
const lerp3 = (a: B3, b: B3, f: number): B3 => ({ x: a.x + (b.x - a.x) * f, dy: a.dy + (b.dy - a.dy) * f, y: a.y + (b.y - a.y) * f });
const unit = (a: B3): B3 => { const n = Math.hypot(a.x, a.dy, a.y) || 1; return { x: a.x / n, dy: a.dy / n, y: a.y / n }; };
const dist = (a: B3, b: B3) => Math.hypot(a.x - b.x, a.dy - b.dy, a.y - b.y);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => { const u = clamp01(t); return u * u * (3 - 2 * u); };
/** A move's pace: speed up over the first fifth, hold, slow over the last fifth. Its peak is 1.25 times its mean. */
const glide = (t: number) => {
  const u = clamp01(t), r = 0.2, v = 1 / (1 - r);
  if (u < r) return (v * u * u) / (2 * r);
  if (u > 1 - r) return 1 - (v * (1 - u) * (1 - u)) / (2 * r);
  return v * (u - r / 2);
};

// ── the car, as the pad meets it ─────────────────────────────────────────────

const CAR = carSolidInArmFrame(0, 0);
/** Clearance from a bay point to the car's solid, metres (negative inside). The car faces north. */
export const carGapM = (p: B3): number => clearanceToCar({ x: -p.dy, y: p.y, z: p.x }, CAR);

/** The point where a ray from `from` along `axis` meets the car's surface (sphere tracing on the car's own solid). */
function onCar(from: B3, axis: B3): B3 {
  let p = from;
  for (let i = 0; i < 80; i++) {
    const g = carGapM(p);
    if (g < 2e-5) break;
    p = add(p, axis, g);
  }
  return p;
}

// ── the sensors ──────────────────────────────────────────────────────────────

/** One place a pad polishes: the point on the car, the way the pad faces into it, and where the carriage stands. */
export interface Sensor {
  id: string;
  /** what it is, for the screens */
  label: string;
  zone: WipeStation;
  /** the point on the car's surface */
  p: B3;
  /** unit vector INTO the car: the pad's face looks along it */
  axis: B3;
  /** the carriage's place along the bay for this sensor */
  rail: number;
  /** the safe point the pad leaves by and arrives by */
  safe: B3;
  /** which of the wrist's two ways the arm uses here: the roof's sensors take the other one (see aim) */
  flip: boolean;
}

/**
 * The east arm's sensors, in the order it visits them, as rays aimed at the twin's one car shape: a real fleet gives
 * each model's sensor map, and the wrist camera corrects each point. The west arm's are these mirrored, and it goes
 * round the roof lidar the other way. A ray marked `eastOnly` is one arm's alone (none is, on this car).
 *   front  2 on the nose's upright face, 1 on its corner
 *   sides  the wing camera, the pillar camera, the rear-quarter camera
 *   roof   the roof lidar from 3 sides
 *   rear   the tail's corner and 2 on its upright face
 */
/** The pad's tilt down onto the roof lidar's shoulder: cos and sin of 40 degrees. */
const POD_C = Math.cos((40 * Math.PI) / 180), POD_S = Math.sin((40 * Math.PI) / 180);
const RAYS: { id: string; label: string; zone: WipeStation; from: [number, number, number]; axis: [number, number, number]; rail: number; eastOnly?: boolean }[] = [
  { id: 'nose_in', label: 'front radar', zone: 'front', from: [0.25, -3.2, 0.57], axis: [0, 1, 0], rail: -3.05 },
  { id: 'nose_out', label: 'front camera', zone: 'front', from: [0.70, -3.2, 0.57], axis: [0, 1, 0], rail: -3.05 },
  { id: 'nose_corner', label: 'front corner lidar', zone: 'front', from: [1.523, -2.911, 0.62], axis: [-Math.SQRT1_2, Math.SQRT1_2, 0], rail: -2.9 },
  { id: 'wing', label: 'wing camera', zone: 'sides', from: [2.0, -1.15, 0.95], axis: [-1, 0, 0], rail: -1.45 },
  { id: 'pillar', label: 'pillar camera', zone: 'sides', from: [2.0, 0.15, 1.05], axis: [-1, 0, 0], rail: -0.15 },
  { id: 'quarter', label: 'rear-quarter camera', zone: 'sides', from: [2.0, 1.25, 0.95], axis: [-1, 0, 0], rail: 0.95 },
  // the roof lidar: from 3 sides, the pad looking 40 degrees down onto the top edge of its window, so the forearm comes
  // in over the roof and not along it. The two arms do 6 places round it. Its cap's top is not a sensor, and no pad goes there.
  { id: 'pod_fore', label: 'roof lidar, front side', zone: 'roof', from: [0.481, -0.687, 2.2185], axis: [-POD_C * 0.5736, POD_C * 0.8192, -POD_S], rail: -0.3 },
  { id: 'pod_side', label: 'roof lidar, side', zone: 'roof', from: [0.839, 0, 2.2185], axis: [-POD_C, 0, -POD_S], rail: 0 },
  { id: 'pod_aft', label: 'roof lidar, rear side', zone: 'roof', from: [0.481, 0.687, 2.2185], axis: [-POD_C * 0.5736, -POD_C * 0.8192, -POD_S], rail: 0.3 },
  { id: 'tail_corner', label: 'rear corner lidar', zone: 'rear', from: [1.523, 2.911, 0.62], axis: [-Math.SQRT1_2, -Math.SQRT1_2, 0], rail: 2.35 },
  { id: 'tail_out', label: 'rear camera', zone: 'rear', from: [0.70, 3.2, 0.57], axis: [0, -1, 0], rail: 2.35 },
  { id: 'tail_in', label: 'rear radar', zone: 'rear', from: [0.25, 3.2, 0.57], axis: [0, -1, 0], rail: 2.35 },
];

/** Is a point over the car's plan, where a move must go over the roof and not through the cabin? */
const overCar = (p: B3) => Math.abs(p.x) < 1.2 && Math.abs(p.dy) < 2.55;

function sensorsFor(side: Side): Sensor[] {
  const list = RAYS.filter((r) => side === 1 || !r.eastOnly).map((r) => {
    const axis = unit({ x: side * r.axis[0], dy: r.axis[1], y: r.axis[2] });
    const p = onCar({ x: side * r.from[0], dy: r.from[1], y: r.from[2] }, axis);
    const out = add(p, axis, -DETAIL_ARM.safeM);
    // a sensor on the roof is left and reached from above; any other, straight out from its face
    const safe = overCar(out) ? { x: out.x, dy: out.dy, y: DETAIL_ARM.overM } : out;
    return { id: r.id, label: r.label, zone: r.zone, p, axis, rail: r.rail, safe, flip: r.zone === 'roof' };
  });
  if (side === 1) return list;
  // The west arm goes round the roof lidar the other way: rear side first. So the two pads are always on opposite
  // faces of the dome, never side by side on it.
  const roof = list.filter((s) => s.zone === 'roof').reverse();
  let k = 0;
  return list.map((s) => (s.zone === 'roof' ? roof[k++] : s));
}
export const SENSORS: Readonly<Record<Side, readonly Sensor[]>> = { 1: sensorsFor(1), [-1]: sensorsFor(-1) } as Record<Side, readonly Sensor[]>;
export const zoneSensors = (side: Side, zone: WipeStation): Sensor[] => SENSORS[side].filter((s) => s.zone === zone);
const hover = (s: Sensor): B3 => add(s.p, s.axis, -DETAIL_ARM.hoverM);

// ── one arm's kinematics ─────────────────────────────────────────────────────

/** A bay point in an arm's own frame, for the carriage at `rail`. */
const toArm = (side: Side, rail: number, p: B3): Vec3 => ({ x: side * (p.dy - rail), y: p.y - MOUNT_HEIGHT_M, z: TRACK_X_M - side * p.x });
const dirToArm = (side: Side, a: B3): Vec3 => ({ x: side * a.dy, y: a.y, z: -side * a.x });
const toBay = (side: Side, rail: number, v: Vec3): B3 => ({ x: side * (TRACK_X_M - v.z), dy: rail + side * v.x, y: v.y + MOUNT_HEIGHT_M });

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The joints that put the pad's face at `p`, looking along `axis`, with the carriage at `rail`. The wrist has two
 * ways to any direction. Round the car's sides the arm takes the one with the wrist bent the negative way, and on the
 * roof the other one (`flip`): on each, the forearm's roll stays inside 2 rad and never passes its limit, so the
 * joints do not jump as the pad moves. The arm changes from one to the other only above the car, lifted clear.
 */
export function aim(side: Side, rail: number, p: B3, axis: B3, flip = false): { q: JointAngles; reachable: boolean } {
  const a = dirToArm(side, axis);
  const k = solveIK(toArm(side, rail, p), { x: -a.x, y: -a.y, z: -a.z }, DETAIL_SPEC);
  let { j4, j5 } = k;
  if (flip ? j5 < 0 : j5 > 0) { j4 = wrapPi(j4 + Math.PI); j5 = -j5; }
  return { q: { j1: k.j1, j2: k.j2, j3: k.j3, j4, j5, j6: 0 }, reachable: k.reachable };
}

/** Parked: folded along the track, heading north (away from the gantry), the tool hanging straight down into its rinse cup. */
export function stowAngles(side: Side): JointAngles {
  const { j2, j3 } = DETAIL_ARM.stow;
  return { j1: -side * (Math.PI / 2), j2, j3, j4: 0, j5: Math.PI - (j2 + j3), j6: 0 };
}

/** Tucked for travel: the pad 0.85 m inboard of the track at 1.25 m, facing the car. The same joints wherever the carriage is. */
const CARRY_P = (side: Side, rail: number): B3 => ({ x: side * 1.25, dy: rail, y: 1.25 });
const CARRY_AXIS = (side: Side): B3 => ({ x: -side, dy: 0, y: 0 });
export const carryAngles = (side: Side): JointAngles => aim(side, 0, CARRY_P(side, 0), CARRY_AXIS(side)).q;

/** A place on a path: the pad's point, the way it looks, the carriage's place, and which way the wrist is. */
export interface Way { p: B3; axis: B3; rail: number; flip: boolean }

/** One arm, as the screens and the tests need it. Points are in the bay frame, METRES. */
export interface ArmState {
  side: Side;
  /** the carriage along the bay, metres from the car's centre (negative = north) */
  rail: number;
  q: JointAngles;
  /** the pad's face centre, and the way it looks */
  pad: B3;
  axis: B3;
  elbow: B3;
  wrist: B3;
  /** 0..1: the pad pressed on a sensor */
  engage: number;
  /** the sensor it is at or going to */
  sensor: string | null;
  /**
   * How it leaves if the seat ends now. Null: its joints go straight to the tuck (it is at its dock or tucked). A way:
   * the pad backs off the car from there. `mid`: the wrist is turning over above the track, and `esc` is where that ends.
   */
  esc: Way | null;
  mid: boolean;
}

function state(side: Side, rail: number, q: JointAngles, engage = 0, sensor: string | null = null, esc: Way | null = null, mid = false): ArmState {
  const tip = forwardTCP(q, DETAIL_SPEC), w = forwardWristCentre(q, DETAIL_SPEC);
  const pad = toBay(side, rail, tip), wrist = toBay(side, rail, w);
  return { side, rail, q, pad, axis: unit({ x: pad.x - wrist.x, dy: pad.dy - wrist.dy, y: pad.y - wrist.y }), elbow: toBay(side, rail, forwardElbow(q, DETAIL_SPEC)), wrist, engage, sensor, esc, mid };
}
const at = (side: Side, rail: number, p: B3, axis: B3, flip: boolean, engage = 0, sensor: string | null = null, turn = 0): ArmState => {
  const { q } = aim(side, rail, p, axis, flip);
  return state(side, rail, { ...q, j6: turn }, engage, sensor, { p, axis, rail, flip });
};

export const stowed = (side: Side): ArmState => state(side, DOCK_DY_M, stowAngles(side));

// ── the path between two places ──────────────────────────────────────────────

type End = Way & { safe: B3 };
/**
 * How long a part of a path is, as time at an even pace: its line at 1 m/s, or its busiest joint's turn at that
 * joint's share of speed, whichever is more. So no joint hurries on a part where the pad moves little.
 */
const PACE = { j1: 0.7, j2: 0.7, j3: 0.9, j4: 1.4, j5: 1.4 } as const;
const turn = (a: JointAngles, b: JointAngles) => Math.max(...(['j1', 'j2', 'j3', 'j4', 'j5'] as const).map((k) => Math.abs(a[k] - b[k]) / PACE[k]));
const qOf = (side: Side, w: Way) => aim(side, w.rail, w.p, w.axis, w.flip).q;
/** Where an arm is on a polyline of ways, by its length, 0..1: the two ways it is between, and how far. */
function along(side: Side, ways: Way[], f: number): { a: Way; b: Way; u: number } {
  const seg = ways.slice(1).map((w, i) => {
    const a = ways[i];
    return Math.max(1e-6, dist(a.p, w.p) + 0.5 * Math.abs(a.rail - w.rail), turn(qOf(side, a), qOf(side, w)));
  });
  const total = seg.reduce((a, b) => a + b, 0);
  let d = clamp01(f) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) return { a: ways[i], b: ways[i + 1], u: clamp01(d / seg[i]) };
    d -= seg[i];
  }
  const last = ways[ways.length - 1];
  return { a: last, b: last, u: 1 };
}
/**
 * The arm on a polyline of ways. Between two ways on the same wrist side the pad goes in a straight line and the
 * joints follow. Between two on different sides the pad's point does not change (they are the same place above the
 * track, see `turnOver`): only the wrist's joints turn, from one way to the other.
 */
function onWays(side: Side, ways: Way[], f: number, sensor: string | null): ArmState {
  const { a, b, u } = along(side, ways, f);
  const rail = a.rail + (b.rail - a.rail) * u;
  if (a.flip !== b.flip) {
    const plain = a.flip ? b : a;
    return state(side, rail, lerpAngles(qOf(side, a), qOf(side, b), u), 0, sensor, plain, true);
  }
  return at(side, rail, lerp3(a.p, b.p, u), unit(lerp3(a.axis, b.axis, u)), a.flip, 0, sensor);
}
const lifted = (w: Way): Way => ({ ...w, p: { x: w.p.x, dy: w.p.dy, y: Math.max(w.p.y, DETAIL_ARM.overM) } });
/**
 * The place the wrist turns over: above the arm's own side of the bay, 0.85 m inboard of its track and above the
 * car's roof line. The pad's point and its direction stay. The forearm rolls half a turn and the wrist bends the other way.
 */
const apex = (side: Side, w: Way, flip: boolean): Way => ({ p: { x: side * 1.25, dy: w.rail, y: DETAIL_ARM.overM }, axis: APEX_AXIS(side), rail: w.rail, flip });
/**
 * There the pad looks about 55 degrees down, toward the car and a little along the track. So the wrist is bent well
 * away from straight (where its two ways meet), and the forearm's roll is well inside its limit on both ways.
 */
const APEX_AXIS = (side: Side): B3 => unit({ x: -side * 0.5, dy: -0.3, y: -0.81 });
const turnOver = (side: Side, w: Way, to: boolean): Way[] => [apex(side, w, w.flip), apex(side, w, to)];
/**
 * From one place to the next sensor's hover: out to its safe point; over the roof if either is over the car; the
 * wrist turned over above the track if the two need different ways of it; and in.
 */
function route(side: Side, a: End, b: Sensor): Way[] {
  const sa: Way = { p: a.safe, axis: a.axis, rail: a.rail, flip: a.flip }, sb: Way = { p: b.safe, axis: b.axis, rail: b.rail, flip: b.flip };
  const flips = a.flip !== b.flip;
  const over = overCar(sa.p) !== overCar(sb.p) || flips;
  const mid: Way[] = !over ? [] : flips ? [lifted(sa), ...turnOver(side, sa, b.flip), lifted(sb)] : [lifted(sa), lifted(sb)];
  return [a, sa, ...mid, sb, { p: hover(b), axis: b.axis, rail: b.rail, flip: b.flip }];
}
const carryWay = (side: Side, rail: number): End => ({ p: CARRY_P(side, rail), axis: CARRY_AXIS(side), rail, flip: false, safe: CARRY_P(side, rail) });
const hoverWay = (s: Sensor): End => ({ p: hover(s), axis: s.axis, rail: s.rail, flip: s.flip, safe: s.safe });
/** Waiting above a sensor it has done, at its safe point, while the other arm works near by. */
const waitWay = (s: Sensor): End => ({ p: s.safe, axis: s.axis, rail: s.rail, flip: s.flip, safe: s.safe });
/** From a place to the tuck: out, up if it is over the car, the wrist turned back if it is the roof's way, and down. */
function toCarry(side: Side, from: Way, safe: B3): Way[] {
  const s: Way = { ...from, p: safe };
  const over = overCar(safe) || from.flip;
  return [from, s, ...(over ? [lifted(s)] : []), ...(from.flip ? turnOver(side, s, false) : over ? [apex(side, s, false)] : []), carryWay(side, from.rail)];
}

// ── the program, one arm at a time ───────────────────────────────────────────

const ZONES: readonly WipeStation[] = ['front', 'sides', 'roof', 'rear'];
/**
 * The turns an arm takes in a zone: one for each of its sensors, and the same number for both arms. An arm with
 * fewer sensors in a zone than the other waits, lifted, for the turns it has none.
 */
export const zoneTurns = (zone: WipeStation): number => Math.max(zoneSensors(1, zone).length, zoneSensors(-1, zone).length);
/** Where an arm is when a zone ends: at its last sensor's hover, or waiting above it. */
function zoneEnd(side: Side, zone: WipeStation): End {
  const list = zoneSensors(side, zone);
  const last = list[list.length - 1];
  return list.length < zoneTurns(zone) ? waitWay(last) : hoverWay(last);
}
/** Where an arm is when a zone starts: where the zone before ended, or tucked at the nose's place. */
function zoneStart(side: Side, zone: WipeStation): End {
  const i = ZONES.indexOf(zone);
  return i <= 0 ? carryWay(side, firstRail(side)) : zoneEnd(side, ZONES[i - 1]);
}
export const firstRail = (side: Side): number => zoneSensors(side, 'front')[0].rail;

/** The polish: the pad turns a quarter turn each way on the sensor, `POLISH_STROKES` times. It never spins free. */
export const POLISH_STROKES = 1;
export const POLISH_TURN = Math.PI / 2;

/** One arm through a zone, t 0..1: each sensor in turn gets a move, a touch, a polish and a lift. */
export function armInZone(side: Side, zone: WipeStation, t: number, parts: { move: number; touch: number; polish: number; lift: number }): ArmState {
  const list = zoneSensors(side, zone);
  const n = zoneTurns(zone);
  const k = Math.min(n - 1, Math.floor(clamp01(t) * n));
  const u = clamp01(t) * n - k;
  if (k >= list.length) {
    // no sensor of its own this turn: up to the safe point above its last one, and wait there
    const last = list[list.length - 1];
    const w = waitWay(last);
    return onWays(side, [hoverWay(last), w], ease(u / parts.move), null);
  }
  const s = list[k];
  const from = k > 0 ? hoverWay(list[k - 1]) : zoneStart(side, zone);
  if (u < parts.move) return onWays(side, route(side, from, s), glide(u / parts.move), s.id);
  const h = hover(s);
  if (u < parts.move + parts.touch) {
    return at(side, s.rail, lerp3(h, s.p, ease((u - parts.move) / parts.touch)), s.axis, s.flip, 0, s.id);
  }
  if (u < parts.move + parts.touch + parts.polish) {
    const v = (u - parts.move - parts.touch) / parts.polish;
    return at(side, s.rail, s.p, s.axis, s.flip, 1, s.id, POLISH_TURN * Math.sin(2 * Math.PI * POLISH_STROKES * v));
  }
  return at(side, s.rail, lerp3(s.p, h, ease((u - parts.move - parts.touch - parts.polish) / parts.lift)), s.axis, s.flip, 0, s.id);
}

/** Out of the dock: unfold where it stands, then ride to the nose, tucked. */
export function armOut(side: Side, t: number): ArmState {
  const carry = carryAngles(side);
  if (t < 0.4) return state(side, DOCK_DY_M, lerpAngles(stowAngles(side), carry, ease(t / 0.4)));
  return state(side, DOCK_DY_M + (firstRail(side) - DOCK_DY_M) * ease((t - 0.4) / 0.6), carry);
}

/** Back to the dock: tuck from the last sensor, ride north, fold. */
export function armStow(side: Side, t: number): ArmState {
  const end = zoneEnd(side, 'rear');
  if (t < 0.2) {
    return onWays(side, toCarry(side, end, end.safe), glide(t / 0.2), null);
  }
  const carry = carryAngles(side);
  if (t < 0.76) return state(side, end.rail + (DOCK_DY_M - end.rail) * ease((t - 0.2) / 0.56), carry);
  return state(side, DOCK_DY_M, lerpAngles(carry, stowAngles(side), ease((t - 0.76) / 0.24)));
}

/**
 * From wherever it is when a seat ends early, to the tuck, where its carriage stands. At its dock or tucked, its
 * joints go straight there. Anywhere else the pad backs off the car the way it faces, to the safe shell, and takes the
 * same path home as from a sensor. A wrist that is turning over finishes back the plain way first.
 */
export function armTuck(from: ArmState, t: number): ArmState {
  const side = from.side;
  // at its dock (parked, or unfolding or folding there): it folds where it stands
  if (!from.esc && Math.abs(from.rail - DOCK_DY_M) < 1e-6) return state(side, from.rail, lerpAngles(from.q, stowAngles(side), ease(t)));
  if (!from.esc) return state(side, from.rail, lerpAngles(from.q, carryAngles(side), ease(t)));
  if (from.mid) {
    // above the track, only the wrist is off its place: back to the plain way (a third of the time), then down
    if (t < 0.34) return state(side, from.rail, lerpAngles(from.q, qOf(side, from.esc), ease(t / 0.34)), 0, null, from.esc, true);
    return onWays(side, [from.esc, carryWay(side, from.rail)], glide((t - 0.34) / 0.66), null);
  }
  const e = from.esc;
  const back = Math.max(0, DETAIL_ARM.safeM - Math.max(0, carGapM(e.p)));
  const st = onWays(side, toCarry(side, e, add(e.p, e.axis, -back)), glide(t), null);
  // the pad's own turn (the polish) runs out as it leaves
  const j6 = from.q.j6 * (1 - ease(t / 0.3));
  return j6 === 0 ? st : state(side, st.rail, { ...st.q, j6 }, 0, null, st.esc, st.mid);
}
/** Then home: ride to the dock, tucked, and fold. */
export function armReturn(from: ArmState, t: number): ArmState {
  const carry = carryAngles(from.side);
  if (t < 0.7) return state(from.side, from.rail + (DOCK_DY_M - from.rail) * ease(t / 0.7), lerpAngles(from.q, carry, ease(t / 0.2)));
  return state(from.side, DOCK_DY_M, lerpAngles(carry, stowAngles(from.side), ease((t - 0.7) / 0.3)));
}
