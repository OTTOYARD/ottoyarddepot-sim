// Where the OTTO-CHARGE ARM has to be to mate a given vehicle's charge inlet, and whether it can.
//
// The arm was a fixed pedestal beside the middle of the car, and every inlet was drawn inside its reach
// (chargePort.ts: "the AV stops so the inlet lands inside the arm's service window"). Real inlets are not there:
// a front wing 1.2 m ahead of the middle (Jaguar I-PACE), a rear quarter 2.2 m behind it (Tesla Model Y), the
// middle of the rear bumper facing backward (Tesla Cybercab). Measured on 2026-11-13 with the arm as built
// (reach 3.125 m): from the fixed base the rear-quarter inlets are met only at full stretch along the flank, and
// the Cybercab's is not met from any base position.
//
// So the arm gets three things, and this file is their arithmetic:
//   1. A RAIL. The base rides a floor rail parallel to the car, so a side inlet is always met square-on, dead
//      abeam the base: the middle of the region armClearance.test.ts measured safe.
//   2. A TELESCOPING FOREARM. A rear inlet is on the centreline, half a car's width further in than any flank
//      and entered from behind. The forearm extends for that mate and only that mate.
//   3. A TWO-CONNECTOR HEAD. CCS1 and NACS (SAE J3400) cover every vehicle in the fleet; the head turns the one
//      the vehicle needs to the front.
//
// What this file does NOT prove: clearance to each vehicle's own body. The safe window was measured against the
// yard's one car at a 1.866 m flank standoff; a wider or narrower vehicle changes that standoff (reported per
// mate as `flankStandoffM`). The per-vehicle sweep is the next step and is named in docs/CHARGE-ARM-REACH.md.
import { forwardElbow, forwardWristCentre, solveIK, type IKSolution, type Vec3 } from './cobotIK';
import { MOUNT_HEIGHT_M, OTTO_CHARGE_ARM, PEDESTAL_TO_CAR_CENTRE_M, SERVICE_WINDOW, type CobotSpec } from './cobotSpec';

export type Connector = 'CCS1' | 'NACS';

/** What was added to the arm. Lengths in metres, in the arm's frame: +X along the car, +Z toward it. */
export const ARM_REACH = {
  /** The base's travel along its rail, measured from the stall's middle. Negative is toward the car's tail
   *  on a west-column stall; the solver mirrors it for the east column. Sized by `railTravelNeeded()`. */
  railTailM: 2.5,
  railNoseM: 1.3,
  /** The forearm's telescoping stage. */
  telescopeM: 0.75,
  /** Connectors on the head, in the order they sit round its axis. The third pocket is empty. */
  heads: ['CCS1', 'NACS'] as Connector[],
  /** Degrees the head turns from one pocket to the next. */
  headIndexDeg: 120,
  /** A rear mate keeps the forearm and elbow this far from the car's plan outline. */
  rearMateClearanceM: 0.2,
} as const;

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
  /** How far the forearm is extended, metres. */
  extendM: number;
  /** Which pocket of the head faces forward, and how far the head turned from its rest pocket. */
  head: Connector | null;
  headTurnDeg: number;
  ik: IKSolution | null;
  /** The inlet in the arm's frame at slide 0. */
  port: Vec3;
  /** Body side to base axis for a side mate, metres. The safe window was measured at SERVICE_WINDOW.flankStandoff. */
  flankStandoffM: number;
  /** Closest the forearm or elbow comes to the car's plan outline on a rear mate, metres. */
  planClearanceM: number | null;
}

const withForearm = (spec: CobotSpec, extra: number): CobotSpec => (extra ? { ...spec, forearm: spec.forearm + extra } : spec);

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
  const headTurnDeg = head ? ARM_REACH.heads.indexOf(head) * ARM_REACH.headIndexDeg : 0;
  const fail = (reason: Mate['reason'], port: Vec3): Mate =>
    ({ ok: false, reason, slideM: 0, extendM: 0, head, headTurnDeg, ik: null, port, flankStandoffM, planClearanceM: null });
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
    const slideM = Math.min(slideMax, Math.max(slideMin, px));
    const rel: Vec3 = { x: px - slideM, y, z: flankStandoffM };
    const ik = solveIK(rel, { x: 0, y: 0, z: -1 }, spec);
    const inWindow = Math.abs(rel.x) <= SERVICE_WINDOW.alongMax && t.heightM >= SERVICE_WINDOW.heightMin && t.heightM <= SERVICE_WINDOW.heightMax;
    if (!ik.reachable || !inWindow) return { ...fail('out_of_reach', { ...port, x: px }), slideM, ik };
    return { ok: true, slideM, extendM: 0, head, headTurnDeg, ik, port: { ...port, x: px }, flankStandoffM, planClearanceM: null };
  }

  // A rear inlet: on the tail, facing backward. In the arm's frame the car's tail is toward +X * toward.
  const tailX = toward * (t.lengthM / 2);
  const port: Vec3 = { x: tailX, y, z: PEDESTAL_TO_CAR_CENTRE_M - toward * (t.lateralM ?? 0) };
  if (!head) return fail('no_connector', port);
  const normal: Vec3 = { x: toward, y: 0, z: 0 };
  const x0 = Math.min(-tailX, tailX);
  const x1 = Math.max(-tailX, tailX);
  let best: Mate | null = null;
  // Least extension first, then the base position nearest the stall's middle that clears the car's corner.
  for (let e = 0; e <= ARM_REACH.telescopeM + 1e-9 && !best; e += 0.05) {
    const sp = withForearm(spec, e);
    for (let k = Math.ceil(slideMin / 0.05); k <= Math.floor(slideMax / 0.05 + 1e-9); k++) {
      const s = k * 0.05;
      const ik = solveIK({ x: port.x - s, y: port.y, z: port.z }, normal, sp);
      if (!ik.reachable) continue;
      const elbow = forwardElbow(ik, sp);
      const wrist = forwardWristCentre(ik, sp);
      const shift = (p: Vec3): Vec3 => ({ x: p.x + s, y: p.y, z: p.z });
      const clear = Math.min(
        segToRect(shift({ x: 0, y: 0, z: 0 }), shift(elbow), x0, x1, PEDESTAL_TO_CAR_CENTRE_M - half, PEDESTAL_TO_CAR_CENTRE_M + half),
        segToRect(shift(elbow), shift(wrist), x0, x1, PEDESTAL_TO_CAR_CENTRE_M - half, PEDESTAL_TO_CAR_CENTRE_M + half),
      );
      if (clear < ARM_REACH.rearMateClearanceM) continue;
      if (!best || Math.abs(s) < Math.abs(best.slideM) - 1e-9) {
        best = { ok: true, slideM: s, extendM: e, head, headTurnDeg, ik, port, flankStandoffM, planClearanceM: clear };
      }
    }
  }
  if (best) return best;
  // Say which of the two it was: no solution at all, or solutions that cut the car's corner.
  const sp = withForearm(spec, ARM_REACH.telescopeM);
  let any = false;
  for (let s = slideMin; s <= slideMax; s += 0.05) any = any || solveIK({ x: port.x - s, y: port.y, z: port.z }, normal, sp).reachable;
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
