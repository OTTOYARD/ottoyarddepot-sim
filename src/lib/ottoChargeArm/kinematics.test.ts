/**
 * Kinematics guarantees for the OTTO-CHARGE ARM.
 *
 * These run in CI so the guarantees stay true. Two of them exist specifically
 * because they caught real defects during the build:
 *
 *   - "mesh agrees with maths" caught a constant 55 mm bias, where the mount
 *     plinth was displacing the kinematic origin the IK solves against. The
 *     solver was perfect and the arm still missed every port by 55 mm.
 *   - "connector enters along the port axis" caught a wrist architecture that
 *     could not physically aim the connector where the solver claimed. Three
 *     parallel pitch joints trap the tool axis in the arm's plane, so
 *     perpendicular insertion only worked when the port was exactly abeam.
 *     That is what the spherical wrist is for.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCobot } from './buildCobot';
import { solveIK, forwardTCP, STOWED, type Vec3, type JointAngles } from './cobotIK';
import {
  OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M, METRES_PER_PLAN_UNIT,
  SERVICE_WINDOW, maxReach, ARM_SCALE,
} from './cobotSpec';
import { CAR_WIDTH } from '@/engine/motion/traffic';
import { poseFor } from './armMotion';
import { phaseAt, ROBOTIC_OVERHEAD_SECONDS } from './roboticService';

const spec = OTTO_CHARGE_ARM;
const CAR_HALF_W = (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;
const FLANK = PEDESTAL_TO_CAR_CENTRE_M - CAR_HALF_W;
const d3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('inverse kinematics', () => {
  it('closes the loop exactly: solve -> forward -> same point', () => {
    let n = 0, worst = 0;
    for (let along = -1.05; along <= 1.05; along += 0.15) {
      for (let h = 0.35; h <= 1.45; h += 0.1) {
        const port: Vec3 = { x: along, y: h - MOUNT_HEIGHT_M, z: FLANK };
        const sol = solveIK(port, { x: 0, y: 0, z: -1 }, spec);
        if (!sol.reachable) continue;
        worst = Math.max(worst, d3(forwardTCP(sol, spec), port));
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-9);
  });

  it('covers the advertised service window', () => {
    for (const along of [SERVICE_WINDOW.alongMin + 0.02, 0, SERVICE_WINDOW.alongMax - 0.02]) {
      for (const h of [0.55, 0.75, 1.05]) {
        const sol = solveIK({ x: along, y: h - MOUNT_HEIGHT_M, z: FLANK }, { x: 0, y: 0, z: -1 }, spec);
        expect(sol.reachable, `along=${along} h=${h}`).toBe(true);
      }
    }
  });

  it('reports out-of-reach instead of straining', () => {
    const far = solveIK({ x: 2.5, y: 0.05, z: FLANK }, { x: 0, y: 0, z: -1 }, spec);
    expect(far.reachable).toBe(false);
    expect(far.reason).toBe('too_far');
  });

  it('cannot serve a port on the far flank — the orchestration constraint', () => {
    // A pedestal arm would have to sweep over the vehicle. It must not pretend
    // it can: OTTO-Q has to assign a stall whose robot is on the port's side.
    const farFlank = PEDESTAL_TO_CAR_CENTRE_M + CAR_HALF_W;
    const sol = solveIK({ x: 0, y: 0.72 - MOUNT_HEIGHT_M, z: farFlank }, { x: 0, y: 0, z: -1 }, spec);
    expect(sol.reachable).toBe(false);
    expect(sol.wristDistance).toBeGreaterThan(spec.upperArm + spec.forearm);
  });

  it('has reach consistent with its own spec', () => {
    expect(maxReach(spec)).toBeCloseTo(spec.upperArm + spec.forearm + spec.wrist + spec.tool, 9);
  });

  /**
   * ARM_SCALE exists to make the robot legible on camera, and legibility has no
   * natural stopping point — the next person to be told "make it bigger" has no
   * reason to suspect there is a wall. There is.
   *
   * chargePort.ts, roboticService.ts and the backend stall gate all rest on the
   * claim that a pedestal arm CANNOT serve the far flank. Scale the arm past
   * ~1.59 and that stops being true: the robot can sweep over the car, the
   * "present your inlet to the charger" constraint quietly evaporates, and
   * OTTO-Q is enforcing a rule its hardware no longer needs. Nothing else in
   * the suite would notice, because every other test asks about the NEAR flank.
   *
   * So the ceiling is recomputed here from the spec instead of trusted from a
   * comment, and it is checked against the WHOLE far-flank port band rather
   * than the single abeam point the test above uses.
   */
  it('stays under the scale at which it could reach ACROSS the vehicle', () => {
    const farFlank = PEDESTAL_TO_CAR_CENTRE_M + CAR_HALF_W;
    const toolLen = spec.wrist + spec.tool;

    // closest any far-flank port in the service band brings the wrist centre
    let closest = Infinity;
    for (let a = SERVICE_WINDOW.alongMin; a <= SERVICE_WINDOW.alongMax + 1e-9; a += 0.02) {
      for (let h = SERVICE_WINDOW.heightMin; h <= SERVICE_WINDOW.heightMax + 1e-9; h += 0.02) {
        const wcz = farFlank - toolLen;
        const up = (h - MOUNT_HEIGHT_M) - spec.shoulderHeight;
        closest = Math.min(closest, Math.hypot(Math.hypot(a, wcz), up));
      }
    }

    const twoLink = spec.upperArm + spec.forearm;
    expect(
      closest,
      `ARM_SCALE=${ARM_SCALE} lets the arm reach the FAR flank — that breaks the ` +
      `orchestration constraint in chargePort.ts, not just the look. Scale down.`,
    ).toBeGreaterThan(twoLink);

    // and say how much room is left, so the next bump is an informed one
    const headroom = ARM_SCALE * (closest / twoLink);
    expect(headroom).toBeGreaterThan(ARM_SCALE);
    expect(headroom).toBeLessThan(1.75); // ~1.59 today; a sanity bound on the maths
  });
});

