/**
 * THE CHARGER CABINET AS A SOLID — the thing the arm is bolted to.
 *
 * vehicleEnvelope.ts opens by explaining why it exists:
 *
 *   "the previous footprint attempt was declared safe because 26 arm tests
 *    passed, and every one of those tests asked the arm about a plane or a
 *    point. NOTHING compared the robot to the car it works on, so a resize that
 *    swung the elbow housing through the bodywork looked clean."
 *
 * This file is that same sentence with one word changed. Until it existed the
 * word "cabinet" appeared in the arm package only inside prose comments:
 * `armClearance.ts` imported exactly one solid, `CarSolid`, and measured
 * `clearanceToCar`. The arm had no geometric knowledge of the cabinet it is
 * mounted on, so nothing could notice a pose that put a link inside it — which
 * is what produced the reported symptom of the arm briefly disappearing into
 * the cabinet mid-cycle.
 *
 * ══════════════════════════════════════════════════════ ONE SET OF NUMBERS ═══
 * The dimensions below are the SAME literals ChargingField.tsx draws the
 * cabinet from, and that file now imports them from here. Deriving the mesh and
 * the solid from one place is what makes "the arm clears the cabinet" a
 * statement about the cabinet on screen, rather than about two literals that
 * happen to agree today.
 *
 * ═══════════════════════════════════════════════════════════════ THE FRAME ═══
 * The arm base frame, as used by carSolidInArmFrame() and portInArmFrame():
 * +Z toward the vehicle, +X fore/aft along the car, +Y up, origin on the J1
 * axis at the mount plate.
 *
 * The cabinet box is drawn CENTRED on the pedestal point, and placeArm() puts
 * the arm at that same pedestal point — so in this frame the cabinet is
 * centred on the arm's own base axis and extends toward the car as well as away
 * from it. That is the geometry as built; whether it is the geometry as
 * intended is exactly what cabinetClearance.test.ts measures.
 */

import { METRES_PER_PLAN_UNIT, MOUNT_HEIGHT_M } from './cobotSpec';
import type { CarSolid } from './vehicleEnvelope';

/**
 * DCFC cabinet dimensions in PLAN UNITS, as drawn by ChargingField.tsx.
 *
 * `width` is the box's world-X extent and `depth` its world-Z extent. The arm
 * group is rotated by `toward * PI/2`, which maps arm-frame +Z onto world X —
 * so WIDTH is the extent along the arm's Z (toward/away from the car) and DEPTH
 * is the extent along the arm's X (fore/aft along the car). Getting those two
 * the wrong way round silently halves the measured intrusion, so they are named
 * for the axis they are drawn on and swapped once, explicitly, below.
 */
export const DCFC_CABINET_PU = {
  /** world-X extent of the pedestal body */
  width: 1.5,
  /** world-Y extent of the pedestal body */
  height: 3.6,
  /** world-Z extent of the pedestal body */
  depth: 0.7,
  /** the concrete pad the body sits on; the body starts at its top */
  padHeight: 0.16,
} as const;

/** L2 cabinets are smaller and carry no arm, but the renderer draws them too. */
export const L2_CABINET_PU = { width: 1.1, height: 2.8, depth: 0.7, padHeight: 0.16 } as const;

export interface CabinetDims {
  width: number; height: number; depth: number; padHeight: number;
}

/**
 * The charger cabinet, in the arm's base frame, as a `CarSolid`.
 *
 * A cabinet is a box, and `CarSolid` already expresses a box: a convex
 * silhouette in (along, height-above-grade) extruded across a lateral slab.
 * Reusing it means the cabinet is measured by the SAME `clearanceToCar` path,
 * with the same sign convention and the same conservatism, rather than by a
 * second distance function that could disagree with the first.
 *
 * `wheels` is empty and `pod` is parked a kilometre away so neither can ever
 * win the minimum — they are parts of the car shape this type was built for and
 * have no cabinet analogue.
 */
export function cabinetSolidInArmFrame(
  dims: CabinetDims = DCFC_CABINET_PU,
  mountHeight: number = MOUNT_HEIGHT_M,
): CarSolid {
  // Body sits on top of the pad, so its underside is padHeight above the deck.
  const yBottom = dims.padHeight * METRES_PER_PLAN_UNIT;
  const yTop = (dims.padHeight + dims.height) * METRES_PER_PLAN_UNIT;

  // Arm-frame X is the cabinet's world-Z extent; arm-frame Z its world-X.
  const halfAlong = (dims.depth * METRES_PER_PLAN_UNIT) / 2;
  const halfLateral = (dims.width * METRES_PER_PLAN_UNIT) / 2;

  // `profile` is in (along, HEIGHT ABOVE GRADE) — not arm-frame y — and
  // clearanceToCar converts with `p.y - gradeY`. gradeY is the deck, which sits
  // mountHeight below the arm base.
  return {
    profile: [
      [-halfAlong, yBottom],
      [ halfAlong, yBottom],
      [ halfAlong, yTop],
      [-halfAlong, yTop],
    ],
    zMin: -halfLateral,
    zMax:  halfLateral,
    wheels: [],
    pod: { along: 1000, z: 1000, radius: 0, yMin: 0, yMax: 0 },
    gradeY: -mountHeight,
  };
}

/**
 * How far the cabinet reaches TOWARD the car past the arm's own base axis,
 * metres.
 *
 * This is the number that decides whether a flank mount is different from the
 * mount we actually have. It is positive whenever the arm is placed at the
 * cabinet's centre rather than on its car-facing face — and while it is
 * positive, the arm's shoulder is inside the cabinet and the first part of
 * every reach is a sweep through it.
 */
export function cabinetIntrusionTowardCar(dims: CabinetDims = DCFC_CABINET_PU): number {
  return (dims.width * METRES_PER_PLAN_UNIT) / 2;
}
