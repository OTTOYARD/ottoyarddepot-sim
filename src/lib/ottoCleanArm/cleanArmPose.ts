/**
 * Where every joint of the OTTO-CLEAN ARM is, at every point of its cycle.
 *
 * PURE: (phase, progress, which flank is which) in, joint values out. The session
 * reducer (cleanSession.ts) says which phase and how far through it; this file is the
 * choreography, and cleanArmClearance.test.ts samples all of it against the car, the
 * open doors and the OTTO-CHARGE ARM.
 *
 * FRAME: the authored car frame, metres (vehicleEnvelope.ts): x along (+ nose), y up,
 * z across (+ = the right flank). Yaw angles are atan2(dz, dx): 0 points at the nose,
 * +PI/2 at the right flank. `side` s = +1 is the right flank, -1 the left.
 *
 * THREE KINDS OF POSE, and the interpolation each one needs:
 *
 *   PARKED poses (stowed, ready over a flank, hanging): the wrist pivot is placed by
 *   its azimuth and radius about J1, and the wand points back at J1, horizontal or
 *   hanging. Moves between them interpolate the azimuth, so the arm swings round J1
 *   over the car's FRONT half, in a plane 1.8 m above the roof, with the wand over
 *   the roof — never over a flank it is not working on, and never near the charge arm.
 *
 *   STROKES inside the cabin: written as the point where the wand crosses the
 *   aperture plane, the wand's yaw and pitch, its extension and the nozzle's pitch.
 *   Interpolating THAT keeps the crossing on a straight line between two points
 *   inside the aperture, which is convex, so the wand cannot leave the door opening
 *   between two keyframes that are both inside it.
 *
 *   ENTRY and EXIT: the wrist pivot fixed outside the door, the wand pitching between
 *   hanging and its first (or last) stroke, and telescoping in or out along its own
 *   axis — the only way the wand ever goes into the car or comes out of it.
 */

import {
  CLEAN_ARM, FLANK_PAINT_Z, PIVOT_Y_MAX, type CleanPhase,
} from './cleanArmSpec';

export interface Vec3 { x: number; y: number; z: number }

export interface CleanJoints {
  /** J1 shoulder yaw, radians. */
  t1: number;
  /** J2 elbow yaw relative to link 1, radians. Positive in every pose this file makes. */
  t2: number;
  /** Mast foot height above grade, metres. */
  foot: number;
  /** The wand's absolute yaw in the car frame, radians. J3 = yaw - (t1 + t2). */
  yaw: number;
  /** Wrist pitch, radians: 0 level, -PI/2 hanging straight down. */
  pitch: number;
  /** Wand extension past its base, metres (0 .. CLEAN_ARM.wand.maxExt). */
  ext: number;
  /** Nozzle pitch relative to the wand, radians. */
  nozzle: number;
}

const deg = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** Smooth start and stop: a robot accelerates and decelerates, it does not jerk. */
export const ease = (t: number) => { const u = clamp01(t); return u * u * (3 - 2 * u); };

const J1 = { x: CLEAN_ARM.mountX, z: 0 };
const L1 = CLEAN_ARM.link1.len, L2 = CLEAN_ARM.link2.len;

/**
 * SCARA inverse kinematics: the joint pair that puts link 2's tip (the mast axis) at
 * (x, z), with the elbow on the positive side. Null when the point is out of reach.
 */
