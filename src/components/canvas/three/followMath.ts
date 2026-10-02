import * as THREE from 'three';

/**
 * Following a car from the live view's pole camera (src/viewer): the lens stays on its mast and the camera turns to
 * keep the car in view, as a camera on a pole would.
 *
 * Every other camera rides with the car it follows (CameraRig moves the lens and the target together). From the mast
 * a ride is wrong: the pole's target sits one unit in front of the lens and the pole allows no zoom or pan, so riding
 * carried the lens down off the mast to within a unit of the car, and left it stranded at ground level when following
 * stopped (seen in Chromium on a recorded run, 2026-10-02).
 *
 * So only the target moves: it swings toward the car, staying as far in front of the lens as it was. `k` (0..1) is how
 * far it swings this frame; once the camera is within ~0.6° of the car it holds the car exactly. The lens is never
 * written. Returns `out`, which may be `target` itself (every read of `target` comes before the write).
 */
export function aimFromMast(
  lens: THREE.Vector3, target: THREE.Vector3, car: THREE.Vector3, k: number, out = new THREE.Vector3(),
): THREE.Vector3 {
  const r = target.distanceTo(lens) || 1;
  const want = WANT.copy(car).sub(lens);
  if (want.lengthSq() < 1e-9) return out.copy(target); // the car is at the lens: nothing to turn toward
  want.setLength(r);
  const have = HAVE.copy(target).sub(lens);
  const angle = have.angleTo(want);
  if (angle < HOLD_RAD) return out.copy(lens).add(want);
  // A blend of two opposite directions passes through zero and has no direction. The pole looks down at a car on the
  // deck, so that cannot happen there; the function stays total anyway: first turn a little about an axis across the
  // look, and never swing more than 0.45 of the way in one frame (a blend of 0.5 between opposites is the zero vector).
  if (angle > Math.PI - HOLD_RAD) have.applyAxisAngle(Math.abs(have.y) > 0.99 * r ? ACROSS : UP, 0.05);
  have.lerp(want, Math.min(Math.max(k, 0), 0.45)).setLength(r);
  return out.copy(lens).add(have);
}

/** Within this angle the pole holds the car exactly instead of easing toward it. */
const HOLD_RAD = 0.01;
const UP = new THREE.Vector3(0, 1, 0);
const ACROSS = new THREE.Vector3(1, 0, 0);
const WANT = new THREE.Vector3();
const HAVE = new THREE.Vector3();
