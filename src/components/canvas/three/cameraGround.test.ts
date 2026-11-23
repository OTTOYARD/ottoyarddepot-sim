import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { keepAboveGround, LENS_FLOOR_Y, TARGET_FLOOR_Y, MAX_POLAR } from './cameraGround';
import { CAMERA_PRESETS } from './cameraPresets';
import { DECK_Y } from './coordUtils';
import { CURB_H } from './cityPlan';
import { VIEWER_CAMS } from '@/viewer/viewerCams';

const v = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

/** The depot view's camera (DepotScene3D): fov 45, near 1. */
function depotCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 6500);
  cam.updateProjectionMatrix();
  return cam;
}

/** The orbit controls as DepotScene3D sets them up, without a page to listen to. */
function depotControls(cam: THREE.PerspectiveCamera, position: number[], target: number[]): OrbitControls {
  cam.position.set(position[0], position[1], position[2]);
  const c = new OrbitControls(cam);
  c.target.set(target[0], target[1], target[2]);
  c.enableDamping = false;
  c.maxPolarAngle = MAX_POLAR;
  c.minDistance = 5;
  c.maxDistance = 300;
  c.update();
  return c;
}

/** One frame as the depot view plays it: the controls move the camera (-1), then the ground floors apply (-0.5). */
function frame(c: OrbitControls, cam: THREE.PerspectiveCamera) {
  c.update();
  if (keepAboveGround(cam.position, c.target)) cam.lookAt(c.target);
}

/** The lowest world y of the camera's near plane: the part of the view that could cut into the ground. */
function nearPlaneLowestY(cam: THREE.PerspectiveCamera): number {
  cam.updateMatrixWorld();
  let low = Infinity;
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) low = Math.min(low, new THREE.Vector3(x, y, -1).unproject(cam).y);
  return low;
}

describe('the camera never goes under the ground (Chase, 2026-11-18)', () => {
  it('leaves every preset, viewer camera and follow shot exactly where it was', () => {
    const shots = [
      ...Object.values(CAMERA_PRESETS).map((p) => [p.position, p.target] as const),
      ...Object.values(VIEWER_CAMS).map((p) => [p.position, p.target] as const),
      // CameraRig's follow: the target rides 1.5u over the car on the deck, the lens up to 48u back
      [[30, 20, -40], [0, DECK_Y + 1.5, 0]] as const,
    ];
    for (const [p, t] of shots) {
      const lens = v(p), target = v(t);
      expect(keepAboveGround(lens, target)).toBe(false);
      expect(lens.toArray()).toEqual([...p]);
      expect(target.toArray()).toEqual([...t]);
    }
  });

  it('stops a pan at the ground: lens and target move up together, so the view keeps its angle', () => {
    const lens = new THREE.Vector3(10, 4, -30), target = new THREE.Vector3(12, -3, 5);
    const before = lens.clone().sub(target);
    expect(keepAboveGround(lens, target)).toBe(true);
    expect(target.y).toBe(TARGET_FLOOR_Y);
    expect(lens.clone().sub(target).distanceTo(before)).toBeLessThan(1e-9);
  });

  it('swings a low lens up its own orbit: same distance, same compass direction, standing on the floor', () => {
    const target = new THREE.Vector3(5, 0, 5);
    const lens = new THREE.Vector3(5 + 12, 0.19, 5 - 9); // a zoom at a low angle put it in the asphalt
    const r = lens.distanceTo(target);
    const bearing = Math.atan2(lens.x - target.x, lens.z - target.z);
    expect(keepAboveGround(lens, target)).toBe(true);
    expect(lens.y).toBeCloseTo(LENS_FLOOR_Y, 12);
    expect(lens.distanceTo(target)).toBeCloseTo(r, 9);
    expect(Math.atan2(lens.x - target.x, lens.z - target.z)).toBeCloseTo(bearing, 12);
  });

  it('holds the lens at or above the floor through orbiting to level, zooming all the way in, and panning down', () => {
    const cam = depotCamera();
    const bird = CAMERA_PRESETS['Bird Eye'];
    const c = depotControls(cam, [...bird.position], [...bird.target]);
    let lowestLens = Infinity, lowestTarget = Infinity;
    const watch = () => { lowestLens = Math.min(lowestLens, cam.position.y); lowestTarget = Math.min(lowestTarget, c.target.y); };
    // orbit down to level with the target, then zoom in to the closest the controls allow
    c.setPolarAngle(Math.PI); // asks for under the target: the orbit gives level at most
    frame(c, cam); watch();
    for (let i = 0; i < 200; i++) { c.dollyIn(); frame(c, cam); watch(); } // the wheel's step (0.95 a notch)
    expect(cam.position.distanceTo(c.target)).toBeCloseTo(5, 6);
    // pan straight down through the deck, as a screen-space pan at a low angle does
    for (let i = 0; i < 40; i++) {
      c.target.y -= 0.5; cam.position.y -= 0.5;
      frame(c, cam); watch();
    }
    expect(lowestLens).toBeGreaterThanOrEqual(LENS_FLOOR_Y - 1e-9);
    expect(lowestTarget).toBeGreaterThanOrEqual(TARGET_FLOOR_Y - 1e-9);
    expect(nearPlaneLowestY(cam)).toBeGreaterThan(DECK_Y);
  });

  it('does not creep outward while a drag holds the camera at the floor', () => {
    const cam = depotCamera();
    const c = depotControls(cam, [0, 20, -40], [0, 0, 0]);
    c.setPolarAngle(Math.PI);
    frame(c, cam);
    const r0 = cam.position.distanceTo(c.target);
    for (let i = 0; i < 600; i++) { c.setPolarAngle(Math.PI); frame(c, cam); } // ten seconds of a held drag at 60 fps
    expect(cam.position.distanceTo(c.target)).toBeCloseTo(r0, 9);
    expect(cam.position.y).toBeCloseTo(LENS_FLOOR_Y, 9);
  });

  it('keeps the near plane above the deck, the floors and the city curbs at every pitch, from the lowest lens', () => {
    const cam = depotCamera();
    for (let deg = 0; deg <= 90; deg += 1) {
      const p = (deg * Math.PI) / 180;
      cam.position.set(0, LENS_FLOOR_Y, 0);
      cam.lookAt(0, LENS_FLOOR_Y - Math.sin(p), Math.cos(p));
      expect(nearPlaneLowestY(cam)).toBeGreaterThan(Math.max(DECK_Y, CURB_H));
    }
  });
});
