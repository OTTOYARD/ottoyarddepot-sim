/**
 * Following a car from the pole: the lens never leaves the mast, the target stays one unit in front of it, and the
 * camera turns onto the car and then holds it. The bug this pins (2026-10-02, live view): following from the pole
 * rode the lens down to within a unit of the car, and stopping left it stranded at ground level.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { aimFromMast } from './followMath';
import { VIEWER_CAMS } from '@/viewer/viewerCams';

const v = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const POLE = VIEWER_CAMS.pole;

/** Follow for `frames` frames at 60 fps, called as CameraRig calls it (easing, and the target written in place). */
function follow(car: (f: number) => THREE.Vector3, frames: number, lens = v(POLE.position), target = v(POLE.target)) {
  const before = lens.clone();
  const k = 1 - Math.exp(-(1 / 60) * 6);
  const targets: THREE.Vector3[] = [];
  for (let f = 0; f < frames; f++) {
    aimFromMast(lens, target, car(f), k, target);
    targets.push(target.clone());
  }
  return { lens, before, target, targets };
}
const offAim = (lens: THREE.Vector3, target: THREE.Vector3, car: THREE.Vector3) =>
  target.clone().sub(lens).angleTo(car.clone().sub(lens));

describe('following a car from the pole', () => {
  const car = v([60, 1.5, 40]); // across the lot from the mast, on the deck

  it('never moves the lens, and keeps the target one unit in front of it', () => {
    const r0 = v(POLE.target).distanceTo(v(POLE.position));
    expect(r0).toBeCloseTo(1, 6);
    const { lens, before, targets } = follow(() => car, 240);
    expect(lens.equals(before)).toBe(true);
    for (const t of targets) expect(t.distanceTo(lens)).toBeCloseTo(r0, 9);
  });

  it('turns onto the car within a second, then holds it exactly', () => {
    const { lens, target, targets } = follow(() => car, 90);
    expect(offAim(lens, targets[0], car)).toBeGreaterThan(0.1); // it eases on; it does not snap
    expect(offAim(lens, target, car)).toBeLessThan(1e-9);
  });

  it('keeps a moving car in the middle of the picture', () => {
    // a car driving east along a lane at 10 units/s
    const driving = (f: number) => v([-80 + (10 * f) / 60, 1.5, 20]);
    const { lens, targets } = follow(driving, 600);
    for (let f = 120; f < 600; f++) expect(offAim(lens, targets[f], driving(f))).toBeLessThan(0.011);
  });

  it('looks straight down at a car under the mast, and does nothing at all for a car at the lens', () => {
    const under = v([0, 1.5, -6]);
    const a = follow(() => under, 120);
    expect(offAim(a.lens, a.target, under)).toBeLessThan(1e-9);
    expect([a.target.x, a.target.y, a.target.z].every(Number.isFinite)).toBe(true);
    const lens = v(POLE.position);
    const t = v(POLE.target);
    expect(aimFromMast(lens, t, lens.clone(), 0.1).equals(t)).toBe(true);
  });

  it('stays a direction even when asked to turn straight round', () => {
    const lens = new THREE.Vector3(0, 0, 0);
    let target = new THREE.Vector3(1, 0, 0);
    const behind = new THREE.Vector3(-5, 0, 0);
    for (let f = 0; f < 120; f++) {
      target = aimFromMast(lens, target, behind, 0.5); // even the unsafe 0.5 swing is clamped
      expect(target.length()).toBeCloseTo(1, 9);
    }
    expect(offAim(lens, target, behind)).toBeLessThan(1e-9);
    // and straight up/down, where a turn about the vertical would not help
    let t2 = new THREE.Vector3(0, -1, 0);
    for (let f = 0; f < 120; f++) t2 = aimFromMast(lens, t2, new THREE.Vector3(0, 5, 0), 0.2);
    expect(offAim(lens, t2, new THREE.Vector3(0, 5, 0))).toBeLessThan(1e-9);
  });
});
