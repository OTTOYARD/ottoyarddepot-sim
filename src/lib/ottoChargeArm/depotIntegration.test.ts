/**
 * Depot integration for the OTTO-CHARGE ARM.
 *
 * verifyIK proves the solver; verifyGeometry proves the mesh matches it. This
 * proves the third thing, which is the one that actually bit the previous arm:
 * that the arm is placed correctly IN THIS DEPOT, against this site plan, for
 * every stall it is fitted to.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateStallsV2, CANOPIES } from '@/lib/sitePlan';
import {
  placeArm, portInArmFrame, portInVehicleFrame, PEDESTAL_OFFSET_PU, ARM_MOUNT_OFFSET_PU,
} from './depotPlacement';
import { portFor } from './chargePort';
import { solveIK, forwardTCP } from './cobotIK';
import { OTTO_CHARGE_ARM, PLAN_UNITS_PER_METRE, METRES_PER_PLAN_UNIT, MOUNT_HEIGHT_M } from './cobotSpec';
import { phaseAt, chargeProgress, ROBOTIC_OVERHEAD_SECONDS, stallHasArm } from './roboticService';
import { vehicleMayMove, isTethered, NOMINAL_SEQUENCE } from './armStateMachine';
import { poseFor } from './armMotion';
import { CAR_WIDTH } from '@/engine/motion/traffic';
import { DECK_Y } from '@/components/canvas/three/coordUtils';

const spec = OTTO_CHARGE_ARM;
const CAR_HALF_WIDTH_M = (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;
const dcfc = () => generateStallsV2().filter((s) => s.type === 'dcfc');

describe('arm placement in the depot', () => {
  it('fits exactly the 10 DCFC stalls and no L2 stall', () => {
    const stalls = generateStallsV2();
    expect(stalls.filter((s) => stallHasArm(s.type))).toHaveLength(10);
    expect(stalls.filter((s) => s.type === 'l2').every((s) => !stallHasArm(s.type))).toBe(true);
  });

  it('anchors on the PEDESTAL FACE, not on the parking space and not in the cabinet', () => {
    // The previous arm used stall.position — the car's spot. ChargingField puts
    // the pedestal 4.5 plan units toward the canopy spine, and the arm bolts to
    // that cabinet's CAR-FACING FACE, ARM_MOUNT_OFFSET_PU nearer the car again.
    // Two ways to be wrong, so both are pinned: growing out of the tarmac (0),
    // and growing out of the middle of the charger (the full 4.5).
    for (const s of dcfc()) {
      const p = placeArm(s.id, s.position.x, s.position.y);
      const carWorldX = p.carWorld[0];
      const armWorldX = p.world[0];
      const gap = Math.abs(carWorldX - armWorldX);
      expect(gap).toBeCloseTo(PEDESTAL_OFFSET_PU - ARM_MOUNT_OFFSET_PU, 6);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(PEDESTAL_OFFSET_PU);
      // same row: the pedestal is beside the car, never fore or aft of it
      expect(p.world[2]).toBeCloseTo(p.carWorld[2], 6);
    }
  });

  it('faces the vehicle from whichever side of the canopy it is on', () => {
    const stalls = dcfc();
    const towards = new Set(stalls.map((s) => placeArm(s.id, s.position.x, s.position.y).toward));
    // Canopy A has two stall columns straddling the spine, so both signs must
    // occur. If they did not, one column's arms would face into empty tarmac.
    expect(towards).toEqual(new Set([1, -1]));

    for (const s of stalls) {
      const p = placeArm(s.id, s.position.x, s.position.y);
      // local +Z under Ry(theta) maps to (sin theta, 0, cos theta); it must
      // point from the pedestal toward the car.
      const fx = Math.sin(p.rotationY);
      const fz = Math.cos(p.rotationY);
      const dx = p.carWorld[0] - p.world[0];
      const dz = p.carWorld[2] - p.world[2];
      const len = Math.hypot(dx, dz);
      expect(fx * (dx / len) + fz * (dz / len)).toBeCloseTo(1, 6);
    }
  });

  it('scales metres into plan units (the toy-car bug)', () => {
    const p = placeArm('DCFC-01', CANOPIES[0].cx - 7, 88);
    expect(p.scale).toBeCloseTo(1 / 0.4785, 6);
    expect(p.scale).toBeGreaterThan(2);
    // mount height must be expressed in plan units too, and measured from the
    // asphalt DECK — the grade the vehicles' tyres rest on — not from y=0.
    expect(p.world[1]).toBeCloseTo(DECK_Y + MOUNT_HEIGHT_M * PLAN_UNITS_PER_METRE, 6);
  });
});

describe('the arm actually reaches every vehicle it is asked to serve', () => {
  it('solves exactly onto the port, entering along the port axis', () => {
    const oems = ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null, 'unknown-oem'];
    let checked = 0;
    for (const s of dcfc()) {
      const { toward } = placeArm(s.id, s.position.x, s.position.y);
      for (let i = 0; i < 12; i++) {
        for (const oem of oems) {
          const port = portFor(`veh-${s.id}-${i}`, oem);
          const target = portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, toward);
          const sol = solveIK(target, { x: 0, y: 0, z: -1 }, spec);
          expect(sol.reachable, `${s.id} ${oem} along=${port.along} h=${port.height}`).toBe(true);
          const tip = forwardTCP(sol, spec);
          expect(Math.hypot(tip.x - target.x, tip.y - target.y, tip.z - target.z)).toBeLessThan(1e-9);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(900);
  });

  /**
   * THE ONE THAT MATTERS ON CAMERA: the charge-port ring Vehicle3D draws on the
   * flank and the point ChargingArm solves its IK to must be the SAME WORLD
   * POINT. They are reached by completely different routes — one through the
   * vehicle's own frame in plan units, the other through the arm group's
   * rotate-and-scale in metres — so nothing but an assertion keeps them equal.
   *
   * This is what caught two real defects: the arm mounting off y=0 while the
   * cars rest on the 0.26 asphalt deck, and portInArmFrame passing `along`
   * through unsigned so half the stalls mated to the wrong end of the car.
   */
  it('mates the arm to the port you can actually SEE', () => {
    const CAR_HALF_W_PU = CAR_WIDTH / 2;
    const oems = ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null];
    let checked = 0;

    for (const s of dcfc()) {
      const p = placeArm(s.id, s.position.x, s.position.y);

      // How ChargingArm places the arm: group at world, Ry(rotationY), scaled.
      const armGroup = new THREE.Object3D();
      armGroup.position.set(...p.world);
      armGroup.rotation.y = p.rotationY;
      armGroup.scale.setScalar(p.scale);
      armGroup.updateMatrixWorld(true);

      // How Vehicle3D places the vehicle: at the stall, facing NORTH (world +Z),
      // which parkedHeading() gives every dcfc/l2/wash/service stall.
      const carGroup = new THREE.Object3D();
      carGroup.position.set(p.carWorld[0], 0, p.carWorld[2]);
      carGroup.rotation.y = 0;
      carGroup.updateMatrixWorld(true);

      for (const oem of oems) {
        const port = portFor(`veh-${s.id}-${oem}`, oem);

        const solved = armGroup.localToWorld(new THREE.Vector3().copy(
          portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, p.toward) as THREE.Vector3Like,
        ));
        // Vehicle3D presents the port on the flank facing the pedestal.
        const side = -p.toward as 1 | -1;
        const drawn = carGroup.localToWorld(new THREE.Vector3().copy(
          portInVehicleFrame(port.along, port.height, CAR_HALF_W_PU, side) as THREE.Vector3Like,
        ));

        expect(solved.distanceTo(drawn), `${s.id} ${oem}`).toBeLessThan(1e-9);
        // and it really is on the pedestal's side of the car, not the far flank
        expect(Math.sign(drawn.x - p.carWorld[0])).toBe(Math.sign(p.world[0] - p.carWorld[0]));
        checked++;
      }
    }
    expect(checked).toBe(70);
  });

  it('gives the same vehicle the same port every time', () => {
    const a = portFor('veh-42', 'waymo');
    const b = portFor('veh-42', 'waymo');
    expect(a).toEqual(b);
    expect(portFor('veh-43', 'waymo')).not.toEqual(a);
  });
});

