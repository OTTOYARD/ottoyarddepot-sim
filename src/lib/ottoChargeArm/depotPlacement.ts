/**
 * Where each OTTO-CHARGE ARM sits in the depot, and where it has to reach.
 *
 * This is the file that gets the units right. Everything else in the arm
 * package is metres; the depot renderer is PLAN UNITS at 0.4785 m/unit. The
 * conversion happens here and nowhere else.
 *
 * It also fixes the anchoring bug in the previous arm: the old component placed
 * the arm at `stall.position`, which is where the CAR parks. ChargingField.tsx
 * puts the charger pedestal at `stall.position.x + toward * 4.5` — 4.5 plan
 * units (2.15 m) to the side. The arms were therefore growing out of the middle
 * of the parking spaces instead of off the chargers.
 */

import { CANOPIES } from '@/lib/sitePlan';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import { PLAN_UNITS_PER_METRE, MOUNT_HEIGHT_M } from './cobotSpec';

/** Lateral offset from the car's centreline to its charger pedestal, plan units. */
export const PEDESTAL_OFFSET_PU = 4.5;

/** 2D -> 3D, matching src/components/canvas/three/coordUtils.ts exactly. */
function toWorld(x2d: number, y2d: number): [number, number] {
  return [150 - x2d, 110 - y2d];
}

/**
 * Which side of a charging stall its pedestal stands on — ChargingField's own
 * rule, extracted so the arm, the pedestal and the VEHICLE's visible charge
 * port cannot drift apart.
 *
 * +1 => the car sits toward +worldX of its pedestal (pedestal on the car's
 * -worldX flank); -1 => the mirror. Canopy A's two stall columns sit at cx-7
 * and cx+7, so both signs occur in a single canopy.
 */
export function towardFor(stallX: number): 1 | -1 {
  const canopy = CANOPIES.reduce(
    (best, c) => (Math.abs(c.cx - stallX) < Math.abs(best.cx - stallX) ? c : best),
    CANOPIES[0],
  );
  return (Math.sign(canopy.cx - stallX) || 1) as 1 | -1;
}

export interface ArmPlacement {
  stallId: string;
  /** Arm base (J1 axis) in depot world coordinates, plan units. */
  world: [number, number, number];
  /**
   * Yaw so the arm's local +Z points at the parked vehicle.
   * +1 => the car lies toward +worldX of the pedestal; -1 => toward -worldX.
   */
  toward: 1 | -1;
  rotationY: number;
  /** Uniform scale converting the metre-authored arm into plan units. */
  scale: number;
  /** Car centre in world coords, plan units — the frame the port hangs off. */
  carWorld: [number, number, number];
}

/**
 * Resolve placement for one charging stall.
 *
 * `toward` reproduces ChargingField's own rule: the pedestal stands between the
 * car and its canopy's centre spine. Canopy A's two stall columns sit at
 * cx-7 and cx+7, so their pedestals end up on OPPOSITE flanks — which is why
 * the depot can serve charge ports on either side of a vehicle at all.
 */
export function placeArm(
  stallId: string, stallX: number, stallY: number,
): ArmPlacement {
  const toward = towardFor(stallX);

  const pedX = stallX + toward * PEDESTAL_OFFSET_PU;
  const [pwx, pwz] = toWorld(pedX, stallY);
  const [cwx, cwz] = toWorld(stallX, stallY);

  // toWorld negates X, so a +1 plan-space `toward` still means the car sits at
  // GREATER worldX than the pedestal: worldX(car) - worldX(ped)
  //   = (150 - stallX) - (150 - stallX - toward*4.5) = +toward*4.5.
  // Rotating about Y by theta maps local +Z to (sin theta, 0, cos theta), so
  // pointing +Z at the car needs sin theta = toward, i.e. theta = toward*PI/2.
  const rotationY = toward * (Math.PI / 2);

  return {
    stallId,
    // Mount height is measured from GRADE, and grade in this renderer is the
    // asphalt deck at DECK_Y — not y=0, which is the earth under the curb slab.
    // Measuring from 0 put the arm 0.26 units low relative to the cars, which
    // only became visible once the vehicle grew a charge port to aim at.
    world: [pwx, DECK_Y + MOUNT_HEIGHT_M * PLAN_UNITS_PER_METRE, pwz],
    toward,
    rotationY,
    scale: PLAN_UNITS_PER_METRE,
    carWorld: [cwx, DECK_Y, cwz],
  };
}

/**
 * The charge port in the ARM'S BASE FRAME, in METRES — the frame solveIK wants.
 *
 * Arm base frame: +Z toward the vehicle, +X along the arm's mount, +Y up.
 *
 * THE SIGN ON X IS NOT COSMETIC. The arm group is rotated by `toward * PI/2`,
 * so base-frame +X maps to world Z of `-toward`: world -Z on a toward=+1 stall
 * and world +Z on a toward=-1 one. Vehicles park NORTH (world +Z) at every
 * charging stall — see parkedHeading() in TwinMotionDriver — so a port's
 * fore/aft offset only feeds STRAIGHT into base-frame X on toward=-1 stalls.
 * Passing `alongM` through unsigned, as this did, mirrored the target fore/aft
 * on the other half of the stalls: the arm plugged into the tail of a car whose
 * inlet was at the nose. Nothing caught it because the vehicle had no visible
 * port to disagree with, and the service window is symmetric so the IK still
 * solved. It does not solve the right point.
 *
 * @param alongM  port offset fore/aft of the vehicle centre, metres (+ = nose)
 * @param heightM port height above grade, metres
 * @param carHalfWidthM half the rendered vehicle's width, metres
 * @param toward  the stall's pedestal side, from placeArm()/towardFor()
 */
export function portInArmFrame(
  alongM: number, heightM: number, carHalfWidthM: number, toward: 1 | -1,
): { x: number; y: number; z: number } {
  const pedestalToCentre = PEDESTAL_OFFSET_PU / PLAN_UNITS_PER_METRE; // 2.153 m
  return {
    x: -toward * alongM,
    y: heightM - MOUNT_HEIGHT_M,
    z: pedestalToCentre - carHalfWidthM,
  };
}

/**
 * The SAME charge port in the VEHICLE'S OWN FRAME, in PLAN UNITS — what
 * Vehicle3D hangs the visible port ring off.
 *
 * The vehicle model is authored nose-along-local-+Z, and parks facing north at
 * every charging stall, so at a stall its local frame is the world frame. Its
 * pedestal therefore sits on the local -toward flank, and the fore/aft offset
 * runs straight down local +Z.
 *
 * This exists so the ring you can SEE and the point the arm SOLVES TO are
 * derived from one expression rather than two that happen to agree today.
 * depotIntegration.test.ts asserts they land on the same world point.
 *
 * @param alongM  port offset fore/aft of the vehicle centre, metres (+ = nose)
 * @param heightM port height above grade, metres
 * @param carHalfWidthPU half the rendered vehicle's width, PLAN UNITS
 * @param side    which flank the port presents on: -toward at a charging stall
 */
export function portInVehicleFrame(
  alongM: number, heightM: number, carHalfWidthPU: number, side: 1 | -1,
): { x: number; y: number; z: number } {
  return {
    x: side * carHalfWidthPU,
    y: DECK_Y + heightM * PLAN_UNITS_PER_METRE,
    z: alongM * PLAN_UNITS_PER_METRE,
  };
}