describe('built geometry agrees with the analytic model', () => {
  const rig = buildCobot(spec, { withPlinth: true, lod: 'studio' });
  const scene = new THREE.Scene();
  scene.add(rig.root);

  const pose = (a: JointAngles) => {
    rig.j1.rotation.set(0, a.j1, 0);
    rig.j2.rotation.set(a.j2, 0, 0);
    rig.j3.rotation.set(a.j3, 0, 0);
    rig.j4.rotation.set(0, a.j4, 0);
    rig.j5.rotation.set(a.j5, 0, 0);
    rig.j6.rotation.set(0, a.j6, 0);
    scene.updateMatrixWorld(true);
  };
  const tcpWorld = (): Vec3 => {
    const v = new THREE.Vector3();
    rig.tcp.getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  };

  it('mesh TCP matches forwardTCP over the pose space', () => {
    let worst = 0, n = 0;
    for (const j1 of [-0.7, 0, 0.6]) {
      for (const j2 of [-0.3, 0.4, 1.1]) {
        for (const j3 of [0.4, 1.3, 2.0]) {
          for (const j4 of [-1.0, 0, 0.9]) {
            for (const j5 of [-0.8, 0.5, 1.2]) {
              const a: JointAngles = { j1, j2, j3, j4, j5, j6: 0 };
              pose(a);
              worst = Math.max(worst, d3(tcpWorld(), forwardTCP(a, spec)));
              n++;
            }
          }
        }
      }
    }
    expect(n).toBe(243);
    expect(worst).toBeLessThan(1e-9);
  });

  it('the connector lands on the port AND enters along the port axis', () => {
    for (const [along, h] of [[0, 0.55], [0, 1.05], [0.9, 0.72], [-0.9, 0.72], [1.05, 0.9]] as const) {
      const port: Vec3 = { x: along, y: h - MOUNT_HEIGHT_M, z: FLANK };
      const sol = solveIK(port, { x: 0, y: 0, z: -1 }, spec);
      expect(sol.reachable).toBe(true);
      pose(sol);
      expect(d3(tcpWorld(), port)).toBeLessThan(1e-9);

      // insertion axis must be +Z (straight into the flank), not merely nearby
      const q = new THREE.Quaternion();
      rig.tcp.getWorldQuaternion(q);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(axis.z).toBeGreaterThan(1 - 1e-9);
    }
  });

  it('stows clear of the vehicle envelope', () => {
    pose(STOWED);
    const box = new THREE.Box3().setFromObject(rig.root);
    expect(box.max.z).toBeLessThan(FLANK);
  });

  /**
   * The arm hangs off a 0.70 m plinth and reaches DOWN to low ports. Every
   * centimetre added by ARM_SCALE is a centimetre closer to the tarmac, and an
   * elbow sunk through the deck is the kind of thing that only shows up on
   * camera at one specific phase of one specific port height. Sweeping the
   * whole duty cycle is cheap; noticing it in a screenshot is not.
   */
  it('never dips below grade at any point in the duty cycle', () => {
    const DURATION = 900 + ROBOTIC_OVERHEAD_SECONDS;
    let lowest = Infinity;
    let worst = '';
    for (const h of [SERVICE_WINDOW.heightMin + 0.06, 0.75, SERVICE_WINDOW.heightMax - 0.06]) {
      for (const along of [SERVICE_WINDOW.alongMin + 0.06, 0, SERVICE_WINDOW.alongMax - 0.06]) {
        const target = { port: { x: along, y: h - MOUNT_HEIGHT_M, z: FLANK }, normal: { x: 0, y: 0, z: -1 } };
        for (let t = 0; t <= DURATION; t += 6) {
          const r = phaseAt(t, DURATION);
          const p = poseFor({ phase: r.phase, t: r.t, elapsed: t }, target, spec);
          pose(p.angles);
          const y = new THREE.Box3().setFromObject(rig.root).min.y;
          if (y < lowest) { lowest = y; worst = `${r.phase} h=${h} along=${along}`; }
        }
      }
    }
    // arm frame origin sits at MOUNT_HEIGHT_M above the deck
    expect(MOUNT_HEIGHT_M + lowest, `lowest at ${worst}`).toBeGreaterThan(0.05);
  });

  it('depot LOD keeps the kinematics identical while shedding meshes', () => {
    const studio = buildCobot(spec, { lod: 'studio' });
    const depot = buildCobot(spec, { lod: 'depot' });
    const count = (r: THREE.Object3D) => {
      let n = 0;
      r.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
      return n;
    };
    expect(count(depot.root)).toBeLessThan(count(studio.root) / 2);

    // same joint chain, same TCP offset — LOD must not move the working point
    const s = new THREE.Scene(); s.add(depot.root);
    const a: JointAngles = { j1: 0.3, j2: 0.5, j3: 1.2, j4: 0.2, j5: 0.7, j6: 0 };
    depot.j1.rotation.set(0, a.j1, 0);
    depot.j2.rotation.set(a.j2, 0, 0);
    depot.j3.rotation.set(a.j3, 0, 0);
    depot.j4.rotation.set(0, a.j4, 0);
    depot.j5.rotation.set(a.j5, 0, 0);
    s.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    depot.tcp.getWorldPosition(v);
    expect(d3({ x: v.x, y: v.y, z: v.z }, forwardTCP(a, spec))).toBeLessThan(1e-9);
  });
});
