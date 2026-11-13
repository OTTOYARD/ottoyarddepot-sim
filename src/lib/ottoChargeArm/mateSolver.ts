// Where the OTTO-CHARGE ARM has to be to mate a given vehicle's charge inlet, and whether it can.
//
// The arm was a fixed pedestal beside the middle of the car, and every inlet was drawn inside its reach
// (chargePort.ts: "the AV stops so the inlet lands inside the arm's service window"). Real inlets are not there:
// a front wing 1.2 m ahead of the middle (Jaguar I-PACE), a rear quarter 2.2 m behind it (Tesla Model Y), the
// middle of the rear bumper facing backward (Tesla Cybercab). Measured on 2026-11-13 with the arm as built
// (reach 3.125 m): from the fixed base the rear-quarter inlets are met only at full stretch along the flank, and
// the Cybercab's is not met from any base position.
//
// So the arm's BASE moves, and its head carries two connectors. This file is their arithmetic:
//   1. A RAIL. The base rides a floor rail parallel to the car, so a side inlet is always met square-on, dead
//      abeam the base: the middle of the region armClearance.test.ts measured safe.
//   2. A CROSS-SLIDE on the rail's carriage, toward and away from the car. It does two jobs. It holds the base at
//      the SAME flank standoff for every vehicle, whatever its width, so the measured window applies to each of
//      them as measured. And for a rear inlet, which is on the centreline, half a car's width further in than any
//      flank and entered from behind, it carries the base in behind the car's tail corner.
//      (A telescoping forearm was the first idea for the rear inlet. The cross-slide reaches the same inlets and
//      leaves the arm itself, and every clearance measured on it, exactly as built.)
//   3. A TWO-CONNECTOR HEAD. CCS1 and NACS (SAE J3400) cover every vehicle in the fleet; the head turns the one
//      the vehicle needs to the front.
//
// What this file does NOT prove: clearance to each vehicle's own body through the whole motion. portReach.test.ts
// and the per-vehicle sweep (armFleetClearance.test.ts) do that.
import { forwardElbow, forwardTCP, forwardWristCentre, solveIK, type IKSolution, type JointAngles, type Vec3 } from './cobotIK';
import { FLANK_STANDOFF_M, MOUNT_HEIGHT_M, OTTO_CHARGE_ARM, PEDESTAL_TO_CAR_CENTRE_M, SERVICE_WINDOW, type CobotSpec } from './cobotSpec';

export type Connector = 'CCS1' | 'NACS';

/** What was added to the arm. Lengths in metres, in the arm's frame: +X along the car, +Z toward it. */
export const ARM_REACH = {
  /** The base's travel along its rail, measured from the stall's middle, toward the car's tail and toward its
   *  nose. Sized by `railTravelNeeded()`. */
  railTailM: 2.5,
  railNoseM: 1.3,
  /** The cross-slide's travel: toward the car (+) and away from it (-), from the line the fixed pedestal stood on. */
  crossInM: 0.65,
  crossOutM: 0.06,
  /** The head's two connectors. Each stands beside the tool's axis (metres along the tool's X, and along its Z) and
   *  rests `headStrokeM` back; the one the car takes comes forward to the tool point's plane. */
  heads: ['CCS1', 'NACS'] as Connector[],
  headOffsetX: { CCS1: 0.1, NACS: -0.1 } as Record<Connector, number>,
  headOffsetZ: 0.025,
  headStrokeM: 0.09,
  /** A rear mate keeps the arm's base, elbow and forearm this far from the car's plan outline. */
  rearMateClearanceM: 0.25,
} as const;

/** A rear mate is taken only with the elbow bent at least this far, radians. */
const MIN_ELBOW_BEND_RAD = 0.5;

/** The base stage's joints as the CAD names them: the bed's set position (which way the stall faces), the carriage
 *  along the rail, the cross-slide toward the car. Metres. */
