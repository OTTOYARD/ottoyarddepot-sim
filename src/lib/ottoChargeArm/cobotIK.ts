/**
 * OTTO-CHARGE ARM — analytic inverse kinematics.
 *
 * A real closed-form solve, not a cosmetic pose. Given a charge-port position
 * and the port's outward normal, it returns six joint angles that put the
 * connector tip ON the port and entering ALONG the port axis — or reports the
 * target as unreachable, which is itself load-bearing: an unreachable port is
 * exactly the case where a depot must not promise a robotic charge.
 *
 * ARCHITECTURE: 6R with a SPHERICAL WRIST (axes 4/5/6 intersect at one point).
 * That decouples the problem the way every industrial arm does:
 *
 *     position  -> J1 (base yaw) + J2/J3 (planar two-link) place the wrist centre
 *     orientation -> J4 (roll) + J5 (pitch) + J6 (roll) aim the tool
 *
 * The decoupling matters. An earlier arrangement used three PARALLEL pitch
 * joints and a pure-roll wrist; with that geometry the tool axis is trapped in
 * the arm's yaw plane, so the connector can only enter perpendicular to a flank
 * when the port is exactly abeam the base. Verification caught it. The
 * spherical wrist removes the restriction entirely.
 *
 * FRAME: the ARM BASE frame (the root group), +Y up, +Z forward.
 * UNITS: metres.
 */

import { OTTO_CHARGE_ARM, type CobotSpec } from './cobotSpec';

export interface Vec3 { x: number; y: number; z: number }

export interface IKSolution {
  j1: number; j2: number; j3: number; j4: number; j5: number; j6: number;
  /** False when the target is outside the reachable shell or violates a limit. */
  reachable: boolean;
  /** Distance from the shoulder axis to the required wrist centre, metres. */
  wristDistance: number;
  /** Residual tip error after clamping, metres. 0 when reachable. */
  residual: number;
  reason?: 'too_far' | 'too_close' | 'joint_limit';
}

export interface JointAngles { j1: number; j2: number; j3: number; j4: number; j5: number; j6: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function norm(v: Vec3): Vec3 {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/** Distance from the wrist centre (axes 4/5/6 intersection) to the connector tip. */
export function toolLength(spec: CobotSpec = OTTO_CHARGE_ARM): number {
  return spec.wrist + spec.tool;
}

/**
 * Solve for a connector tip at `port`, entering along `-portNormal`.
 *
 * @param port        inlet mouth position, arm base frame, metres
 * @param portNormal  unit vector pointing OUT of the inlet (back toward the arm)
 * @param elbowUp     carry the elbow above the shoulder-wrist chord (keeps it
 *                    clear of the vehicle); this is what you want at a depot
 */
export function solveIK(
  port: Vec3,
  portNormal: Vec3,
  spec: CobotSpec = OTTO_CHARGE_ARM,
  elbowUp = true,
): IKSolution {
  const n = norm(portNormal);
  const tl = toolLength(spec);

  // ---- wrist centre: back off the port along its own normal -----------------
  const wc: Vec3 = { x: port.x + n.x * tl, y: port.y + n.y * tl, z: port.z + n.z * tl };

  // ---- J1: yaw the arm plane onto the wrist centre --------------------------
  const j1 = Math.atan2(wc.x, wc.z);

  // ---- J2/J3: planar two-link to the wrist centre ---------------------------
  const fwd = Math.hypot(wc.x, wc.z);
  const up = wc.y - spec.shoulderHeight;
  const r = Math.hypot(fwd, up);

  const L2 = spec.upperArm;
  const L3 = spec.forearm;
  const rMax = L2 + L3;
  const rMin = Math.abs(L2 - L3);

  let reachable = true;
  let reason: IKSolution['reason'];
  let rC = r;
  if (r > rMax) { reachable = false; reason = 'too_far'; rC = rMax * 0.999999; }
  else if (r < rMin) { reachable = false; reason = 'too_close'; rC = rMin * 1.000001; }

  const cosQ3 = clamp((rC * rC - L2 * L2 - L3 * L3) / (2 * L2 * L3), -1, 1);
  // POSITIVE q3 carries the elbow ABOVE the shoulder-wrist chord: the upper arm
  // leans out and the forearm comes down onto the port, keeping the elbow high
  // and clear of the vehicle. The negative root drops the elbow to ~0.2 m off
  // the deck and swings the shoulder past 145 deg.
  let q3 = Math.acos(cosQ3);
  if (!elbowUp) q3 = -q3;

  const phiTarget = Math.atan2(fwd, up); // angle of the wrist centre from +Y
  const q2 = phiTarget - Math.atan2(L3 * Math.sin(q3), L2 + L3 * Math.cos(q3));

  // ---- J4/J5/J6: aim the tool axis along -n ---------------------------------
  // Orientation of the frame after the pitch chain: R03 = Ry(j1) * Rx(q2+q3).
  // Express the desired tool direction in that frame, then read off a roll and
  // a pitch. Ry(a)*Rx(b) maps local +Y to (sin a sin b, cos b, cos a sin b).
  const q23 = q2 + q3;
  const d = rotXT(rotYT({ x: -n.x, y: -n.y, z: -n.z }, j1), q23);
  const pitchMag = Math.acos(clamp(d.y, -1, 1));

  // A spherical wrist reaches any tool axis two ways: (+pitch, roll) and
  // (-pitch, roll+pi). Both are exact. Take the one with the SMALLER forearm
  // roll — otherwise a target straight ahead demands a gratuitous 180 deg spin
  // of the forearm, which looks wrong and used to trip the joint limit.
  let j4: number, j5: number;
  if (Math.abs(Math.sin(pitchMag)) < 1e-9) {
    j4 = 0; j5 = pitchMag;                            // degenerate: tool along the link
  } else {
    const rollA = Math.atan2(d.x, d.z);
    const rollB = wrapPi(rollA + Math.PI);
    if (Math.abs(rollA) <= Math.abs(rollB)) { j4 = rollA; j5 = pitchMag; }
    else { j4 = rollB; j5 = -pitchMag; }
  }
  const j6 = 0;                                       // free roll; keeps the keyway upright

  // ---- limits ---------------------------------------------------------------
  const L = spec.limits;
  const c1 = clamp(j1, L.j1[0], L.j1[1]);
  const c2 = clamp(q2, L.j2[0], L.j2[1]);
  const c3 = clamp(q3, L.j3[0], L.j3[1]);
  const c4 = clamp(j4, L.j4[0], L.j4[1]);
  const c5 = clamp(j5, L.j5[0], L.j5[1]);
  const c6 = clamp(j6, L.j6[0], L.j6[1]);
  if (c1 !== j1 || c2 !== q2 || c3 !== q3 || c4 !== j4 || c5 !== j5 || c6 !== j6) {
    reachable = false;
    reason = reason ?? 'joint_limit';
  }

  const angles: JointAngles = { j1: c1, j2: c2, j3: c3, j4: c4, j5: c5, j6: c6 };
  const residual = reachable ? 0 : dist(forwardTCP(angles, spec), port);

  return { ...angles, reachable, wristDistance: r, residual, reason };
}

// ---- small rotation helpers (transposes = inverse rotations) ----------------
function rotYT(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * v.x - s * v.z, y: v.y, z: s * v.x + c * v.z };
}
function rotXT(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x, y: c * v.y + s * v.z, z: -s * v.y + c * v.z };
}
function rotY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
}
function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x, y: c * v.y - s * v.z, z: s * v.y + c * v.z };
}
function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
/** Wrap an angle to (-pi, pi]. */
function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Forward kinematics: where does the connector tip actually end up? */
export function forwardTCP(a: JointAngles, spec: CobotSpec = OTTO_CHARGE_ARM): Vec3 {
  const q23 = a.j2 + a.j3;
  const tl = toolLength(spec);

  // wrist centre, in the base frame
  const fwd = spec.upperArm * Math.sin(a.j2) + spec.forearm * Math.sin(q23);
  const up = spec.shoulderHeight + spec.upperArm * Math.cos(a.j2) + spec.forearm * Math.cos(q23);
  const wc: Vec3 = { x: fwd * Math.sin(a.j1), y: up, z: fwd * Math.cos(a.j1) };

  // tool direction: Ry(j1) * Rx(q23) * Ry(j4) * Rx(j5) applied to +Y
  let d: Vec3 = { x: Math.sin(a.j4) * Math.sin(a.j5), y: Math.cos(a.j5), z: Math.cos(a.j4) * Math.sin(a.j5) };
  d = rotX(d, q23);
  d = rotY(d, a.j1);

  return { x: wc.x + d.x * tl, y: wc.y + d.y * tl, z: wc.z + d.z * tl };
}

