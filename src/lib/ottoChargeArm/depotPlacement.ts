/**
 * Where each OTTO-CHARGE ARM sits in the depot, and where it has to reach.
 *
 * This is the file that gets the units right. Everything else in the arm
 * package is metres; the depot renderer is PLAN UNITS at 0.4785 m/unit. The
 * conversion happens here and nowhere else.
 *
 * It also fixes the anchoring bug in the previous arm: the old component placed
 * the arm at `stall.position`, which is where the CAR parks. The arm belongs on
 * the charger pedestal, PEDESTAL_OFFSET_PU to the side of the car. The arms
 * were growing out of the middle of the parking spaces instead of off the
 * chargers.
 *
 * ═══════════════════════════════════════════ HEAD-IN, SINCE 2026-09-28 ═══
 * A DCFC stall is perpendicular HEAD-IN (sitePlan.chargingStalls): the car lies
 * east-west, nose toward its canopy's spine. The pedestal stands on the car's
 * SOUTH side, abeam the car's centre, PEDESTAL_OFFSET_PU from its centreline —
 * in the 11.8u between neighbouring cars, where a car turning in or backing out
 * never sweeps (the turn's centre is on that side, so the body passes outside).
 *
 * In the ARM'S OWN FRAME nothing changed: base on the pedestal, +Z at the car's
 * flank, the same standoff and the same fore/aft service window. The arm was
 * rotated 90° in the world with the car, so every clearance and reach figure in
 * cobotSpec.ts still describes the arm as built. (It used to stand beside a car
 * parked facing north, toward the canopy spine.)
 */

import { CANOPIES } from '@/lib/sitePlan';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import { PLAN_UNITS_PER_METRE, MOUNT_HEIGHT_M, PEDESTAL_OFFSET_PU } from './cobotSpec';

/** Lateral offset from the car's centreline to its charger pedestal, plan units. */
// Re-exported so existing importers keep working; the value lives in
// cobotSpec.ts, which is where the clearance sweep that sets it also lives.
export { PEDESTAL_OFFSET_PU };

/** 2D -> 3D, matching src/components/canvas/three/coordUtils.ts exactly. */
function toWorld(x2d: number, y2d: number): [number, number] {
  return [150 - x2d, 110 - y2d];
}

/**
 * Which way a charging stall's car faces, as a plan-x sign: toward its canopy's
 * centre spine. +1 => the car's nose points plan EAST (the west column, compass
 * 90); -1 => plan WEST (the east column, compass 270). Canopy A's two stall
 * columns sit at cx-7 and cx+7, so both signs occur in a single canopy.
 *
 * ONE RULE for the arm, the cabinet, the L2 post and the VEHICLE's visible
 * charge port, so they cannot drift apart. The port presents on the car's
 * vehicle-frame -toward flank (portInVehicleFrame), which for a head-in car is
 * its SOUTH flank on both columns: the flank the DCFC pedestal stands on, and
 * the flank an L2 cable runs along.
 */
export function towardFor(stallX: number): 1 | -1 {
  const canopy = CANOPIES.reduce(
    (best, c) => (Math.abs(c.cx - stallX) < Math.abs(best.cx - stallX) ? c : best),
    CANOPIES[0],
  );
  return (Math.sign(canopy.cx - stallX) || 1) as 1 | -1;
}

/**
 * The pedestal point (arm base axis) for a DCFC stall, PLAN coordinates: abeam
 * the parked car's centre, PEDESTAL_OFFSET_PU to its south (plan y is
 * south-positive). The cabinet stands CABINET_BACKSET_PU further south of it.
 */
export function pedestalPlanPoint(stallX: number, stallY: number): { x: number; y: number } {
  return { x: stallX, y: stallY + PEDESTAL_OFFSET_PU };
}