export const BASE_JOINT_NAMES = ['CR_BED', 'CR_X', 'CR_Z'] as const;
/** The head's two plunge joints, metres forward from rest. */
export const HEAD_JOINT_NAMES: Record<Connector, string> = { CCS1: 'HD_CCS', NACS: 'HD_NACS' };

/** Where the rail bed's middle sits along the car from the stall's middle, in the arm's +X, for a stall facing `toward`. */
export function bedCentreX(toward: 1 | -1): number {
  return toward * (ARM_REACH.railTailM - ARM_REACH.railNoseM) / 2;
}

/** A vehicle's inlet, as the fleet models record it (fleetModels/spec.ts ChargePortSpec), plus its body. */
export interface MateTarget {
  face: 'left' | 'right' | 'rear';
  /** Fore/aft of the vehicle's middle, metres, positive toward the nose. */
  alongM: number;
  heightM: number;
  /** Lateral offset of a rear inlet from the centreline, metres, positive toward the vehicle's right. */
  lateralM?: number;
  connector: Connector;
  presentsEitherSide?: boolean;
  lengthM: number;
  widthM: number;
}

export interface Mate {
  ok: boolean;
  /** Why not, when not. */
  reason?: 'wrong_side' | 'no_connector' | 'out_of_reach' | 'no_clear_path';
  /** Where the base stands on its rail, metres from the stall's middle along the arm's +X. */
  slideM: number;
  /** Where the cross-slide stands, metres toward the car (+) from the line the fixed pedestal stood on. */
  crossM: number;
  /** Which of the head's connectors comes forward. */
  head: Connector | null;
  /** The joint angles that put that connector's face on the inlet, square to it and upright. j6 is set. */
  ik: IKSolution | null;
  /** Where the TOOL AXIS meets the inlet's plane, relative to the base where this mate puts it: the point the
   *  approach, insert and retract poses are solved to (armMotion.poseFor). The connector stands beside it. */
  axisPort: Vec3;
  normal: Vec3;
  /** The inlet in the arm's frame at slide 0. */
  port: Vec3;
  /** Body side to base axis on a side mate, metres, with the cross-slide where this mate puts it. */
  flankStandoffM: number;
  /** Closest the forearm or elbow comes to the car's plan outline on a rear mate, metres. */
  planClearanceM: number | null;
}

/** Distance in plan from a segment to an axis-aligned rectangle (0 when it crosses). Sampled; the arm is slow here. */
function segToRect(a: Vec3, b: Vec3, x0: number, x1: number, z0: number, z1: number): number {
  let best = Infinity;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const dx = Math.max(x0 - x, 0, x - x1);
    const dz = Math.max(z0 - z, 0, z - z1);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

const rX = (v: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return { x: v.x, y: c * v.y - s * v.z, z: s * v.y + c * v.z }; };
const rY = (v: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z }; };
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** A tool-frame vector in the arm's base frame: Ry(j1) Rx(j2+j3) Ry(j4) Rx(j5) Ry(j6), cobotIK's own chain. */
export function toolToBase(v: Vec3, a: JointAngles): Vec3 {
  return rY(rX(rY(rX(rY(v, a.j6), a.j5), a.j4), a.j2 + a.j3), a.j1);
}

/** Where a connector's face is, in the arm's base frame, with that connector forward. */
export function connectorFace(a: JointAngles, head: Connector, spec: CobotSpec = OTTO_CHARGE_ARM): Vec3 {
  const tcp = forwardTCP(a, spec);
  const o = toolToBase({ x: ARM_REACH.headOffsetX[head], y: 0, z: ARM_REACH.headOffsetZ }, a);
  return { x: tcp.x + o.x, y: tcp.y + o.y, z: tcp.z + o.z };
}

/**
 * The joint angles that put one of the head's connectors on an inlet. The connector stands beside the tool axis, so
 * the axis is solved to a point beside the inlet; j6 rolls the head so that its Z (the side the camera pod is on)
 * points as near straight down as the approach allows, which keeps the connector's key upright on every vehicle.
 */
