/**
 * OTTO-CHARGE ARM — phase -> pose.
 *
 * Turns a point in the connection cycle into joint angles. Shared by the .glb
 * animation baker, the standalone viewer, and the depot renderer, so all three
 * move identically.
 *
 * The important detail: INSERT and EXTRACT interpolate the CARTESIAN target
 * along the port's own axis and re-solve IK each step. They do NOT interpolate
 * joint angles. Blending joint angles between two poses traces an arc, and an
 * arc through a connector that is already inside an inlet is a bent pin. The
 * free-space moves (unstow / approach / retract) do blend joint angles, which
 * is both cheaper and how a real arm actually moves through open space.
 */

import { OTTO_CHARGE_ARM, type CobotSpec } from './cobotSpec';
import {
  solveIK, lerpAngles, ease, STOWED, type JointAngles, type Vec3,
} from './cobotIK';
import { type ArmPhase, type CyclePoint } from './armStateMachine';

/**
 * Standoff distance: where the arm waits before committing to the inlet.
 *
 * It was 0.45 m, and at the real car width that is no longer solvable. The
 * standoff point sits BETWEEN the base and the car, so backing further off the
 * inlet moves the wrist CLOSER to the shoulder, not further from it. With the
 * flank at 1.148 m instead of 1.347 m, a 0.45 m standoff put the required wrist
 * centre 0.24 m in front of the shoulder — inside the fold the two-link chain
 * can physically make, so solveIK returned joint_limit and poseFor REFUSED THE
 * WHOLE MATE. The arm would simply have stayed stowed at some ports.
 *
 * 0.30 m solves everywhere in the service window with the elbow clear, and is
 * still a real waypoint: 300 mm off the inlet is where a vision system would
 * hand over to the final alignment creep.
 */
export const STANDOFF_M = 0.30;
/** Final alignment distance: vision has the inlet, connector is lined up. */
export const ALIGN_M = 0.10;

/**
 * How much of RETRACT is the cartesian back-out from the inlet to the standoff,
 * before the arm stops tracking the port axis and simply folds home.
 *
 * Named because two things have to agree on it: the pose function below, and
 * releaseEntry(), which has to know which of retract's two segments a given
 * pose lives on. It was a bare 0.35 in one place; the moment a second caller
 * needed it, a literal became a latent inconsistency.
 */
export const RETRACT_FOLD_FRACTION = 0.35;

/** How far out of the cradle 'unstow' lifts, as a fraction of the way to the
 *  standoff pose. 'approach' covers the rest. */
export const UNSTOW_FRACTION = 0.35;

export interface ArmTarget {
  /** Charge-port mouth, in the ARM BASE frame, metres. */
  port: Vec3;
  /** Unit vector pointing OUT of the inlet, back toward the arm. */
  normal: Vec3;
}

export interface ArmPose {
  angles: JointAngles;
  /** 0 = unlatched, 1 = fully locked. Drives the latch collar. */
  latch: number;
  /** True when the connector is inside the inlet at all. */
  engaged: boolean;
  /** False when the target could not be solved — surface it, do not hide it. */
  ok: boolean;
}

function offsetAlongNormal(t: ArmTarget, d: number): Vec3 {
  return {
    x: t.port.x + t.normal.x * d,
    y: t.port.y + t.normal.y * d,
    z: t.port.z + t.normal.z * d,
  };
}

function solveAt(t: ArmTarget, d: number, spec: CobotSpec) {
  return solveIK(offsetAlongNormal(t, d), t.normal, spec);
}

/**
 * Where in the cycle the arm is, reduced to the only two facts a pose needs.
 *
 * Narrower than CyclePoint on purpose. A pose is a function of phase and
 * progress and NOTHING else — in particular not of `elapsed`, because a pose
 * that could depend on absolute time is a pose that can be different on two
 * frames with identical state. Both CyclePoint (the baker) and ArmSession (the
 * live renderer) satisfy this, which is how they are guaranteed to draw the same
 * arm from the same phase.
 */
export type PosePoint = Pick<CyclePoint, 'phase' | 't'>;

/**
 * Resolve the arm pose for a cycle point.
 *
 * @param cp     where we are in the cycle
 * @param target the charge port, in the arm's base frame
 */