export function scaraIK(x: number, z: number): { t1: number; t2: number } | null {
  const dx = x - J1.x, dz = z - J1.z;
  const d2 = dx * dx + dz * dz;
  const c = (d2 - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  if (c > 1 + 1e-9 || c < -1 - 1e-9) return null;
  const t2 = Math.acos(Math.max(-1, Math.min(1, c)));
  const beta = Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
  return { t1: Math.atan2(dz, dx) - beta, t2 };
}

/** Every point the drawing and the clearance tests need, for one set of joints. */
export interface CleanArmPoints {
  j1: Vec3;
  elbow: Vec3;
  /** link 2's tip, on its centre line: the top of the mast axis */
  mastTop: Vec3;
  foot: Vec3;
  pivot: Vec3;
  /** the wand's unit direction and the nozzle's */
  u: Vec3;
  n: Vec3;
  /** the end of the wand (the nozzle knuckle) and the nozzle's tip */
  knuckle: Vec3;
  tip: Vec3;
}

export function cleanArmPoints(q: CleanJoints): CleanArmPoints {
  const y1 = CLEAN_ARM.link1Y, y2 = y1 - CLEAN_ARM.link2Drop;
  const a1 = q.t1, a2 = q.t1 + q.t2;
  const elbow = { x: J1.x + L1 * Math.cos(a1), y: y1, z: J1.z + L1 * Math.sin(a1) };
  const mastTop = { x: elbow.x + L2 * Math.cos(a2), y: y2, z: elbow.z + L2 * Math.sin(a2) };
  const foot = { x: mastTop.x, y: q.foot, z: mastTop.z };
  const pivot = { x: mastTop.x, y: q.foot - CLEAN_ARM.pivotBelowFoot, z: mastTop.z };
  const cp = Math.cos(q.pitch), sp = Math.sin(q.pitch);
  const u = { x: cp * Math.cos(q.yaw), y: sp, z: cp * Math.sin(q.yaw) };
  const pn = q.pitch + q.nozzle;
  const n = { x: Math.cos(pn) * Math.cos(q.yaw), y: Math.sin(pn), z: Math.cos(pn) * Math.sin(q.yaw) };
  const len = CLEAN_ARM.wand.base + q.ext;
  const knuckle = { x: pivot.x + len * u.x, y: pivot.y + len * u.y, z: pivot.z + len * u.z };
  const tip = {
    x: knuckle.x + CLEAN_ARM.nozzle.len * n.x,
    y: knuckle.y + CLEAN_ARM.nozzle.len * n.y,
    z: knuckle.z + CLEAN_ARM.nozzle.len * n.z,
  };
  return { j1: { x: J1.x, y: y1, z: J1.z }, elbow, mastTop, foot, pivot, u, n, knuckle, tip };
}

// ══════════════════════════════════════════════════════════════ PARKED POSES ═══

/**
 * A pose with the wrist pivot at azimuth `phi` and radius `r` about J1 and the wand
 * pointing straight OUT from J1 (yaw = phi), level (pitch 0) or hanging (-PI/2).
 *
 * Out, not back at J1: over a flank, a wand pointing in toward the car swings its
 * nozzle within 2 cm of the roof edge as it pitches down to hang (measured, in the
 * first cut of this file). Pointing out, it pitches down entirely outside the car.
 */
export function parkedJoints(phi: number, r: number, pivotY: number, pitch: number): CleanJoints {
  const x = J1.x + r * Math.cos(phi), z = J1.z + r * Math.sin(phi);
  const ik = scaraIK(x, z);
  if (!ik) throw new Error(`cleanArmPose: parked pose out of reach (r=${r})`);
  return {
    t1: ik.t1, t2: ik.t2, foot: pivotY + CLEAN_ARM.pivotBelowFoot,
    yaw: phi, pitch, ext: 0, nozzle: 0,
  };
}

/** The ready point over a flank: the wrist pivot at the working standoff, abeam J1. */
export function readyPolar(side: 1 | -1): { phi: number; r: number } {
  const x = CLEAN_ARM.mountX + 0.02, z = side * CLEAN_ARM.pivotZ;
  return { phi: Math.atan2(z - J1.z, x - J1.x), r: Math.hypot(x - J1.x, z - J1.z) };
}

/** Folded over the roof's centre line, ahead of J1: link 2 folded back under link 1. */
export const STOW_POLAR = { phi: 0, r: 0.475 } as const;

// ════════════════════════════════════════════════════════════════ STROKES ═══

/** One keyframe of a stroke inside the cabin, written relative to the flank it works. */
export interface StrokeKey {
  /** where the wand crosses the aperture plane: along the car, and height (metres) */
  cx: number; cy: number;
  /** wand yaw from straight in, degrees: + toward the nose */
  yaw: number;
  /** wand pitch, degrees: - down */
  pitch: number;
  /** wand extension, metres */
  ext: number;
  /** nozzle pitch relative to the wand, degrees */
  nozzle: number;
  /** what this stretch cleans (for the HUD and the tests' messages) */
  what: string;
  /** relative time spent moving INTO this keyframe from the one before */
  w: number;
}

/**
 * A keyframe as AUTHORED: where the nozzle's tip should be and how the wand and nozzle
 * are angled to put it there. The crossing point and the extension follow (strokeKeyFor).
 * Writing the work this way is writing what gets cleaned; the arm's joints are derived.
 */
export interface StrokeTarget {
  /** the nozzle tip: along the car, height, and distance from the car's centre line (metres) */
  tip: { x: number; y: number; z: number };
  yaw: number; pitch: number; nozzle: number;
  what: string; w: number;
}

/**
 * THE CLEAN, one flank. An air pass under the headliner first (dust down before the
 * vacuum), the rear bench's cushion and back, the front bench's cushion and back,
 * then the floor, deep and by the door, finishing toward the way out. Between them
 * the wand comes back toward the door before it turns, so nothing long sweeps across
 * the cabin. The tips sit 4-6 cm off what they clean: the nozzle's mouth, not its body.
 * cleanArmClearance.test.ts holds every stretch inside the aperture and the cabin.
 */
export const STROKE_TARGETS: readonly StrokeTarget[] = [
  // in low by the door (the swing-in ends here), up to the air pass
  { tip: { x: 0.36, y: 0.62, z: 0.52 }, yaw: 0, pitch: -30, nozzle: -30, what: 'floor by the door', w: 0 },
  { tip: { x: 0.42, y: 1.12, z: 0.22 }, yaw: 6, pitch: 0, nozzle: 20, what: 'air pass', w: 1.6 },
  { tip: { x: -0.34, y: 1.12, z: 0.22 }, yaw: -16, pitch: 0, nozzle: 20, what: 'air pass', w: 2.6 },
  // the rear bench: the wand comes back toward the door, then swings in behind it
  { tip: { x: -0.30, y: 0.95, z: 0.55 }, yaw: -45, pitch: -6, nozzle: -30, what: 'turn', w: 1 },
  { tip: { x: -0.60, y: 0.76, z: 0.60 }, yaw: -60, pitch: -12, nozzle: -62, what: 'rear bench, cushion', w: 1 },
  { tip: { x: -0.74, y: 0.76, z: 0.52 }, yaw: -62, pitch: -12, nozzle: -62, what: 'rear bench, cushion', w: 2 },
  { tip: { x: -0.62, y: 0.76, z: 0.42 }, yaw: -56, pitch: -12, nozzle: -62, what: 'rear bench, cushion', w: 1 },
  { tip: { x: -0.76, y: 0.84, z: 0.50 }, yaw: -60, pitch: 0, nozzle: 0, what: 'rear bench, back', w: 1 },
  { tip: { x: -0.76, y: 1.06, z: 0.50 }, yaw: -60, pitch: 0, nozzle: 8, what: 'rear bench, back', w: 1.5 },
  // across to the front bench, close to the door
  { tip: { x: 0.25, y: 1.02, z: 0.52 }, yaw: 0, pitch: 0, nozzle: 0, what: 'turn', w: 1.6 },
  { tip: { x: 0.62, y: 0.76, z: 0.56 }, yaw: 22, pitch: -16, nozzle: -60, what: 'front bench, cushion', w: 1 },
  { tip: { x: 0.74, y: 0.76, z: 0.36 }, yaw: 32, pitch: -16, nozzle: -60, what: 'front bench, cushion', w: 2 },
  { tip: { x: 0.74, y: 0.84, z: 0.48 }, yaw: 38, pitch: 0, nozzle: 0, what: 'front bench, back', w: 1 },
  { tip: { x: 0.74, y: 1.06, z: 0.48 }, yaw: 38, pitch: 0, nozzle: 8, what: 'front bench, back', w: 1.5 },
  // the floor last: back toward the door at mid height, then down
  { tip: { x: 0.45, y: 0.95, z: 0.55 }, yaw: 10, pitch: -10, nozzle: -20, what: 'turn', w: 0.8 },
  { tip: { x: 0.40, y: 0.62, z: 0.50 }, yaw: 0, pitch: -22, nozzle: -40, what: 'turn', w: 0.8 },
  { tip: { x: 0.45, y: 0.53, z: 0.10 }, yaw: 14, pitch: -22, nozzle: -58, what: 'floor, deep', w: 1 },
  { tip: { x: -0.42, y: 0.53, z: 0.10 }, yaw: -20, pitch: -22, nozzle: -58, what: 'floor, deep', w: 3 },
  { tip: { x: -0.40, y: 0.53, z: 0.48 }, yaw: -34, pitch: -30, nozzle: -45, what: 'floor by the door', w: 1 },
  { tip: { x: 0.40, y: 0.53, z: 0.48 }, yaw: 0, pitch: -30, nozzle: -45, what: 'floor by the door', w: 3 },
];

/**
 * The keyframe that puts the nozzle tip on `target`: solve the crossing point and the
 * extension from the angles. The tip is C + (L - dOut) u + nozzle n, with C on the
 * aperture plane; its lateral equation fixes (L - dOut), the other two fix C.
 */
export function strokeKeyFor(k: StrokeTarget): StrokeKey {
  const ps = deg(k.yaw), th = deg(k.pitch), tn = deg(k.pitch + k.nozzle);
  // side +1 (the right flank): inward is -z; the result is side-relative and mirrors exactly
  const u = { x: Math.sin(ps) * Math.cos(th), y: Math.sin(th), z: -Math.cos(ps) * Math.cos(th) };
  const n = { x: Math.sin(ps) * Math.cos(tn), y: Math.sin(tn), z: -Math.cos(ps) * Math.cos(tn) };
  const N = CLEAN_ARM.nozzle.len;
  const dOut = (CLEAN_ARM.pivotZ - FLANK_PAINT_Z) / (Math.cos(ps) * Math.cos(th));
  const inside = (k.tip.z - FLANK_PAINT_Z - N * n.z) / u.z; // L - dOut
  const L = inside + dOut;
  return {
    cx: k.tip.x - inside * u.x - N * n.x,
    cy: k.tip.y - inside * u.y - N * n.y,
    yaw: k.yaw, pitch: k.pitch, nozzle: k.nozzle,
    ext: L - CLEAN_ARM.wand.base,
    what: k.what, w: k.w,
  };
}

export const STROKES: readonly StrokeKey[] = STROKE_TARGETS.map(strokeKeyFor);

const STROKE_W = STROKES.reduce((a, k) => a + k.w, 0);

/** A stroke keyframe on `side`, as joints. Throws if the wrist pivot is out of the SCARA's reach. */
export function strokeJoints(k: Pick<StrokeKey, 'cx' | 'cy' | 'yaw' | 'pitch' | 'ext' | 'nozzle'>, side: 1 | -1): CleanJoints {
  const ps = deg(k.yaw), th = deg(k.pitch);
  const u = { x: Math.sin(ps) * Math.cos(th), y: Math.sin(th), z: -side * Math.cos(ps) * Math.cos(th) };
  const dOut = (CLEAN_ARM.pivotZ - FLANK_PAINT_Z) / (Math.cos(ps) * Math.cos(th));
  const P = { x: k.cx - dOut * u.x, y: k.cy - dOut * u.y, z: side * FLANK_PAINT_Z - dOut * u.z };
  const ik = scaraIK(P.x, P.z);
  if (!ik) throw new Error('cleanArmPose: stroke pivot out of reach');
  return {
    t1: ik.t1, t2: ik.t2, foot: P.y + CLEAN_ARM.pivotBelowFoot,
    yaw: Math.atan2(u.z, u.x), pitch: th, ext: k.ext, nozzle: deg(k.nozzle),
  };
}

/** The stroke keyframes interpolated at progress t (0..1) through the clean, on `side`. */
export function strokeAt(t: number, side: 1 | -1): { joints: CleanJoints; what: string; index: number } {
  const target = clamp01(t) * STROKE_W;
  let acc = 0;
  for (let i = 1; i < STROKES.length; i++) {
    const w = STROKES[i].w;
    if (target <= acc + w || i === STROKES.length - 1) {
      const f = w > 0 ? ease((target - acc) / w) : 1;
      const a = STROKES[i - 1], b = STROKES[i];
      const k = {
        cx: lerp(a.cx, b.cx, f), cy: lerp(a.cy, b.cy, f), yaw: lerp(a.yaw, b.yaw, f),
        pitch: lerp(a.pitch, b.pitch, f), ext: lerp(a.ext, b.ext, f), nozzle: lerp(a.nozzle, b.nozzle, f),
      };
      return { joints: strokeJoints(k, side), what: b.what, index: i };
    }
    acc += w;
  }
  return { joints: strokeJoints(STROKES[STROKES.length - 1], side), what: STROKES[STROKES.length - 1].what, index: STROKES.length - 1 };
}

// ═══════════════════════════════════════════════════════════════ THE CYCLE ═══

/** Which flank is which on this stall. Side A (cleaned first) is the far flank; B the port flank. */
export interface CleanSides { a: 1 | -1; b: 1 | -1 }

/** The sides for a stall whose charge port is on authored z = toward * half-width (vehicleEnvelope). */
export function sidesFor(toward: 1 | -1): CleanSides {
  return { a: (-toward) as 1 | -1, b: toward };
}

/** Shortest-turn interpolation between two angles. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/** Interpolate two joint sets. Angles take the short way round, which every move here is. */
export function lerpJoints(a: CleanJoints, b: CleanJoints, t: number): CleanJoints {
  return {
    t1: lerpAngle(a.t1, b.t1, t), t2: lerp(a.t2, b.t2, t), foot: lerp(a.foot, b.foot, t),
    yaw: lerpAngle(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t), ext: lerp(a.ext, b.ext, t),
    nozzle: lerp(a.nozzle, b.nozzle, t),
  };
}

/** A swing about J1 between two parked poses: the azimuth and radius move together. */
function swing(
  from: { phi: number; r: number }, to: { phi: number; r: number }, t: number, pivotY: number, pitch: number,
): CleanJoints {
  const f = ease(t);
  return parkedJoints(lerp(from.phi, to.phi, f), lerp(from.r, to.r, f), pivotY, pitch);
}

const HANG = -Math.PI / 2;

/**
 * Where the nozzle crosses the aperture plane as the wand swings in from hanging (or out
 * to it), metres above grade: the middle of the door, well clear of the sill. The wand
 * swings about the wrist pivot, so it crosses the plane where its retracted length
 * reaches it: SCOOP_DROP below the pivot.
 */
export const SCOOP_Y = 0.76;
const SCOOP_DROP = Math.sqrt(Math.max(0, (CLEAN_ARM.wand.base + CLEAN_ARM.nozzle.len) ** 2 - (CLEAN_ARM.pivotZ - FLANK_PAINT_Z) ** 2));
/** How much higher the wrist must be for the swing in (or out) than for stroke `q`. */
export function entryLift(q: CleanJoints): number {
  const pivotY = q.foot - CLEAN_ARM.pivotBelowFoot;
  return Math.max(0, SCOOP_Y + SCOOP_DROP - pivotY);
}

/**
 * What a phase that starts from WHEREVER THE ARM IS needs to know: the joints at the
 * moment it began. Three phases are like that, because the way home must work from any
 * point of the cycle, not only from the end of a clean:
 *   exit    — from any pose with the wand in the car (a clean cut short, an enter cut short);
 *   ascend  — from any hanging pose beside the car;
 *   return  — from any level pose over the car (a swing cut short, or the ready pose).
 * Without a `from` they start from the nominal pose (the last stroke, the ready pose).
 */
export interface CleanPoseContext { from?: CleanJoints | null }

/** The pivot's azimuth and radius about J1, for a set of joints. */
export function polarOf(q: CleanJoints): { phi: number; r: number } {
  const p = cleanArmPoints(q).pivot;
  return { phi: Math.atan2(p.z - J1.z, p.x - J1.x), r: Math.hypot(p.x - J1.x, p.z - J1.z) };
}

/** The pivot height at which the retracted wand swings through the aperture's middle. */
export const SCOOP_PIVOT_Y = SCOOP_Y + SCOOP_DROP;

/**
 * THE WAY OUT, from any pose with the wand in the car, on `side`:
 *   0.00-0.25  telescope in along the wand's own axis (it can only slide out);
 *   0.25-0.45  turn to straight in and 30 deg down, pivot still (the short wand left in
 *              the cabin is near the door, and the turn keeps its crossing in the door);
 *   0.45-0.65  rise until the pivot is high enough to swing the wand out mid-door;
 *   0.65-1.00  swing out to hanging (the longest part: a 60 deg swing of the wrist).
 */
function exitPose(from: CleanJoints, side: 1 | -1, t: number): CleanJoints {
  const straightIn = Math.atan2(-side, 0);
  const DOWN = deg(-30);
  const riseFoot = Math.max(from.foot, SCOOP_PIVOT_Y + CLEAN_ARM.pivotBelowFoot);
  if (t < 0.25) {
    const g = ease(t / 0.25);
    return { ...from, ext: lerp(from.ext, 0, g), nozzle: lerp(from.nozzle, 0, g) };
  }
  const retracted = { ...from, ext: 0, nozzle: 0 };
  if (t < 0.45) {
    const g = ease((t - 0.25) / 0.2);
    return { ...retracted, yaw: lerpAngle(from.yaw, straightIn, g), pitch: lerp(from.pitch, DOWN, g) };
  }
  const turned = { ...retracted, yaw: straightIn, pitch: DOWN };
  if (t < 0.65) {
    const g = ease((t - 0.45) / 0.2);
    return { ...turned, foot: lerp(from.foot, riseFoot, g) };
  }
  const g = ease((t - 0.65) / 0.35);
  return { ...turned, foot: riseFoot, pitch: lerp(DOWN, HANG, g) };
}

/** Where exitPose ends: what ascend starts from when nothing else says. */
export function exitEnd(from: CleanJoints, side: 1 | -1): CleanJoints {
  return exitPose(from, side, 1);
}

/** The joints at `t` (0..1) through `phase`. 'home' is the stowed pose. */
export function cleanJointsAt(phase: CleanPhase, t: number, sides: CleanSides, ctx: CleanPoseContext = {}): CleanJoints {
  const hi = PIVOT_Y_MAX;
  const f = ease(t);
  const side = phase.endsWith('_b') ? sides.b : sides.a;
  const ready = readyPolar(side);
  const first = strokeJoints(STROKES[0], side);
  const last = strokeJoints(STROKES[STROKES.length - 1], side);
  switch (phase) {
    case 'home':
    case 'doors_open':
    case 'doors_close':
      return parkedJoints(STOW_POLAR.phi, STOW_POLAR.r, hi, 0);
    case 'swing_a':
      return swing(STOW_POLAR, readyPolar(sides.a), t, hi, 0);
    case 'swing_b':
      return swing(readyPolar(sides.a), readyPolar(sides.b), t, hi, 0);
    case 'return':
      return swing(ctx.from ? polarOf(ctx.from) : readyPolar(sides.b), STOW_POLAR, t, hi, 0);
    case 'lower_a': case 'lower_b':
      return parkedJoints(ready.phi, ready.r, hi, lerp(0, HANG, f));
    case 'raise_a': case 'raise_b':
      return parkedJoints(ready.phi, ready.r, hi, lerp(HANG, 0, f));
    case 'descend_a': case 'descend_b': {
      const from = parkedJoints(ready.phi, ready.r, hi, HANG);
      const to = { ...first, foot: first.foot + entryLift(first), pitch: HANG, ext: 0, nozzle: 0 };
      return lerpJoints(from, to, f);
    }
    case 'ascend_a': case 'ascend_b': {
      const from = ctx.from ?? exitEnd(last, side);
      const to = parkedJoints(ready.phi, ready.r, hi, HANG);
      return lerpJoints(from, to, f);
    }
    case 'enter_a': case 'enter_b': {
      // Pitch up from hanging with the pivot raised (entryLift), so the nozzle swings
      // in through the middle of the aperture rather than over the sill; then lower
      // onto the first stroke while the wand telescopes in. Lowering with the wand in
      // only slides its crossing down the aperture.
      const lift = entryLift(first);
      const PITCH_SHARE = 0.5;
      if (t < PITCH_SHARE) {
        const g = ease(t / PITCH_SHARE);
        return { ...first, foot: first.foot + lift, pitch: lerp(HANG, first.pitch, g), ext: 0, nozzle: 0 };
      }
      const g = ease((t - PITCH_SHARE) / (1 - PITCH_SHARE));
      return { ...first, foot: first.foot + lift * (1 - g), ext: lerp(0, first.ext, g), nozzle: lerp(0, first.nozzle, g) };
    }
    case 'exit_a': case 'exit_b':
      return exitPose(ctx.from ?? last, side, t);
    case 'clean_a': case 'clean_b':
      return strokeAt(t, side).joints;
  }
}

/**
 * How far each door stands open at `t` through `phase`, 0..1, per flank. Both doors
 * open before the arm moves and shut after it is home; between, both stand open.
 */
export function doorsAt(phase: CleanPhase, t: number): number {
  if (phase === 'home') return 0;
  if (phase === 'doors_open') return ease(t);
  if (phase === 'doors_close') return 1 - ease(t);
  return 1;
}
