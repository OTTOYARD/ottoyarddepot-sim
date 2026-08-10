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

/** Standoff distance: where the arm waits before committing to the inlet. */
export const STANDOFF_M = 0.45;
/** Final alignment distance: vision has the inlet, connector is lined up. */
export const ALIGN_M = 0.10;

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
 * Resolve the arm pose for a cycle point.
 *
 * @param cp     where we are in the cycle
 * @param target the charge port, in the arm's base frame
 */
export function poseFor(
  cp: CyclePoint,
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
      const partway = lerpAngles(STOWED, standoff, 0.35);
      return { angles: lerpAngles(STOWED, partway, e), latch: 0, engaged: false, ok };
    }

    case 'approach': {
      const partway = lerpAngles(STOWED, standoff, 0.35);
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
      if (e < 0.35) {
        const k = e / 0.35;
        const d = ALIGN_M + (STANDOFF_M - ALIGN_M) * k;
        return { angles: cart(d), latch: 0, engaged: false, ok };
      }
      const k = (e - 0.35) / 0.65;
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
  return poseFor({ phase, t, elapsed: 0 }, target, spec);
}
