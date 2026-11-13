/**
 * THE OTTO-CHARGE ARM BESIDE A CAR WHOSE DOORS ARE OPEN.
 *
 * Every charger stands on the car's LEFT, the flank the cleaning arm calls the PORT flank. A clean opens doors, and
 * an open left door leaf is where the charge arm stands or passes (docs/CLEAN-ARM-PER-VEHICLE.md). So the port
 * flank's doors open only while the charge arm is STILL in a place measured clear of them. This file measures that,
 * per vehicle, by rule:
 *
 *   stowed   the arm folded at its rail's middle (or at the vehicle's park position, below);
 *   latched  the arm at this vehicle's own mate (mateSolver.solveMate), its connector in the inlet.
 *
 * Each is allowed only if every part of the charge arm keeps CHARGE_LEAF_MARGIN_M from every port-flank door leaf at
 * EVERY position of its travel, shut to open: the doors open and shut beside the still arm, and a hinged leaf's free
 * edge passes nearer the arm on its way than where it comes to rest.
 * A vehicle whose open leaf reaches the arm stowed at the rail's middle gets a PARK POSITION: the place on the rail
 * nearest the middle where the stowed arm is clear. While that vehicle is in the stall the arm's home is there.
 *
 * The charge arm here is its links as capsules from its own forward kinematics, radii rounded up, plus its two
 * connectors: the model cleanArmClearance.test.ts measures the two robots with. PURE. The clean-program generator
 * stores the result with each program (cleanProgramFleet.ts), and cleanArmFleet.test.ts measures it again.
 */