/** Forward kinematics for the wrist centre only (used for clearance checks). */
export function forwardWristCentre(a: JointAngles, spec: CobotSpec = OTTO_CHARGE_ARM): Vec3 {
  const q23 = a.j2 + a.j3;
  const fwd = spec.upperArm * Math.sin(a.j2) + spec.forearm * Math.sin(q23);
  const up = spec.shoulderHeight + spec.upperArm * Math.cos(a.j2) + spec.forearm * Math.cos(q23);
  return { x: fwd * Math.sin(a.j1), y: up, z: fwd * Math.cos(a.j1) };
}

/** Elbow position, base frame — the joint most likely to foul the vehicle. */
export function forwardElbow(a: JointAngles, spec: CobotSpec = OTTO_CHARGE_ARM): Vec3 {
  const fwd = spec.upperArm * Math.sin(a.j2);
  const up = spec.shoulderHeight + spec.upperArm * Math.cos(a.j2);
  return { x: fwd * Math.sin(a.j1), y: up, z: fwd * Math.cos(a.j1) };
}

/** Stowed: folded compactly over the base so nothing overhangs the drive aisle. */
export const STOWED: JointAngles = { j1: 0, j2: 0.30, j3: 2.30, j4: 0, j5: 0.9, j6: 0 };

/** A pose backed off along the port normal — the waypoint before and after a mate. */
export function standoffPose(
  port: Vec3, portNormal: Vec3, standoff: number, spec: CobotSpec = OTTO_CHARGE_ARM,
): IKSolution {
  const n = norm(portNormal);
  return solveIK(
    { x: port.x + n.x * standoff, y: port.y + n.y * standoff, z: port.z + n.z * standoff },
    n, spec,
  );
}

export function lerpAngles(a: JointAngles, b: JointAngles, t: number): JointAngles {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    j1: l(a.j1, b.j1), j2: l(a.j2, b.j2), j3: l(a.j3, b.j3),
    j4: l(a.j4, b.j4), j5: l(a.j5, b.j5), j6: l(a.j6, b.j6),
  };
}

/** Smoothstep — real arms do not start and stop instantaneously. */
export function ease(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}
