/**
 * THE CHARGER THE ARM IS BOLTED TO, IN THE ARM'S OWN FRAME.
 *
 * vehicleEnvelope.ts answers "does the robot touch the car?". This answers the
 * question nobody had asked at all: DOES THE ROBOT TOUCH THE CHARGER IT IS
 * MOUNTED ON? It did. placeArm() put the J1 axis on the pedestal's CENTRE, and
 * the DCFC cabinet is drawn 1.5 plan units (0.718 m) deep TOWARD THE CAR, so
 * the mount collar, its bolts, the cable gland, the base housing, the shoulder
 * yoke and the bottom of the upper arm all sat 0.1675 m inside the drawn box
 * for every pose of every duty cycle. cobotSpec.ts said the arm was "mounted on
 * a plinth on the pedestal's car-facing flank"; it was mounted in the middle of
 * the pedestal.
 *
 * ═══════════════════════════════════════════════════════════════ UNITS ═══════
 * METRES, like the rest of the arm package. The plan-unit box table lives with
 * the renderer (pedestalGeometry.ts) and is converted here, once.
 *
 * ═══════════════════════════════════════════════════════════════ FRAME ═══════
 * The arm base frame: origin on the J1 axis, +Z toward the vehicle, +X along
 * the car, +Y up. The pedestal therefore sits at NEGATIVE z — it is behind the
 * arm — and the two frames are related by exactly two facts:
 *
 *   - the arm group is rotated by `toward * PI/2`, which maps arm +Z to world
 *     X and arm +X to world Z, so the cabinet's world-X depth becomes its
 *     extent along the arm's WORKING direction and its world-Z width becomes
 *     the extent along the car;
 *   - the arm origin is ARM_MOUNT_OFFSET_M toward the car of the pedestal axis
 *     and MOUNT_HEIGHT_M above the deck, while the pedestal group's own origin
 *     is at world y = 0 — the earth under the curb slab, DECK_Y below the deck.
 *
 * Every box is symmetric about the pedestal axis in both world X and world Z,
 * so `toward` cancels and one solid serves all ten arms. The clearance test
 * asserts that premise rather than assuming it.
 */

import { DECK_Y } from '@/components/canvas/three/coordUtils';
import { pedestalBoxes } from '@/components/canvas/three/pedestalGeometry';
import { METRES_PER_PLAN_UNIT, ARM_MOUNT_OFFSET_M, MOUNT_HEIGHT_M } from './cobotSpec';

/** One drawn box of the pedestal, in the arm base frame, metres. */
export interface PedestalBoxM {
  name: string;
  /** Centre. */
  cx: number; cy: number; cz: number;
  /** Half-extents. */
  hx: number; hy: number; hz: number;
}

export interface PedestalSolid {
  boxes: readonly PedestalBoxM[];
}

/**
 * The pedestal the arm stands on, in the arm's base frame.
 *
 * @param offsetM     how far toward the car the J1 axis stands off the pedestal
 *                    axis. Defaults to the depot's own mount offset.
 * @param mountHeight height of the J1 axis above the deck, metres
 * @param isDC        DCFC cabinet (the only kind that carries an arm)
 */
export function pedestalSolidInArmFrame(
  offsetM: number = ARM_MOUNT_OFFSET_M,
  mountHeight: number = MOUNT_HEIGHT_M,
  isDC = true,
): PedestalSolid {
  const M = METRES_PER_PLAN_UNIT;
  const boxes: PedestalBoxM[] = [];
  for (const [name, b] of Object.entries(pedestalBoxes(isDC))) {
    boxes.push({
      name,
      // world X (the box's own first axis) -> arm z, behind the arm by `offsetM`
      cz: -offsetM, hz: (b.size[0] / 2) * M,
      // world Z -> arm x
      cx: 0, hx: (b.size[2] / 2) * M,
      // world Y -> arm y; the box table measures from world 0, the arm from the
      // deck at DECK_Y, and the arm origin is MOUNT_HEIGHT_M above that
      cy: (b.centreY - DECK_Y) * M - mountHeight, hy: (b.size[1] / 2) * M,
    });
  }
  return { boxes };
}

/**
 * Signed clearance from a point to one box, metres. Negative inside.
 *
 * Exact on both sides — the same product-set argument vehicleEnvelope.combine()
 * rests on. A box is a product of three slabs, so outside it the distance is
 * the hypotenuse of the positive per-axis excesses and inside it the depth of
 * the shallowest face.
 */
function boxClearance(p: { x: number; y: number; z: number }, b: PedestalBoxM): number {
  const dx = Math.abs(p.x - b.cx) - b.hx;
  const dy = Math.abs(p.y - b.cy) - b.hy;
  const dz = Math.abs(p.z - b.cz) - b.hz;
  if (dx <= 0 && dy <= 0 && dz <= 0) return Math.max(dx, dy, dz);
  return Math.hypot(Math.max(0, dx), Math.max(0, dy), Math.max(0, dz));
}

/**
 * Signed clearance from a point to the whole pedestal, metres.
 * Positive = clear air. Negative = inside a drawn box.
 *
 * @param p point in the ARM BASE frame, metres
 */
export function clearanceToPedestal(
  p: { x: number; y: number; z: number }, ped: PedestalSolid,
): number {
  let best = Infinity;
  for (const b of ped.boxes) {
    const d = boxClearance(p, b);
    if (d < best) best = d;
  }
  return best;
}

/** Which box a point is nearest to — for naming the offender in a failure. */
export function nearestPedestalBox(
  p: { x: number; y: number; z: number }, ped: PedestalSolid,
): string {
  let best = Infinity, name = '';
  for (const b of ped.boxes) {
    const d = boxClearance(p, b);
    if (d < best) { best = d; name = b.name; }
  }
  return name;
}
