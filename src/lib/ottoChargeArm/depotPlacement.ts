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
 * ═══════════════════════════════════════════ ANGLED, SINCE 2026-09-28 ═══
 * A charger stall is ANGLED 60° to its gap lane (sitePlan.chargingStalls): the
 * car points north-east on a canopy's west column, north-west on its east
 * column. The pedestal stands on the car's charge-port flank — the SOUTH-side
 * flank on both columns — abeam the car's centre, PEDESTAL_OFFSET_PU from its
 * centreline, square to the car: in the band between neighbouring cars, where a
 * car turning in or backing out never sweeps.
 *
 * In the ARM'S OWN FRAME nothing changed: base on the pedestal, +Z at the car's
 * flank, the same standoff and the same fore/aft service window. The arm turns
 * with the car (placeArm's rotationY), so every clearance and reach figure in
 * cobotSpec.ts still describes the arm as built. (It stood beside a car parked
 * facing north until 2026-09-28, and briefly beside a car at 90° to its lane.)
 */

import { CANOPIES, chargerStallFrame } from '@/lib/sitePlan';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import { PLAN_UNITS_PER_METRE, MOUNT_HEIGHT_M, PEDESTAL_OFFSET_PU } from './cobotSpec';
import {
  CABINET_BACKSET_PU, L2_POST_ALONG_PU, L2_POST_LATERAL_PU, DCFC_CABINET_PU, L2_CABINET_PU, dcfcPadSpan,
} from './cabinetEnvelope';

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
 * vehicle-frame -toward flank (portInVehicleFrame), which for an angled car is
 * its SOUTH-side flank on both columns (portFlank): the flank the DCFC pedestal
 * and the L2 post stand on.
 */
export function towardFor(stallX: number): 1 | -1 {
  const canopy = CANOPIES.reduce(
    (best, c) => (Math.abs(c.cx - stallX) < Math.abs(best.cx - stallX) ? c : best),
    CANOPIES[0],
  );
  return (Math.sign(canopy.cx - stallX) || 1) as 1 | -1;
}

/**
 * The plan unit vector from a charger car's centreline out to its charge-port
 * flank (the flank its charger stands on): the car's right on a west column
 * (toward = +1), its left on an east column. Square to the car whatever its
 * bearing — for a 60° stall that is south-south-east / south-south-west.
 */
export function portFlank(stallX: number, bearing: number): { x: number; y: number } {
  const { right } = chargerStallFrame(bearing);
  const t = towardFor(stallX);
  return { x: t * right.x, y: t * right.y };
}

/**
 * The pedestal point (arm base axis) for a DCFC stall, PLAN coordinates: abeam
 * the parked car's centre, PEDESTAL_OFFSET_PU out on its charge-port flank. The
 * cabinet stands CABINET_BACKSET_PU further out along the same line.
 */
export function pedestalPlanPoint(stallX: number, stallY: number, bearing: number): { x: number; y: number } {
  const f = portFlank(stallX, bearing);
  return { x: stallX + f.x * PEDESTAL_OFFSET_PU, y: stallY + f.y * PEDESTAL_OFFSET_PU };
}

/**
 * Where a charger stall's cabinet stands and which way it faces, PLAN coordinates —
 * the one statement ChargingField draws, structurePlan.cabinetFootprints measures
 * cars against, and the 2D plan marks:
 *   - DCFC: CABINET_BACKSET_PU behind the OTTO-CHARGE ARM's pedestal, on the car's
 *     charge-port flank, abeam its centre;
 *   - L2: beside the car's front quarter on the same flank (L2_POST_ALONG_PU,
 *     L2_POST_LATERAL_PU).
 * `face` is the plan unit vector from the cabinet toward its car, square to the car;
 * `along` is the car's forward direction. The cabinet's wide face runs along `along`
 * and its screen, holster and car-facing side face `face`.
 */
export function chargerCabinet(
  type: 'dcfc' | 'l2', stallX: number, stallY: number, bearing: number,
): { x: number; y: number; face: { x: number; y: number }; along: { x: number; y: number } } {
  const f = portFlank(stallX, bearing);
  const { fwd } = chargerStallFrame(bearing);
  const face = { x: -f.x, y: -f.y };
  if (type === 'dcfc') {
    const out = PEDESTAL_OFFSET_PU + CABINET_BACKSET_PU;
    return { x: stallX + f.x * out, y: stallY + f.y * out, face, along: fwd };
  }
  return {
    x: stallX + fwd.x * L2_POST_ALONG_PU + f.x * L2_POST_LATERAL_PU,
    y: stallY + fwd.y * L2_POST_ALONG_PU + f.y * L2_POST_LATERAL_PU,
    face, along: fwd,
  };
}

/**
 * A charger's PAD — its whole footprint on the deck, PLAN coordinates: the body
 * plus 0.4u on the car-facing axis and 0.3u along the car. A DCFC pad also carries
 * the OTTO-CHARGE ARM's riser and the bridge into the cabinet (cabinetEnvelope
 * ARM_MOUNT_PU): cabinet, trunk and arm are one unit on one pad, so it runs from
 * behind the cabinet to just past the arm (dcfcPadSpan). The one footprint
 * ChargingField pours, the 2D plan draws and structurePlan drives cars against.
 * `hl` is the half-length along the car (`along`), `hw` the half-width square to
 * it (`face`, toward the car); `th` is the along axis's plan angle.
 */
export function chargerPad(
  type: 'dcfc' | 'l2', stallX: number, stallY: number, bearing: number,
): { cx: number; cy: number; hl: number; hw: number; th: number; offset: number } {
  const k = chargerCabinet(type, stallX, stallY, bearing);
  const dims = type === 'dcfc' ? DCFC_CABINET_PU : L2_CABINET_PU;
  const span = type === 'dcfc' ? dcfcPadSpan() : { back: -(dims.depth / 2 + 0.4), front: dims.depth / 2 + 0.4 };
  // `offset`: the pad centre's distance from the cabinet centre toward the car
  const offset = (span.back + span.front) / 2;
  return {
    cx: k.x + k.face.x * offset, cy: k.y + k.face.y * offset,
    hl: (dims.width + 0.6) / 2, hw: (span.front - span.back) / 2,
    th: Math.atan2(k.along.y, k.along.x), offset,
  };
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
  /** Yaw so the arm's local +Z points at the parked vehicle, square to its flank. */
  rotationY: number;
  /** Uniform scale converting the metre-authored arm into plan units. */
  scale: number;
  /** Car centre in world coords, plan units — the frame the port hangs off. */
  carWorld: [number, number, number];
}

/**
 * Resolve placement for one charging stall.
 *
 * The pedestal stands on the car's charge-port flank (pedestalPlanPoint), and the
 * arm is yawed so its local +Z runs from the pedestal to the car's centre: Ry(φ)
 * sends local +Z to world (sin φ, 0, cos φ), so φ = atan2(ΔX, ΔZ) of that vector
 * in world coordinates. For a car at 90° to its lane that is 0 (the arm faces
 * north); at 60° it is ±30°.
 */
export function placeArm(
  stallId: string, stallX: number, stallY: number, bearing: number,
): ArmPlacement {
  const toward = towardFor(stallX);

  const ped = pedestalPlanPoint(stallX, stallY, bearing);
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
    rotationY: Math.atan2(cwx - pwx, cwz - pwz),
    scale: PLAN_UNITS_PER_METRE,
    carWorld: [cwx, DECK_Y, cwz],
  };
}