export function headIK(port: Vec3, normal: Vec3, head: Connector, spec: CobotSpec = OTTO_CHARGE_ARM): { ik: IKSolution; axisPort: Vec3 } {
  const ox = ARM_REACH.headOffsetX[head];
  const oz = ARM_REACH.headOffsetZ;
  let axisPort = port;
  let ik = solveIK(axisPort, normal, spec);
  for (let it = 0; it < 6; it++) {
    const x0 = toolToBase({ x: 1, y: 0, z: 0 }, { ...ik, j6: 0 });
    const z0 = toolToBase({ x: 0, y: 0, z: 1 }, { ...ik, j6: 0 });
    const down: Vec3 = { x: 0, y: -1, z: 0 };
    // Ry(j6) carries the tool's Z to sin(j6) X0 + cos(j6) Z0.
    const j6 = Math.atan2(dot(down, x0), dot(down, z0));
    const a = { ...ik, j6 };
    const o = toolToBase({ x: ox, y: 0, z: oz }, a);
    axisPort = { x: port.x - o.x, y: port.y - o.y, z: port.z - o.z };
    const next = solveIK(axisPort, normal, spec);
    ik = { ...next, j6 };
  }
  return { ik, axisPort };
}

/**
 * Solve one mate.
 * @param armOnCarsRight true on a west-column stall (the arm stands on the car's right), false on an east-column one.
 */