export function poseFor(
  cp: PosePoint,
  target: ArmTarget,
  spec: CobotSpec = OTTO_CHARGE_ARM,
): ArmPose {
  const e = ease(cp.t);

  const standoff = solveAt(target, STANDOFF_M, spec);
  const align = solveAt(target, ALIGN_M, spec);
  const mated = solveAt(target, 0, spec);
  const ok = standoff.reachable && align.reachable && mated.reachable;

  // REFUSE, do not strain. If any waypoint of the mate is outside the envelope,
  // the arm stays folded and reports it. The alternative — driving the clamped
  // best-effort pose — stretches the arm out straight and sends it THROUGH the
  // vehicle body toward a point it cannot reach. That is worse than useless in
  // a demo: it shows a robot doing something no real one would attempt, and it
  // hides the very constraint the depot needs to plan around.
  if (!ok) {
    return { angles: STOWED, latch: 0, engaged: false, ok: false };
  }

  const cart = (d: number): JointAngles => solveAt(target, d, spec);

  switch (cp.phase) {
    case 'stowed':
      return { angles: STOWED, latch: 0, engaged: false, ok };

    case 'unstow': {
      // lift out of the cradle toward, but not all the way to, the standoff
      const partway = lerpAngles(STOWED, standoff, UNSTOW_FRACTION);
      return { angles: lerpAngles(STOWED, partway, e), latch: 0, engaged: false, ok };
    }

    case 'approach': {
      const partway = lerpAngles(STOWED, standoff, UNSTOW_FRACTION);
      return { angles: lerpAngles(partway, standoff, e), latch: 0, engaged: false, ok };
    }

    case 'align': {
      // Cartesian: creep in along the port axis under vision. Slow and straight.
      const d = STANDOFF_M + (ALIGN_M - STANDOFF_M) * e;
      return { angles: cart(d), latch: 0, engaged: false, ok };
    }

    case 'insert': {
      // Straight down the port axis. Linear in distance, eased in time.
      const d = ALIGN_M * (1 - e);
      return { angles: cart(d), latch: 0, engaged: d < ALIGN_M * 0.6, ok };
    }

    case 'latch':
      return { angles: mated, latch: e, engaged: true, ok };

    case 'charging':
      // Locked. The arm holds absolutely still — a connector under load does
      // not wander, and any idle "breathing" animation here would be a lie.
      return { angles: mated, latch: 1, engaged: true, ok };

    case 'unlatch':
      return { angles: mated, latch: 1 - e, engaged: true, ok };

    case 'extract': {
      // Straight back out along the axis. Never an arc.
      const d = ALIGN_M * e;
      return { angles: cart(d), latch: 0, engaged: d < ALIGN_M * 0.6, ok };
    }

    case 'retract': {
      // back to standoff, then fold home
      if (e < RETRACT_FOLD_FRACTION) {
        const k = e / RETRACT_FOLD_FRACTION;
        const d = ALIGN_M + (STANDOFF_M - ALIGN_M) * k;
        return { angles: cart(d), latch: 0, engaged: false, ok };
      }
      const k = (e - RETRACT_FOLD_FRACTION) / (1 - RETRACT_FOLD_FRACTION);
      return { angles: lerpAngles(standoff, STOWED, k), latch: 0, engaged: false, ok };
    }

    case 'clear':
      return { angles: STOWED, latch: 0, engaged: false, ok };

    case 'fault':
      // Hold wherever the fault was declared, backed off to the standoff.
      // A faulted arm does NOT tidy itself away; it stays put for the operator.
      return { angles: standoff, latch: 0, engaged: false, ok: false };

    default:
      return { angles: STOWED, latch: 0, engaged: false, ok };
  }
}

/** Convenience for callers that only have a phase and progress. */
export function poseForPhase(
  phase: ArmPhase, t: number, target: ArmTarget, spec: CobotSpec = OTTO_CHARGE_ARM,
): ArmPose {
  return poseFor({ phase, t }, target, spec);
}

// ═══════════════════════════════════════════════════════════════════════════
// WHERE A RELEASE JOINS THE CHAIN — geometry, not bookkeeping.
//
// An interrupted mate has to become a release. Entering the release phase at
// t=0 is the obvious choice and it is WRONG, because a release phase at t=0 is
// not a pose near the cradle — it is a pose near the INLET. 'retract' opens by
// backing the connector out from ALIGN_M, and 'extract' opens fully mated. So a
// mate aborted one frame after leaving the cradle was asking the arm to travel
// out to the car and only then fold home.
//
// MEASURED, before the fix: aborting 0.25 s into 'unstow' requested a 142°
// step on a single joint. The rate limiter turned that into a ~1 s sweep rather
// than a teleport, so it never read as a "snap" — it read as the arm LUNGING AT
// A CAR IT WAS SUPPOSED TO BE BACKING AWAY FROM. Bounded, and still wrong.
//
// The release chain retraces the mate chain, so the correct entry point always
// exists: it is the point on the release whose pose is the pose already held.
// Solving for it makes an abort continuous by CONSTRUCTION at any instant, and
// it falls out of the choreography rather than being tuned.
//
//   'latch'    at t → 'unlatch' at 1-t   (the collar unwinds from where it is)
//   'insert'   at t → 'extract' at 1-t   (same depth on the port axis)
//   'align'    at t → 'retract' inside its cartesian segment, same standoff
//   'unstow' /
//   'approach' at t → 'retract' inside its fold segment, same point on the
//                     STOWED↔standoff path
//
// The two exact reversals rely on smoothstep's symmetry, ease(1-x) = 1-ease(x),
// which is asserted in armSession.test.ts rather than assumed. The other two
// need the eased progress inverted, which smoothstep admits in closed form.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inverse of `ease` (smoothstep). Exact, via the trigonometric solution of
 * 3c² - 2c³ = x; the alternatives are a Newton loop or a lookup table, and this
 * runs once per abort rather than once per frame.
 */
