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
  /** the WIDE face, which runs fore/aft along the car */
  width: 1.5,
  /** world-Y extent of the pedestal body */
  height: 3.6,
  /** the SHALLOW dimension, which faces the car */
  depth: 0.7,
  /** the concrete pad the body sits on; the body starts at its top */
  padHeight: 0.16,
} as const;

/**
 * How far the cabinet's CENTRE sits behind the arm's base axis, plan units.
 *
 * Two things were wrong before this existed, and they compounded:
 *
 *  1. ORIENTATION. The box was drawn with its 1.5 pu dimension pointing at the
 *     car and its 0.7 pu dimension running fore/aft — a charger cabinet stood
 *     edge-on to the vehicle it serves. Turned ninety degrees it presents the
 *     wide face to the car, which is how a real DCFC cabinet sits in a stall,
 *     and only 0.7 pu of it lies along the arm's reach axis.
 *  2. PLACEMENT. It was drawn CENTRED on the pedestal point, and placeArm()
 *     puts the arm at that same point — so the cabinet straddled the arm's own
 *     base and the upper arm ran down the middle of it. Measured intrusion at
 *     the stowed pose: -0.1675 m, exactly half the box depth.
 *
 * Backing the centre off by this much puts the whole box behind the arm with
 * room for the shoulder drum and the upper-arm dress pack to fold over the base
 * without touching it. The value is MEASURED, not chosen — cabinetClearance
 * .test.ts sweeps it and fails if the worst moving-link clearance goes negative.
 * It must grow with ARM_SCALE, because a longer upper arm folds further back.
 */
export const CABINET_BACKSET_PU = 1.35;

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
  backsetPu: number = CABINET_BACKSET_PU,
): CarSolid {
  // Body sits on top of the pad, so its underside is padHeight above the deck.
  const yBottom = dims.padHeight * METRES_PER_PLAN_UNIT;
  const yTop = (dims.padHeight + dims.height) * METRES_PER_PLAN_UNIT;

  // ROTATED: the wide face runs fore/aft (arm-frame X), the shallow depth faces
  // the car (arm-frame Z). Before the rotation these were the other way round,
  // which is what put 0.359 m of cabinet between the arm and the vehicle.
  const halfAlong = (dims.width * METRES_PER_PLAN_UNIT) / 2;
  const halfLateral = (dims.depth * METRES_PER_PLAN_UNIT) / 2;
  // Negative: the cabinet centre sits BEHIND the arm base, away from the car.
  const centreZ = -backsetPu * METRES_PER_PLAN_UNIT;

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
    zMin: centreZ - halfLateral,
    zMax: centreZ + halfLateral,
    wheels: [],
    pod: { along: 1000, z: 1000, radius: 0, yMin: 0, yMax: 0 },
    gradeY: -mountHeight,
  };
}

/**
 * How far the cabinet reaches TOWARD the car past the arm's own base axis,
 * metres. Negative once the cabinet is properly behind the arm.
 *
 * This is the number that was silently positive: with the box centred on the
 * pedestal and its wide side facing the car it stood 0.359 m in FRONT of the
 * arm's base, so the shoulder was inside the cabinet and the first part of
 * every reach was a sweep through it. Rotated and backed off it is negative,
 * and its magnitude is the gap between the arm base and the cabinet face.
 */
export function cabinetIntrusionTowardCar(
  dims: CabinetDims = DCFC_CABINET_PU,
  backsetPu: number = CABINET_BACKSET_PU,
): number {
  return (dims.depth * METRES_PER_PLAN_UNIT) / 2 - backsetPu * METRES_PER_PLAN_UNIT;
}