export function solveMate(t: MateTarget, armOnCarsRight: boolean, spec: CobotSpec = OTTO_CHARGE_ARM): Mate {
  // depotPlacement.portInArmFrame: x = -toward * along, and toward is +1 where the arm is on the car's right.
  const toward = armOnCarsRight ? 1 : -1;
  const half = t.widthM / 2;
  const flankStandoffM = PEDESTAL_TO_CAR_CENTRE_M - half;
  const head = ARM_REACH.heads.includes(t.connector) ? t.connector : null;
  const fail = (reason: Mate['reason'], port: Vec3): Mate =>
    ({ ok: false, reason, slideM: 0, crossM: 0, head, ik: null, axisPort: port, normal: { x: 0, y: 0, z: -1 }, port, flankStandoffM, planClearanceM: null });
  // The rail's two ends in the arm's +X: the tail end is +X where toward is +1.
  const slideMin = toward > 0 ? -ARM_REACH.railNoseM : -ARM_REACH.railTailM;
  const slideMax = toward > 0 ? ARM_REACH.railTailM : ARM_REACH.railNoseM;
  const y = t.heightM - MOUNT_HEIGHT_M;

  if (t.face !== 'rear') {
    const port: Vec3 = { x: -toward * t.alongM, y, z: flankStandoffM };
    const onArmSide = (t.face === 'right') === armOnCarsRight;
    if (!onArmSide && !t.presentsEitherSide) return fail('wrong_side', port);
    if (!head) return fail('no_connector', port);
    // A vehicle that turns round to present its other flank also swaps nose for tail.
    const px = onArmSide ? port.x : -port.x;
    // The base stops where the TOOL AXIS is dead abeam it: the connector stands headOffsetX beside that axis.
    const slideM = Math.min(slideMax, Math.max(slideMin, px - ARM_REACH.headOffsetX[head]));
    // The cross-slide puts the base at the standoff the safe window was measured at, whatever the car's width.
    const crossM = Math.min(ARM_REACH.crossInM, Math.max(-ARM_REACH.crossOutM, flankStandoffM - FLANK_STANDOFF_M));
    const standoff = flankStandoffM - crossM;
    const rel: Vec3 = { x: px - slideM, y, z: standoff };
    const normal: Vec3 = { x: 0, y: 0, z: -1 };
    const h = headIK(rel, normal, head, spec);
    const inWindow = Math.abs(h.axisPort.x) <= SERVICE_WINDOW.alongMax && t.heightM >= SERVICE_WINDOW.heightMin && t.heightM <= SERVICE_WINDOW.heightMax;
    if (!h.ik.reachable || !inWindow) return { ...fail('out_of_reach', { ...port, x: px }), slideM, crossM, ik: h.ik };
    return { ok: true, slideM, crossM, head, ik: h.ik, axisPort: h.axisPort, normal, port: { ...port, x: px }, flankStandoffM: standoff, planClearanceM: null };
  }

  // A rear inlet: on the tail, facing backward. In the arm's frame the car's tail is toward +X * toward.
  const tailX = toward * (t.lengthM / 2);
  const port: Vec3 = { x: tailX, y, z: PEDESTAL_TO_CAR_CENTRE_M - toward * (t.lateralM ?? 0) };
  if (!head) return fail('no_connector', port);
  const normal: Vec3 = { x: toward, y: 0, z: 0 };
  const x0 = Math.min(-tailX, tailX);
  const x1 = Math.max(-tailX, tailX);
  let best: Mate | null = null;
  const z0 = PEDESTAL_TO_CAR_CENTRE_M - half;
  const z1 = PEDESTAL_TO_CAR_CENTRE_M + half;
  // Least cross-slide travel first, then the rail position nearest the stall's middle that clears the car's corner.
  for (let c = 0; c <= ARM_REACH.crossInM + 1e-9 && !best; c += 0.05) {
    for (let k = Math.ceil(slideMin / 0.05); k <= Math.floor(slideMax / 0.05 + 1e-9); k++) {
      const s = k * 0.05;
      const h = headIK({ x: port.x - s, y: port.y, z: port.z - c }, normal, head, spec);
      const ik = h.ik;
      // Not at full stretch: the elbow keeps a bend, so the arm has travel left to insert and to comply.
      if (!ik.reachable || Math.abs(ik.j3) < MIN_ELBOW_BEND_RAD) continue;
      const elbow = forwardElbow(ik, spec);
      const wrist = forwardWristCentre(ik, spec);
      const shift = (p: Vec3): Vec3 => ({ x: p.x + s, y: p.y, z: p.z + c });
      const base = shift({ x: 0, y: 0, z: 0 });
      const clear = Math.min(
        segToRect(base, base, x0, x1, z0, z1) - spec.radii.base,
        segToRect(base, shift(elbow), x0, x1, z0, z1),
        segToRect(shift(elbow), shift(wrist), x0, x1, z0, z1),
      );
      if (clear < ARM_REACH.rearMateClearanceM) continue;
      if (!best || Math.abs(s) < Math.abs(best.slideM) - 1e-9) {
        best = { ok: true, slideM: s, crossM: c, head, ik, axisPort: h.axisPort, normal, port, flankStandoffM: flankStandoffM - c, planClearanceM: clear };
      }
    }
  }
  if (best) return best;
  // Say which of the two it was: no solution at all, or solutions that cut the car's corner.
  let any = false;
  for (let s = slideMin; s <= slideMax; s += 0.05) any = any || solveIK({ x: port.x - s, y: port.y, z: port.z - ARM_REACH.crossInM }, normal, spec).reachable;
  return fail(any ? 'no_clear_path' : 'out_of_reach', port);
}

/** The rail travel a set of vehicles needs, nose end and tail end, metres from the stall's middle. */
export function railTravelNeeded(targets: MateTarget[], spec: CobotSpec = OTTO_CHARGE_ARM): { noseM: number; tailM: number } {
  let noseM = 0;
  let tailM = 0;
  for (const t of targets) {
    for (const right of [true, false]) {
      const m = solveMate(t, right, spec);
      if (!m.ok) continue;
      const towardTail = right ? m.slideM : -m.slideM;
      tailM = Math.max(tailM, towardTail);
      noseM = Math.max(noseM, -towardTail);
    }
  }
  return { noseM, tailM };
}
