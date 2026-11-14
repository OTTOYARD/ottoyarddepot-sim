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
 *
 * ONE PROGRAM PER VEHICLE (2026-11-13). What is cleaned, through which door openings and in what order is a
 * CleanProgram: a list of VISITS, each one opening with its own strokes, aperture plane, entry height and ready
 * point. The phase chain is built from that list (cleanArmSpec.cleanChainFor), eight moves an opening. The yard's
 * generic car is GENERIC_PROGRAM (two visits, one a flank, the numbers below); each fleet vehicle's program is
 * made by rule from its cabin (cleanProgramFleet.ts). Every function here takes the program, and works to the
 * generic one when none is given.
 */

import {
  CLEAN_ARM, CLEAN_SWING_ALONG_S, FLANK_PAINT_Z, PIVOT_Y_MAX, cleanChainFor, phaseMove, phaseVisit,
  type CleanMove, type CleanPhase,
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

/** The generic car's ready point along the car: just ahead of J1, abeam its door. */
export const GENERIC_READY_X = CLEAN_ARM.mountX + 0.02;

/**
 * The ready point over a door opening: the wrist pivot at the working standoff (`pivotZ` from the centre line), `readyX`
 * along the car. The generic car's is abeam J1.
 */
export function readyPolar(side: 1 | -1, readyX: number = GENERIC_READY_X, pivotZ: number = CLEAN_ARM.pivotZ): { phi: number; r: number } {
  const x = readyX, z = side * pivotZ;
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

/** Where the wand works at one opening: its wrist's standoff and the plane it crosses, metres from the centre line. */
export interface CleanGeom { pivotZ: number; planeZ: number }
export const GENERIC_GEOM: CleanGeom = { pivotZ: CLEAN_ARM.pivotZ, planeZ: FLANK_PAINT_Z };

/**
 * The keyframe that puts the nozzle tip on `target`: solve the crossing point and the
 * extension from the angles. The tip is C + (L - dOut) u + nozzle n, with C on the
 * aperture plane; its lateral equation fixes (L - dOut), the other two fix C.
 */
export function strokeKeyFor(k: StrokeTarget, g: CleanGeom = GENERIC_GEOM): StrokeKey {
  const ps = deg(k.yaw), th = deg(k.pitch), tn = deg(k.pitch + k.nozzle);
  // side +1 (the right flank): inward is -z; the result is side-relative and mirrors exactly
  const u = { x: Math.sin(ps) * Math.cos(th), y: Math.sin(th), z: -Math.cos(ps) * Math.cos(th) };
  const n = { x: Math.sin(ps) * Math.cos(tn), y: Math.sin(tn), z: -Math.cos(ps) * Math.cos(tn) };
  const N = CLEAN_ARM.nozzle.len;
  const dOut = (g.pivotZ - g.planeZ) / (Math.cos(ps) * Math.cos(th));
  const inside = (k.tip.z - g.planeZ - N * n.z) / u.z; // L - dOut
  const L = inside + dOut;
  return {
    cx: k.tip.x - inside * u.x - N * n.x,
    cy: k.tip.y - inside * u.y - N * n.y,
    yaw: k.yaw, pitch: k.pitch, nozzle: k.nozzle,
    ext: L - CLEAN_ARM.wand.base,
    what: k.what, w: k.w,
  };
}

export const STROKES: readonly StrokeKey[] = STROKE_TARGETS.map((k) => strokeKeyFor(k));

/** A stroke keyframe on `side`, as joints. Throws if the wrist pivot is out of the SCARA's reach. */
export function strokeJoints(
  k: Pick<StrokeKey, 'cx' | 'cy' | 'yaw' | 'pitch' | 'ext' | 'nozzle'>, side: 1 | -1, g: CleanGeom = GENERIC_GEOM,
): CleanJoints {
  const ps = deg(k.yaw), th = deg(k.pitch);
  const u = { x: Math.sin(ps) * Math.cos(th), y: Math.sin(th), z: -side * Math.cos(ps) * Math.cos(th) };
  const dOut = (g.pivotZ - g.planeZ) / (Math.cos(ps) * Math.cos(th));
  const P = { x: k.cx - dOut * u.x, y: k.cy - dOut * u.y, z: side * g.planeZ - dOut * u.z };
  const ik = scaraIK(P.x, P.z);
  if (!ik) throw new Error('cleanArmPose: stroke pivot out of reach');
  return {
    t1: ik.t1, t2: ik.t2, foot: P.y + CLEAN_ARM.pivotBelowFoot,
    yaw: Math.atan2(u.z, u.x), pitch: th, ext: k.ext, nozzle: deg(k.nozzle),
  };
}

// ══════════════════════════════════════════════════════════════ THE PROGRAM ═══

/**
 * Where the nozzle crosses the aperture plane as the wand swings in from hanging (or out
 * to it), metres above grade, on the generic car: the middle of the door, well clear of the sill.
 */
export const SCOOP_Y = 0.76;

/** One door opening the arm works: where, and the strokes it makes there. Side-relative, so it serves either flank. */
export interface CleanVisit {
  /** 'far' is side A (the flank away from the charge port, cleaned first), 'port' side B. */
  flank: 'far' | 'port';
  /** The opening's name for the tests and the docs: 'door', 'front door', 'rear door'. */
  opening: string;
  /** Which of the flank's openings this is, front to rear (the vehicle's cabin profile). 0 on the generic car. */
  aperture: number;
  /** The plane the strokes are written at: the flank's distance from the centre line at this opening, metres. */
  planeZ: number;
  /** Where the wrist stands along the car before it comes down: the ready point over this opening. */
  readyX: number;
  /** The height the nozzle crosses the plane at as the wand swings in or out. */
  scoopY: number;
  /**
   * The wand's yaw as it swings in and out, degrees from straight in, + toward the nose. Absent: straight in. A
   * vehicle whose door leaf leaves the mast no place abeam the opening is entered at an angle, from beside the leaf.
   */
  turnYaw?: number;
  strokes: readonly StrokeKey[];
  /**
   * The swing to this opening first goes to the ready point at `swingVia` (metres along the car) on this opening's
   * flank, wand up, and from there along the flank. Given where the program's order makes the straight swing a path
   * of its own: with a via the arm keeps to the two paths every program has (across the roof to the flank's front
   * opening, then along the flank). Absent: one swing.
   */
  swingVia?: number;
  /**
   * The doors that are open for this visit, and no other door of its flank: door ids as the vehicle's cabin profile
   * names its leaves (the right flank's ids; the other flank's are their mirror). Absent: every door of the flank
   * (the generic car, and every far-flank visit: no charger stands on that flank).
   */
  doors?: readonly string[];
  /**
   * `doors` is PART of an opening: two sliding panels make it and only these open, the other stays shut and is the
   * body. `aperture` then counts the openings of the cabin with only these doors able to open
   * (fleetModels/cabin.cabinProfile(spec, doors)), and the strokes were made in that cabin.
   */
  partial?: true;
  /**
   * A PORT-flank visit: may its `doors` be open beside the OTTO-CHARGE ARM stowed at its home, and latched?
   * Measured for these doors only, over their whole travel (chargeArmBeside.measureOpeningBeside). Absent: the
   * program's `beside`, which is for the whole flank.
   */
  beside?: { stowed: boolean; latched: boolean };
}

/**
 * May a vehicle's PORT-flank doors stand open beside the OTTO-CHARGE ARM (which stands on that flank)? Measured per
 * vehicle by chargeArmBeside.ts: true only where the charge arm keeps 0.10 m from every open port-flank leaf.
 */
export interface ChargeBeside {
  /** with the charge arm stowed at its rail's middle, or at `parkX` when that is given */
  stowed: boolean;
  /** with the charge arm latched at this vehicle's own mate */
  latched: boolean;
  /**
   * Where the charge arm's base parks while this vehicle is in the stall, metres along the CAR from its middle
   * (+ nose), when the open leaf reaches the arm stowed at the rail's middle. Absent: the rail's middle.
   */
  parkX?: number;
}

/** The generic car's one door a flank keeps 0.10 m from the charge arm at every pose (cleanArmClearance.test.ts). */
export const GENERIC_BESIDE: ChargeBeside = { stowed: true, latched: true };

/** What the arm does for one kind of vehicle: the openings it visits, in order, and its wrist's standoff. */
export interface CleanProgram {
  /** 'generic', or the vehicle's fleet model key. */
  key: string;
  /** The wrist pivot's distance from the car's centre line in every working pose, metres. */
  pivotZ: number;
  visits: readonly CleanVisit[];
  /** The cycle, home to home: built from the visits (cleanChainFor). */
  chain: readonly CleanPhase[];
  /** Seconds each fixed phase takes at nominal speed. The clean phases take what the twin's step leaves. */
  seconds: Readonly<Partial<Record<CleanPhase, number>>>;
  /** What this program leaves uncleaned, and why, in plain words. Empty when it reaches everything. */
  notReached: readonly string[];
  /**
   * When this vehicle's port-flank doors, ALL of them, may be open beside the charge arm, and where the charge arm
   * parks. A port-flank visit that names its own doors carries its own rule (CleanVisit.beside), which is the one
   * cleanSession holds the arm to at that opening.
   */
  beside: ChargeBeside;
  /** Every door of one flank, front to rear, by id (the cabin profile's leaves). Given when a visit names its doors. */
  flankDoors?: readonly string[];
}

/** When the doors of visit `index` may be open beside the charge arm: the visit's own rule, else the program's. */
export function visitBeside(program: Pick<CleanProgram, 'visits' | 'beside'>, index: number): { stowed: boolean; latched: boolean } {
  return program.visits[index]?.beside ?? program.beside;
}

const MOVE_S: Readonly<Record<Exclude<CleanMove, 'swing' | 'clean'>, number>> = {
  lower: 1.5, descend: 3.5, enter: 3.5, exit: 3.5, ascend: 3, raise: 1.5,
};

/**
 * A program from its visits: the chain, and each fixed phase's seconds by one rule for every vehicle. The first
 * swing (from stowed) takes 4 s, a swing across the roof to the other flank 5 s, a swing along the same flank
 * CLEAN_SWING_ALONG_S; the rest are the generic cycle's (cleanArmSpec.CLEAN_PHASE_S, held equal by the tests).
 */
export function makeCleanProgram(
  key: string, pivotZ: number, visits: readonly CleanVisit[], notReached: readonly string[] = [], beside: ChargeBeside = GENERIC_BESIDE,
  flankDoors?: readonly string[],
): CleanProgram {
  const chain = visits.length ? cleanChainFor(visits.length) : [];
  const seconds: Partial<Record<CleanPhase, number>> = { doors_open: 3, return: 4, doors_close: 3 };
  for (const p of chain) {
    const m = phaseMove(p);
    if (m === null || m === 'clean') continue;
    const i = phaseVisit(p);
    seconds[p] = m === 'swing'
      ? (i === 0 ? 4 : visits[i - 1].flank === visits[i].flank ? CLEAN_SWING_ALONG_S : 5) + (visits[i].swingVia === undefined ? 0 : CLEAN_SWING_ALONG_S)
      : MOVE_S[m];
  }
  return flankDoors ? { key, pivotZ, visits, chain, seconds, notReached, beside, flankDoors } : { key, pivotZ, visits, chain, seconds, notReached, beside };
}

const GENERIC_VISIT = { opening: 'door', aperture: 0, planeZ: FLANK_PAINT_Z, readyX: GENERIC_READY_X, scoopY: SCOOP_Y, strokes: STROKES } as const;

/** The yard's one generic car: one opening a flank, the far flank first. Every number is the one this file always had. */
export const GENERIC_PROGRAM: CleanProgram = makeCleanProgram('generic', CLEAN_ARM.pivotZ, [
  { flank: 'far', ...GENERIC_VISIT }, { flank: 'port', ...GENERIC_VISIT },
]);

/** The stroke keyframes of one visit interpolated at progress t (0..1) through its clean, on `side`. */
export function strokeAt(
  t: number, side: 1 | -1, program: CleanProgram = GENERIC_PROGRAM, visit = 0,
): { joints: CleanJoints; what: string; index: number } {
  const S = program.visits[visit].strokes;
  const g: CleanGeom = { pivotZ: program.pivotZ, planeZ: program.visits[visit].planeZ };
  const target = clamp01(t) * S.reduce((a, k) => a + k.w, 0);
  let acc = 0;
  for (let i = 1; i < S.length; i++) {
    const w = S[i].w;
    if (target <= acc + w || i === S.length - 1) {
      const f = w > 0 ? ease((target - acc) / w) : 1;
      const a = S[i - 1], b = S[i];
      const k = {
        cx: lerp(a.cx, b.cx, f), cy: lerp(a.cy, b.cy, f), yaw: lerp(a.yaw, b.yaw, f),
        pitch: lerp(a.pitch, b.pitch, f), ext: lerp(a.ext, b.ext, f), nozzle: lerp(a.nozzle, b.nozzle, f),
      };
      return { joints: strokeJoints(k, side, g), what: b.what, index: i };
    }
    acc += w;
  }
  return { joints: strokeJoints(S[S.length - 1], side, g), what: S[S.length - 1].what, index: S.length - 1 };
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

/** What the swing in and out needs of a visit: its plane, the wrist's standoff and the crossing height. */
export interface ScoopGeom extends CleanGeom { scoopY: number; turnYaw?: number }
const GENERIC_SCOOP: ScoopGeom = { ...GENERIC_GEOM, scoopY: SCOOP_Y };

/**
 * The wand swings about the wrist pivot, so its nozzle crosses the aperture plane where its retracted length
 * reaches it: this far below the pivot.
 */
function scoopDrop(g: ScoopGeom): number {
  // at a yaw the plane is further along the wand: its standoff over the cosine (1 when it swings straight in)
  const out = (g.pivotZ - g.planeZ) / Math.cos(deg(g.turnYaw ?? 0));
  return Math.sqrt(Math.max(0, (CLEAN_ARM.wand.base + CLEAN_ARM.nozzle.len) ** 2 - out ** 2));
}
/** The pivot height at which the retracted wand swings through the aperture at the visit's crossing height. */
export function scoopPivotY(g: ScoopGeom = GENERIC_SCOOP): number {
  return g.scoopY + scoopDrop(g);
}
/** How much higher the wrist must be for the swing in (or out) than for stroke `q`. */
export function entryLift(q: CleanJoints, g: ScoopGeom = GENERIC_SCOOP): number {
  const pivotY = q.foot - CLEAN_ARM.pivotBelowFoot;
  return Math.max(0, g.scoopY + scoopDrop(g) - pivotY);
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
export interface CleanPoseContext {
  from?: CleanJoints | null;
  /** The program being played. Absent: the generic car's. */
  program?: CleanProgram;
}

/** The pivot's azimuth and radius about J1, for a set of joints. */
export function polarOf(q: CleanJoints): { phi: number; r: number } {
  const p = cleanArmPoints(q).pivot;
  return { phi: Math.atan2(p.z - J1.z, p.x - J1.x), r: Math.hypot(p.x - J1.x, p.z - J1.z) };
}

/** The generic car's swing-in pivot height. */
export const SCOOP_PIVOT_Y = scoopPivotY();

/**
 * THE WAY OUT, from any pose with the wand in the car, on `side`:
 *   0.00-0.25  telescope in along the wand's own axis (it can only slide out);
 *   0.25-0.45  turn to straight in (or the visit's own swing-in yaw) and 30 deg down, pivot still (the short wand left in
 *              the cabin is near the door, and the turn keeps its crossing in the door);
 *   0.45-0.65  rise until the pivot is high enough to swing the wand out mid-door;
 *   0.65-1.00  swing out to hanging (the longest part: a 60 deg swing of the wrist).
 */
function exitPose(from: CleanJoints, side: 1 | -1, t: number, g: ScoopGeom = GENERIC_SCOOP): CleanJoints {
  const ps = deg(g.turnYaw ?? 0);
  const straightIn = Math.atan2(-side * Math.cos(ps), Math.sin(ps));
  const DOWN = deg(-30);
  const riseFoot = Math.max(from.foot, scoopPivotY(g) + CLEAN_ARM.pivotBelowFoot);
  if (t < 0.25) {
    const k = ease(t / 0.25);
    return { ...from, ext: lerp(from.ext, 0, k), nozzle: lerp(from.nozzle, 0, k) };
  }
  const retracted = { ...from, ext: 0, nozzle: 0 };
  if (t < 0.45) {
    const k = ease((t - 0.25) / 0.2);
    return { ...retracted, yaw: lerpAngle(from.yaw, straightIn, k), pitch: lerp(from.pitch, DOWN, k) };
  }
  const turned = { ...retracted, yaw: straightIn, pitch: DOWN };
  if (t < 0.65) {
    const k = ease((t - 0.45) / 0.2);
    return { ...turned, foot: lerp(from.foot, riseFoot, k) };
  }
  const k = ease((t - 0.65) / 0.35);
  return { ...turned, foot: riseFoot, pitch: lerp(DOWN, HANG, k) };
}

/** Where exitPose ends: what ascend starts from when nothing else says. */
export function exitEnd(from: CleanJoints, side: 1 | -1, g: ScoopGeom = GENERIC_SCOOP): CleanJoints {
  return exitPose(from, side, 1, g);
}

/** The flank a visit works, for a stall's sides. */
export function visitSide(program: CleanProgram, visit: number, sides: CleanSides): 1 | -1 {
  return program.visits[visit]?.flank === 'port' ? sides.b : sides.a;
}

/** The flank the arm is at in `phase` (side A for home, the doors and the return). */
export function phaseSide(phase: CleanPhase, sides: CleanSides, program: CleanProgram = GENERIC_PROGRAM): 1 | -1 {
  const i = phaseVisit(phase);
  return i < 0 ? sides.a : visitSide(program, i, sides);
}

/** What the swing in and out needs, for one visit of a program. */
export function visitGeom(program: CleanProgram, visit: number): ScoopGeom {
  const v = program.visits[visit];
  return v.turnYaw === undefined
    ? { pivotZ: program.pivotZ, planeZ: v.planeZ, scoopY: v.scoopY }
    : { pivotZ: program.pivotZ, planeZ: v.planeZ, scoopY: v.scoopY, turnYaw: v.turnYaw };
}

/** The joints at `t` (0..1) through `phase`. 'home' is the stowed pose. */
export function cleanJointsAt(phase: CleanPhase, t: number, sides: CleanSides, ctx: CleanPoseContext = {}): CleanJoints {
  const program = ctx.program ?? GENERIC_PROGRAM;
  const hi = PIVOT_Y_MAX;
  const f = ease(t);
  const move = phaseMove(phase);
  const vi = phaseVisit(phase);
  const visit = vi >= 0 ? program.visits[vi] : undefined;
  const readyOf = (i: number) => readyPolar(visitSide(program, i, sides), program.visits[i].readyX, program.pivotZ);
  if (move === null || !visit) {
    if (phase === 'return') {
      return swing(ctx.from ? polarOf(ctx.from) : readyOf(program.visits.length - 1), STOW_POLAR, t, hi, 0);
    }
    // home, the doors, and any phase this program does not have: stowed
    return parkedJoints(STOW_POLAR.phi, STOW_POLAR.r, hi, 0);
  }
  const side = visitSide(program, vi, sides);
  const g = visitGeom(program, vi);
  const ready = readyOf(vi);
  const first = strokeJoints(visit.strokes[0], side, g);
  const last = strokeJoints(visit.strokes[visit.strokes.length - 1], side, g);
  switch (move) {
    case 'swing': {
      const from = vi === 0 ? STOW_POLAR : readyOf(vi - 1);
      if (visit.swingVia === undefined) return swing(from, ready, t, hi, 0);
      // two swings, each at its own share of the phase: to the via point, then along the flank
      const via = readyPolar(side, visit.swingVia, program.pivotZ);
      const total = program.seconds[phase] ?? 1;
      const cut = Math.min(0.95, Math.max(0.05, (total - CLEAN_SWING_ALONG_S) / total));
      return t < cut ? swing(from, via, t / cut, hi, 0) : swing(via, ready, (t - cut) / (1 - cut), hi, 0);
    }
    case 'lower':
      return parkedJoints(ready.phi, ready.r, hi, lerp(0, HANG, f));
    case 'raise':
      return parkedJoints(ready.phi, ready.r, hi, lerp(HANG, 0, f));
    case 'descend': {
      const from = parkedJoints(ready.phi, ready.r, hi, HANG);
      const to = { ...first, foot: first.foot + entryLift(first, g), pitch: HANG, ext: 0, nozzle: 0 };
      return lerpJoints(from, to, f);
    }
    case 'ascend': {
      const from = ctx.from ?? exitEnd(last, side, g);
      const to = parkedJoints(ready.phi, ready.r, hi, HANG);
      return lerpJoints(from, to, f);
    }
    case 'enter': {
      // Pitch up from hanging with the pivot raised (entryLift), so the nozzle swings
      // in through the middle of the aperture rather than over the sill; then lower
      // onto the first stroke while the wand telescopes in. Lowering with the wand in
      // only slides its crossing down the aperture.
      const lift = entryLift(first, g);
      const PITCH_SHARE = 0.5;
      if (t < PITCH_SHARE) {
        const k = ease(t / PITCH_SHARE);
        return { ...first, foot: first.foot + lift, pitch: lerp(HANG, first.pitch, k), ext: 0, nozzle: 0 };
      }
      const k = ease((t - PITCH_SHARE) / (1 - PITCH_SHARE));
      return { ...first, foot: first.foot + lift * (1 - k), ext: lerp(0, first.ext, k), nozzle: lerp(0, first.nozzle, k) };
    }
    case 'exit':
      return exitPose(ctx.from ?? last, side, t, g);
    case 'clean':
      return strokeAt(t, side, program, vi).joints;
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