describe('the connection cycle', () => {
  const DURATION = 900 + ROBOTIC_OVERHEAD_SECONDS; // a 15-minute DCFC charge

  it('walks the nominal sequence in order, with no gaps', () => {
    const seen: string[] = [];
    for (let t = 0; t <= DURATION; t += 0.25) {
      const { phase } = phaseAt(t, DURATION);
      if (seen[seen.length - 1] !== phase) seen.push(phase);
    }
    expect(seen).toEqual(NOMINAL_SEQUENCE.filter((p) => p !== 'stowed'));
  });

  it('delivers current ONLY while the connector is latched', () => {
    for (let t = 0; t <= DURATION; t += 0.5) {
      const { phase } = phaseAt(t, DURATION);
      const p = chargeProgress(t, DURATION);
      if (phase === 'unstow' || phase === 'approach' || phase === 'align' || phase === 'insert') {
        expect(p, `charging during ${phase}`).toBe(0);
      }
      if (phase === 'retract' || phase === 'clear') {
        expect(p, `still charging during ${phase}`).toBe(1);
      }
    }
  });

  it('holds the vehicle until the arm is clear — not until charging ends', () => {
    let releasedAt = -1;
    let lastTetheredAt = -1;
    for (let t = 0; t <= DURATION; t += 0.25) {
      const { phase } = phaseAt(t, DURATION);
      if (isTethered(phase)) lastTetheredAt = t;
      if (vehicleMayMove(phase) && releasedAt < 0 && t > 1) releasedAt = t;
    }
    expect(lastTetheredAt).toBeGreaterThan(0);
    expect(releasedAt).toBeGreaterThan(lastTetheredAt);
    // the gap is the physical extract + retract, not an arbitrary delay
    expect(releasedAt - lastTetheredAt).toBeGreaterThan(8);
  });

  it('never lets a vehicle move while the connector is mated', () => {
    for (let t = 0; t <= DURATION; t += 0.1) {
      const { phase } = phaseAt(t, DURATION);
      if (isTethered(phase)) expect(vehicleMayMove(phase)).toBe(false);
    }
  });

  it('fails SAFE on an unknown phase rather than releasing the vehicle', () => {
    // A prior incident in this system: one unmapped enum word aborted every
    // decision while the caller reported success. Gates here are whitelists.
    for (const junk of ['', 'unknown', 'CHARGING', 'moving', null, undefined, 'stowed ']) {
      expect(vehicleMayMove(junk as string)).toBe(false);
    }
    expect(vehicleMayMove('stowed')).toBe(true);
    expect(vehicleMayMove('clear')).toBe(true);
  });

  it('survives a service shorter than one robot cycle without emitting nonsense', () => {
    const tiny = 5; // seconds — shorter than connect+disconnect
    for (let t = 0; t <= 60; t += 0.5) {
      const { phase, t: frac } = phaseAt(t, tiny);
      expect(NOMINAL_SEQUENCE).toContain(phase);
      expect(Number.isFinite(frac)).toBe(true);
      expect(frac).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('poses are physically sane throughout a real cycle', () => {
  it('keeps every joint inside its limits and the connector out of the bodywork', () => {
    const DURATION = 1200 + ROBOTIC_OVERHEAD_SECONDS;
    const port = portFor('veh-pose', 'waymo');
    const target = {
      port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, 1),
      normal: { x: 0, y: 0, z: -1 },
    };
    const L = spec.limits;
    for (let t = 0; t <= DURATION; t += 2) {
      const { phase, t: frac } = phaseAt(t, DURATION);
      const pose = poseFor({ phase, t: frac }, target, spec);
      expect(pose.ok).toBe(true);
      const a = pose.angles;
      expect(a.j1).toBeGreaterThanOrEqual(L.j1[0]); expect(a.j1).toBeLessThanOrEqual(L.j1[1]);
      expect(a.j2).toBeGreaterThanOrEqual(L.j2[0]); expect(a.j2).toBeLessThanOrEqual(L.j2[1]);
      expect(a.j3).toBeGreaterThanOrEqual(L.j3[0]); expect(a.j3).toBeLessThanOrEqual(L.j3[1]);

      // the tip may never go PAST the flank plane except by the connector's own
      // insertion depth
      const tip = forwardTCP(a, spec);
      expect(tip.z).toBeLessThanOrEqual(target.port.z + 1e-6);
    }
  });

  it('refuses an out-of-envelope port instead of straining through the vehicle', () => {
    const target = {
      port: portInArmFrame(2.4, 0.75, CAR_HALF_WIDTH_M, 1), // way past the window
      normal: { x: 0, y: 0, z: -1 },
    };
    const pose = poseFor({ phase: 'charging', t: 0.5 }, target, spec);
    expect(pose.ok).toBe(false);
    expect(pose.engaged).toBe(false);
    // and it parks itself rather than reaching
    const tip = forwardTCP(pose.angles, spec);
    expect(tip.z).toBeLessThan(1.0);
  });
});