export function easeInv(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 0.5 - Math.sin(Math.asin(1 - 2 * c) / 3);
}

/**
 * The point on the release chain that holds the pose `(phase, t)` holds now, or
 * null when the phase is not one a release can interrupt.
 *
 * Pure geometry — no timings, no policy about WHEN to release. The session
 * reducer decides that and asks this where to land.
 */
export function releaseEntry(phase: ArmPhase, t: number): { phase: ArmPhase; t: number } | null {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const F = RETRACT_FOLD_FRACTION;

  switch (phase) {
    // Mated, or locking: the collar is the only thing that has moved.
    case 'charging': return { phase: 'unlatch', t: 0 };
    case 'latch':    return { phase: 'unlatch', t: 1 - c };

    // Inside the inlet: come straight back out from exactly this depth.
    case 'insert':   return { phase: 'extract', t: 1 - c };

    // Creeping in along the port axis: rejoin retract's cartesian segment at
    // the same distance off the port.
    case 'align':    return { phase: 'retract', t: easeInv(F * ease(1 - c)) };

    // Still in free air on the STOWED↔standoff path. `u` is how far along it the
    // arm is; retract's fold segment walks that same path backwards.
    case 'unstow':
    case 'approach': {
      const u = phase === 'unstow'
        ? UNSTOW_FRACTION * ease(c)
        : UNSTOW_FRACTION + (1 - UNSTOW_FRACTION) * ease(c);
      return { phase: 'retract', t: easeInv(F + (1 - F) * (1 - u)) };
    }

    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMIT — the last line of defence against a teleport.
//
// advanceArmSession makes the PHASE continuous. This makes the POSE continuous,
// which is a separate promise and the one the founder can actually see. The two
// are not the same thing: the IK target itself can move under a held phase (a
// different car docks, a port resolves differently, a stall's placement flips),
// and a phase-continuous machine driving a jumped target still jumps.
//
// So the rendered joints are not set from the solved pose. They are DRIVEN
// TOWARD it at a bounded angular rate, the way a real servo is. If the source of
// truth changes abruptly the arm sweeps to the new pose over a few tenths of a
// second instead of appearing there. Nothing downstream can produce a
// discontinuity greater than MAX_JOINT_RATE * frame time — that is a property of
// the code, not a convention to remember.
//
// The cap is set ABOVE the fastest motion in the nominal cycle, deliberately: it
// must never slow down or distort the choreography it is protecting. Verified in
// armSession.test.ts, which sweeps the whole cycle and asserts the limiter is
// inert. At 60 fps it permits ~2.4° per joint per frame.
// ═══════════════════════════════════════════════════════════════════════════

/** Ceiling on rendered joint speed, radians per second of REAL time. */
export const MAX_JOINT_RATE = 2.5;
/** Ceiling on the latch collar, units (0..1) per second of REAL time. */
export const MAX_LATCH_RATE = 1.2;

/** Largest per-joint difference between two poses, radians. */
export function maxJointDelta(a: JointAngles, b: JointAngles): number {
  return Math.max(
    Math.abs(a.j1 - b.j1), Math.abs(a.j2 - b.j2), Math.abs(a.j3 - b.j3),
    Math.abs(a.j4 - b.j4), Math.abs(a.j5 - b.j5), Math.abs(a.j6 - b.j6),
  );
}

function toward(from: number, to: number, step: number): number {
  const d = to - from;
  if (Math.abs(d) <= step) return to;
  return from + Math.sign(d) * step;
}

/**
 * Move `from` toward `to`, no joint travelling faster than `rate`.
 *
 * A per-joint cap rather than a scaled interpolation of the whole vector: a
 * single joint being asked to slam is exactly the case worth bounding, and
 * scaling the vector would let five slow joints hide it.
 */
export function slewAngles(
  from: JointAngles, to: JointAngles, dt: number, rate: number = MAX_JOINT_RATE,
): JointAngles {
  const step = Math.max(0, (Number.isFinite(dt) ? dt : 0)) * rate;
  if (step <= 0) return { ...from };
  return {
    j1: toward(from.j1, to.j1, step), j2: toward(from.j2, to.j2, step),
    j3: toward(from.j3, to.j3, step), j4: toward(from.j4, to.j4, step),
    j5: toward(from.j5, to.j5, step), j6: toward(from.j6, to.j6, step),
  };
}

/** The same bound for a scalar — the latch collar, which is just as visible. */
export function slewScalar(
  from: number, to: number, dt: number, rate: number = MAX_LATCH_RATE,
): number {
  const step = Math.max(0, (Number.isFinite(dt) ? dt : 0)) * rate;
  if (step <= 0) return from;
  return toward(from, to, step);
}
