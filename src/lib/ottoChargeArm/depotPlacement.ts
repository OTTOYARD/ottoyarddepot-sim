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
import { PLAN_UNITS_PER_METRE, MOUNT_HEIGHT_M } from './cobotSpec';

/** Lateral offset from the car's centreline to its charger pedestal, plan units. */
export const PEDESTAL_OFFSET_PU = 4.5;

/** 2D -> 3D, matching src/components/canvas/three/coordUtils.ts exactly. */
function toWorld(x2d: number, y2d: number): [number, number] {
  return [150 - x2d, 110 - y2d];
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
  const canopy = CANOPIES.reduce(
    (best, c) => (Math.abs(c.cx - stallX) < Math.abs(best.cx - stallX) ? c : best),
    CANOPIES[0],
  );
  const toward = ((Math.sign(canopy.cx - stallX) || 1) as 1 | -1);

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
    world: [pwx, MOUNT_HEIGHT_M * PLAN_UNITS_PER_METRE, pwz],
    toward,
    rotationY,
    scale: PLAN_UNITS_PER_METRE,
    carWorld: [cwx, 0, cwz],
  };
}

/**
 * The charge port in the ARM'S BASE FRAME, in METRES — the frame solveIK wants.
 *
 * Arm base frame: +Z toward the vehicle, +X along the vehicle's length, +Y up.
 * The vehicle's length runs along plan-Y (world Z), and the arm's local +X maps
 * to world Z, so a port's along-car offset feeds straight into base-frame X.
 *
 * @param alongM  port offset fore/aft of the vehicle centre, metres
 * @param heightM port height above grade, metres
 * @param carHalfWidthM half the rendered vehicle's width, metres
 */
export function portInArmFrame(
  alongM: number, heightM: number, carHalfWidthM: number,
): { x: number; y: number; z: number } {
  const pedestalToCentre = PEDESTAL_OFFSET_PU / PLAN_UNITS_PER_METRE; // 2.153 m
  return {
    x: alongM,
    y: heightM - MOUNT_HEIGHT_M,
    z: pedestalToCentre - carHalfWidthM,
  };
}