/**
 * The charge port in the ARM'S BASE FRAME, in METRES — the frame solveIK wants.
 *
 * Arm base frame: +Z toward the vehicle, +X along the arm's mount, +Y up.
 *
 * THE SIGN ON X IS NOT COSMETIC. The arm's +Z runs from the pedestal to the
 * car along the port flank's normal, toward*right in plan; base-frame +X is
 * then plan -toward*forward — AFT for a west-column car (toward = +1), FORE for
 * an east-column one. So a port `along` toward the nose sits at
 * x = -toward * along, at every bearing. Passing `alongM` through unsigned
 * mirrors the target fore/aft on half the stalls, and the arm plugs into the
 * tail of a car whose inlet is at the nose. Nothing catches that by eye — the
 * service window is symmetric, so the IK still solves; it does not solve the
 * right point. depotIntegration.test.ts is what catches it.
 *
 * (The same expression held for the pull-alongside and the perpendicular
 * layouts before this one: the arm's yaw and the car's heading always move
 * together, so the sign does not.)
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
 * the flank facing its charger: -toward, which on either column is its
 * south-side flank (portFlank: a west-column car faces north-east, so its right
 * is south-south-east; an east-column car faces north-west, so its left is
 * south-south-west). The fore/aft offset runs straight down local +Z whatever
 * way the car faces.
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
