/**
 * The 2D -> 3D transform pair, and the ONE property that binds them.
 *
 * toWorld and yawFromHeading2D are two halves of the same map, and they have
 * already drifted apart once: d879a23 negated toWorld's X to un-mirror the
 * scene but left three yaw call sites on the pre-flip formula. The result was
 * a car whose BODY pointed the opposite way to the direction it was driving —
 * visible as the nose swinging the wrong way through every east/west turn, and
 * as an entire perimeter row of parked cars facing backwards.
 *
 * The existing integration coverage (depotIntegration.test.ts) pins the car at
 * rotation.y = 0 facing NORTH — the single orientation where a mirror about the
 * north-south axis is invisible. So the tests here are deliberately weighted to
 * EAST and WEST.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { toWorld, yawFromHeading2D, yawFromCompassDeg } from './coordUtils';

/** World-space unit forward of a model whose local forward is +Z, under Ry(a). */
function forward(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

const EAST = 0;
const SOUTH = Math.PI / 2; // plan frame is y-DOWN
const WEST = Math.PI;
const NORTH = -Math.PI / 2;

describe('toWorld', () => {
  it('puts east on -X and north on +Z', () => {
    // Site-plan landmarks, from the header block in coordUtils.
    expect(toWorld({ x: 200, y: 215 }, 0)).toEqual([-50, 0, -105]); // INGRESS, east
    expect(toWorld({ x: 100, y: 215 }, 0)).toEqual([50, 0, -105]); // EGRESS, west
  });
});

describe('yawFromHeading2D', () => {
  // The mirror bug produced EXACTLY the north/south rows of this table and
  // exactly the opposite of the east/west rows.
  it.each([
    ['east', EAST, -1, 0],
    ['west', WEST, 1, 0],
    ['north', NORTH, 0, 1],
    ['south', SOUTH, 0, -1],
  ])('faces %s the same way toWorld places it', (_name, heading, fx, fz) => {
    const f = forward(yawFromHeading2D(heading));
    expect(f.x).toBeCloseTo(fx, 9);
    expect(f.z).toBeCloseTo(fz, 9);
  });

  /**
   * The invariant that makes the pair impossible to break silently: a car may
   * only move in the direction it is pointing (KinematicCar is non-holonomic),
   * so its world displacement must be PARALLEL to its world forward. A sign
   * error on either axis of toWorld, or on either argument of the atan2, drops
   * this dot product to -1 or 0.
   *
   * Swept over the full circle, not just the cardinals, because the previous
   * bug was a reflection: it left two of the four cardinals looking correct.
   */
  it('moves a car along its own nose at every heading', () => {
    const STEP = 2; // plan units
    for (let deg = 0; deg < 360; deg += 5) {
      const h = (deg * Math.PI) / 180;
      const from = { x: 150, y: 110 };
      // KinematicCar: x' = v cos θ, y' = v sin θ, in the y-DOWN plan frame.
      const to = { x: from.x + STEP * Math.cos(h), y: from.y + STEP * Math.sin(h) };

      const [ax, , az] = toWorld(from, 0);
      const [bx, , bz] = toWorld(to, 0);
      const len = Math.hypot(bx - ax, bz - az);
      const f = forward(yawFromHeading2D(h));

      expect(f.x * ((bx - ax) / len) + f.z * ((bz - az) / len), `heading ${deg}deg`)
        .toBeCloseTo(1, 9);
    }
  });

  /**
   * TwinMotionDriver.parkedHeading() noses perimeter staging OUTWARD along the
   * east-west axis — heading 0 on the east edge, PI on the west edge. Those are
   * the two headings the mirror inverted, so the whole perimeter rendered with
   * its cars facing into the lot instead of out of it. This is the founder-
   * visible case; keep it pinned separately from the sweep.
   */
  it('noses an east-edge parked car OUT of the depot, not into it', () => {
    const carGroup = new THREE.Object3D();
    const [wx, , wz] = toWorld({ x: 247, y: 110 }, 0); // TEMP/perimeter block, east side
    carGroup.position.set(wx, 0, wz);
    carGroup.rotation.y = yawFromHeading2D(EAST);
    carGroup.updateMatrixWorld(true);

    const nose = carGroup.localToWorld(new THREE.Vector3(0, 0, 1));
    // East is -X, and the lot centre is at world X = 0, so the nose must be
    // FARTHER from centre (more negative X) than the car's own position.
    expect(nose.x).toBeLessThan(wx);
    expect(nose.z).toBeCloseTo(wz, 9);
  });
});

describe('yawFromCompassDeg', () => {
  it.each([
    ['N', 0, NORTH],
    ['E', 90, EAST],
    ['S', 180, SOUTH],
    ['W', 270, WEST],
  ])('bearing %s agrees with the plan-heading form', (_n, bearing, heading) => {
    const a = forward(yawFromCompassDeg(bearing));
    const b = forward(yawFromHeading2D(heading));
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });

  it('points the east-aisle arrow east and the west-link arrow west', () => {
    expect(forward(yawFromCompassDeg(90)).x).toBeCloseTo(-1, 9); // east = -X
    expect(forward(yawFromCompassDeg(270)).x).toBeCloseTo(1, 9); // west = +X
  });
});