import type { CabinProfile } from '@/lib/fleetModels/cabin';
import { mateTarget } from '@/lib/fleetModels/ports';
import type { VehicleSpec } from '@/lib/fleetModels/spec';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { forwardElbow, forwardTCP, forwardWristCentre, STOWED, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { MOUNT_HEIGHT_M, OTTO_CHARGE_ARM, PEDESTAL_TO_CAR_CENTRE_M } from '@/lib/ottoChargeArm/cobotSpec';
import { ARM_REACH, connectorFace, solveMate, type Connector, type Mate } from '@/lib/ottoChargeArm/mateSolver';
import type { Capsule } from './cleanArmClearance';
import type { ChargeBeside } from './cleanArmPose';

/** The charge arm keeps this far from an open door leaf, metres: its own structural margin. */
export const CHARGE_LEAF_MARGIN_M = 0.1;
/** A park position is taken only with this much more to spare. */
const PARK_EXTRA_M = 0.02;

/**
 * The OTTO-CHARGE ARM as capsules in the CAR frame (x along + nose, y up from grade, z across + right), its base
 * where a mate put it: `slide` along its rail and `cross` toward the car, in the arm's own frame.
 * @param toward the stall's facing sign (depotPlacement.towardFor): -1 where the arm stands on the car's left
 * @param head the connector that is forward, pushed `plunge` metres; null for none
 */
export function chargeArmCapsules(
  a: JointAngles, toward: 1 | -1, slide: number, cross: number, head: Connector | null, plunge: number,
): Capsule[] {
  const s = OTTO_CHARGE_ARM;
  const toCar = (p: { x: number; y: number; z: number }) => ({
    x: toward > 0 ? -(p.x + slide) : p.x + slide,
    y: p.y + MOUNT_HEIGHT_M,
    z: toward > 0 ? PEDESTAL_TO_CAR_CENTRE_M - cross - p.z : -PEDESTAL_TO_CAR_CENTRE_M + cross + p.z,
  });
  const base = toCar({ x: 0, y: 0, z: 0 });
  const shoulder = toCar({ x: 0, y: s.shoulderHeight, z: 0 });
  const elbow = toCar(forwardElbow(a, s));
  const wristB = forwardWristCentre(a, s), tcpB = forwardTCP(a, s);
  const wrist = toCar(wristB), tcp = toCar(tcpB);
  const out: Capsule[] = [
    { name: 'charge base', a: base, b: shoulder, r: s.radii.base * 1.15 },
    { name: 'charge upper arm', a: shoulder, b: elbow, r: Math.max(s.radii.shoulder, s.radii.upper * 1.2, s.radii.elbow) },
    { name: 'charge forearm', a: elbow, b: wrist, r: Math.max(s.radii.elbow, s.radii.fore * 1.2) },
    { name: 'charge wrist', a: wrist, b: tcp, r: s.radii.wristR * 1.3 },
  ];
  const L = Math.hypot(tcpB.x - wristB.x, tcpB.y - wristB.y, tcpB.z - wristB.z) || 1;
  const fwd = { x: (tcpB.x - wristB.x) / L, y: (tcpB.y - wristB.y) / L, z: (tcpB.z - wristB.z) / L };
  for (const h of ARM_REACH.heads) {
    const face = connectorFace(a, h, s);
    const push = h === head ? plunge : 0;
    out.push({
      name: `charge connector ${h}`, r: s.radii.wristR * 1.3,
      a: toCar({ x: face.x - fwd.x * 0.16, y: face.y - fwd.y * 0.16, z: face.z - fwd.z * 0.16 }),
      b: toCar({ x: face.x + fwd.x * push, y: face.y + fwd.y * push, z: face.z + fwd.z * push }),
    });
  }
  return out;
}

/** The nearest a set of capsules comes to `f` (a distance field), less each capsule's radius. */
export function capsulesMin(caps: readonly Capsule[], f: (p: { x: number; y: number; z: number }) => number, n = 16): number {
  let best = Infinity;
  for (const c of caps) for (let k = 0; k <= n; k++) {
    const p = { x: c.a.x + ((c.b.x - c.a.x) * k) / n, y: c.a.y + ((c.b.y - c.a.y) * k) / n, z: c.a.z + ((c.b.z - c.a.z) * k) / n };
    best = Math.min(best, f(p) - c.r);
  }
  return best;
}

/** The arm stowed with its base at `slide` on its rail, cross-slide out. */
export const stowedCapsules = (toward: 1 | -1, slide: number): Capsule[] => chargeArmCapsules(STOWED, toward, slide, 0, null, 0);

/** The arm latched at a mate: the solved pose, the base where the mate puts it, the working connector forward. */
export function latchedCapsules(m: Mate, toward: 1 | -1): Capsule[] {
  const a = { ...poseFor({ phase: 'charging', t: 0 }, { port: m.axisPort, normal: m.normal }, OTTO_CHARGE_ARM).angles, j6: m.ik?.j6 ?? 0 };
  return chargeArmCapsules(a, toward, m.slideM, m.crossM, m.head, ARM_REACH.headStrokeM);
}

/** A rail position along the CAR (+ nose) as the arm's slide, and back: the arm's +X is the car's tail where `toward` is +1. */
export const slideOfCarX = (x: number, toward: 1 | -1): number => -toward * x;

/** What the measurement found, with its numbers, metres. */
export interface ChargeBesideMeasure {
  facts: ChargeBeside;
  /** the stowed arm at the rail's middle, and latched, to the nearest open port-flank leaf (LEAF_FAR_M caps both) */
  stowedM: number;
  latchedM: number | null;
  /** at the park position, when there is one: to the nearest open leaf, and to the body over the stowed run to it */
  parkedM: number | null;
  parkRunBodyM: number | null;
}

/**
 * May a vehicle's port-flank doors stand open with the charge arm stowed, and with it latched? Measured against the
 * vehicle's own open door leaves, with the arm on the car's left (every charger is; the left leaves are the mirror
 * of the right ones the cabin profile holds, which leafClearance reads either side).
 */
export function measureChargeBeside(spec: VehicleSpec, cabin: CabinProfile): ChargeBesideMeasure {
  const toward = -1 as const;
  // the doors open and shut beside the still arm, so every position of their travel counts, not only where they rest
  const leaf = (p: { x: number; y: number; z: number }) => cabin.leafSweptClearance(p);
  const stowedM = capsulesMin(stowedCapsules(toward, 0), leaf);
  const target = mateTarget(spec);
  const m = target ? solveMate(target, false) : null;
  const latchedM = m && m.ok ? capsulesMin(latchedCapsules(m, toward), leaf) : null;
  const facts: ChargeBeside = { stowed: stowedM >= CHARGE_LEAF_MARGIN_M, latched: latchedM !== null && latchedM >= CHARGE_LEAF_MARGIN_M };
  let parkedM: number | null = null, parkRunBodyM: number | null = null;
  if (!facts.stowed) {
    // the place on the rail nearest its middle where the stowed arm clears every open leaf, and whose run from the
    // middle (doors shut) clears the body
    const lo = -ARM_REACH.railTailM, hi = ARM_REACH.railNoseM; // along the car, with the arm on its left
    let best: number | null = null;
    for (let d = 0.05; d <= Math.max(-lo, hi) + 1e-9 && best === null; d += 0.05) {
      for (const x of [-d, d]) {
        if (x < lo - 1e-9 || x > hi + 1e-9) continue;
        if (capsulesMin(stowedCapsules(toward, slideOfCarX(x, toward)), leaf) < CHARGE_LEAF_MARGIN_M + PARK_EXTRA_M) continue;
        let run = Infinity;
        for (let k = 0; k <= 16; k++) run = Math.min(run, capsulesMin(stowedCapsules(toward, slideOfCarX((x * k) / 16, toward)), cabin.bodyClearance));
        if (run < CHARGE_LEAF_MARGIN_M) continue;
        best = x; parkRunBodyM = run;
        parkedM = capsulesMin(stowedCapsules(toward, slideOfCarX(x, toward)), leaf);
        break;
      }
    }
    if (best !== null) { facts.stowed = true; facts.parkX = Math.round(best * 1000) / 1000; }
  }
  return { facts, stowedM, latchedM, parkedM, parkRunBodyM };
}
