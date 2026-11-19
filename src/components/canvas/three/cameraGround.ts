import * as THREE from 'three';
import { DECK_Y } from './coordUtils';

/**
 * THE CAMERA NEVER GOES UNDER THE GROUND (Chase, 2026-11-18): "If you move the camera too low, you can see underneath
 * the depot itself. This needs to be fixed so the furthest you can pan and move the camera around at the lowest point
 * is just parallel to ground level. Not below it."
 *
 * Three ways took the lens under the asphalt, and the orbit limit (polar <= 87.8 degrees from the target) stopped none
 * of them, because it limits the ANGLE to the target and the target itself could go anywhere:
 *   1. a pan: OrbitControls pans in screen space, so a pan "down" at a low angle carried the target, and the lens with
 *      it, straight down through the deck;
 *   2. a zoom at a low angle: every preset aims at y = 0, which is 0.26u UNDER the lot's deck (DECK_Y), and at
 *      87.8 degrees and the closest zoom (5u) the lens stood at y 0.19, inside the asphalt;
 *   3. the lens just above the deck: the near plane is 1u in front of the lens and 0.41u tall each side of centre, so a
 *      lens lower than about 1u over the deck clips the deck and shows what is under it.
 *
 * So two floors, applied after the orbit controls move the camera and before the frame is drawn
 * (CameraRig, useFrame priority -0.5):
 *   - the TARGET (the point the camera orbits) stays at or above the ground (TARGET_FLOOR_Y). A pan that would take it
 *     lower moves lens and target up together, so the view keeps its angle and the pan just stops at the ground.
 *   - the LENS stays at or above LENS_FLOOR_Y, 1.2u (0.57 m) over the deck: low enough for a ground-level shot, high
 *     enough that the near plane never reaches the deck at any pitch the orbit allows (it reaches 0.41u under the lens
 *     when the view is level, and the orbit never looks up). A lens that would go lower swings up its own orbit to the
 *     floor: same distance from the target, same compass direction, only a steeper look down. It keeps its distance
 *     so that holding a drag at the floor does not creep the camera outward, frame after frame.
 * And the orbit allows a view down to level with the target, and no lower (MAX_POLAR = 90 degrees): at the lowest
 * point the view is parallel to the ground.
 *
 * A view choice only: nothing in the world reads it. No preset, viewer camera or follow shot is under either floor, so
 * none of them moves (cameraGround.test.ts checks every one).
 */

/** The lowest the camera's target may stand: the ground (the grass, the road, the city). The lot's deck is 0.26u above it. */
export const TARGET_FLOOR_Y = 0;
/** The lowest the camera's lens may stand: 1.2u (0.57 m) over the lot's deck. */
export const LENS_FLOOR_Y = DECK_Y + 1.2;
/** The orbit's lowest view: level with the target (90 degrees from straight down), never under it. */
export const MAX_POLAR = Math.PI / 2;

const OFF = new THREE.Vector3();

/**
 * Keep the camera above the ground: move `lens` and `target` in place so neither is under its floor. Returns whether
 * either moved. A camera above both floors is left exactly as it is.
 */
export function keepAboveGround(lens: THREE.Vector3, target: THREE.Vector3): boolean {
  let moved = false;
  // 1. the target: a pan stops at the ground (lens and target move together, so the view keeps its angle)
  if (target.y < TARGET_FLOOR_Y) {
    const up = TARGET_FLOOR_Y - target.y;
    target.y += up;
    lens.y += up;
    moved = true;
  }
  // 2. the lens: up its own orbit to the floor, at the same distance from the target and the same compass direction
  if (lens.y < LENS_FLOOR_Y) {
    const off = OFF.copy(lens).sub(target);
    const r = off.length();
    const rise = LENS_FLOOR_Y - target.y; // how far above the target the lens must stand (> 0: the target is under the floor)
    const flat = Math.hypot(off.x, off.z);
    if (rise < r && flat > 1e-9) {
      // on the same sphere: the horizontal part shrinks as the lens rises
      const keep = Math.sqrt(r * r - rise * rise) / flat;
      lens.set(target.x + off.x * keep, LENS_FLOOR_Y, target.z + off.z * keep);
    } else {
      // too close to the target to reach the floor on its sphere (only a lens within 1.5u of a target on the ground),
      // or straight under it: stand at the floor, keeping the horizontal place
      lens.y = LENS_FLOOR_Y;
    }
    moved = true;
  }
  return moved;
}