export interface ArmPlacement {
  stallId: string;
  /** Arm base (J1 axis) in depot world coordinates, plan units. */
  world: [number, number, number];
  /**
   * The stall's facing sign (towardFor): +1 => the car's nose points plan east
   * (world -X), -1 => plan west (world +X). It fixes which way the car's
   * fore/aft axis runs through the arm's base frame (portInArmFrame).
   */
  toward: 1 | -1;
  /** Yaw so the arm's local +Z points at the parked vehicle: north, i.e. 0. */
  rotationY: number;
  /** Uniform scale converting the metre-authored arm into plan units. */
  scale: number;
  /** Car centre in world coords, plan units — the frame the port hangs off. */
  carWorld: [number, number, number];
}

/**
 * Resolve placement for one charging stall.
 *
 * The pedestal is SOUTH of the car on both columns (pedestalPlanPoint), so the
 * car always lies toward world +Z of it (toWorld maps plan y to 110 - y) and the
 * arm faces north: Ry(0) sends local +Z to world +Z.
 */
export function placeArm(
  stallId: string, stallX: number, stallY: number,
): ArmPlacement {
  const toward = towardFor(stallX);

  const ped = pedestalPlanPoint(stallX, stallY);
  const [pwx, pwz] = toWorld(ped.x, ped.y);
  const [cwx, cwz] = toWorld(stallX, stallY);

  return {
    stallId,
    // Mount height is measured from GRADE, and grade in this renderer is the
    // asphalt deck at DECK_Y — not y=0, which is the earth under the curb slab.
    // Measuring from 0 put the arm 0.26 units low relative to the cars, which
    // only became visible once the vehicle grew a charge port to aim at.
    world: [pwx, DECK_Y + MOUNT_HEIGHT_M * PLAN_UNITS_PER_METRE, pwz],
    toward,
    rotationY: 0,
    scale: PLAN_UNITS_PER_METRE,
    carWorld: [cwx, DECK_Y, cwz],
  };
}

/**
 * The charge port in the ARM'S BASE FRAME, in METRES — the frame solveIK wants.
 *
 * Arm base frame: +Z toward the vehicle, +X along the arm's mount, +Y up.
 *
 * THE SIGN ON X IS NOT COSMETIC. The arm faces north unrotated, so base-frame
 * +X is world +X, which is plan WEST. A car whose nose points plan east
 * (toward = +1) therefore has its nose toward base-frame -X, and one whose nose
 * points plan west (toward = -1) toward +X: x = -toward * along. Passing
 * `alongM` through unsigned mirrors the target fore/aft on half the stalls, and
 * the arm plugs into the tail of a car whose inlet is at the nose. Nothing
 * catches that by eye — the service window is symmetric, so the IK still solves;
 * it does not solve the right point. depotIntegration.test.ts is what catches it.
 *
 * (The same expression held for the pull-alongside layout this replaced: there
 * the arm was yawed toward*90° and the car faced north. Both rotations and the
 * car's heading moved together, so the sign did not.)
 *
 * @param alongM  port offset fore/aft of the vehicle centre, metres (+ = nose)
 * @param heightM port height above grade, metres
 * @param carHalfWidthM half the rendered vehicle's width, metres
 * @param toward  the stall's facing sign, from placeArm()/towardFor()
 */
export function portInArmFrame(
  alongM: number, heightM: number, carHalfWidthM: number, toward: 1 | -1,
): { x: number; y: number; z: number } {
  const pedestalToCentre = PEDESTAL_OFFSET_PU / PLAN_UNITS_PER_METRE; // 2.871 m
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
 * The vehicle model is authored nose-along-local-+Z, +Y up, so local -X is the
 * car's RIGHT flank and +X its LEFT. At a charging stall the port presents on
 * the flank facing its charger: -toward, which for a head-in car on either
 * column is its south flank (west column faces east: right = south; east
 * column faces west: left = south). The fore/aft offset runs straight down
 * local +Z whatever way the car faces.
 *
 * This exists so the ring you can SEE and the point the arm SOLVES TO are
 * derived from one expression rather than two that happen to agree today.
 * depotIntegration.test.ts asserts they land on the same world point, with the
 * car at its real parked heading.
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
