/**
 * Depot integration for the OTTO-CHARGE ARM.
 *
 * verifyIK proves the solver; verifyGeometry proves the mesh matches it. This
 * proves the third thing, which is the one that actually bit the previous arm:
 * that the arm is placed correctly IN THIS DEPOT, against this site plan, for
 * every stall it is fitted to.
 */

import { describe, it, expect } from 'vitest';
import { generateStallsV2, CANOPIES } from '@/lib/sitePlan';
import { placeArm, portInArmFrame, PEDESTAL_OFFSET_PU } from './depotPlacement';
import { portFor } from './chargePort';
import { solveIK, forwardTCP } from './cobotIK';
import { OTTO_CHARGE_ARM, PLAN_UNITS_PER_METRE, METRES_PER_PLAN_UNIT, MOUNT_HEIGHT_M } from './cobotSpec';
import { phaseAt, chargeProgress, ROBOTIC_OVERHEAD_SECONDS, stallHasArm } from './roboticService';
import { vehicleMayMove, isTethered, NOMINAL_SEQUENCE } from './armStateMachine';
import { poseFor } from './armMotion';

const spec = OTTO_CHARGE_ARM;
const CAR_HALF_WIDTH_M = (2.2 * (7.5 / 4.9) * METRES_PER_PLAN_UNIT) / 2;
const dcfc = () => generateStallsV2().filter((s) => s.type === 'dcfc');

describe('arm placement in the depot', () => {
  it('fits exactly the 10 DCFC stalls and no L2 stall', () => {
    const stalls = generateStallsV2();
    expect(stalls.filter((s) => stallHasArm(s.type))).toHaveLength(10);
    expect(stalls.filter((s) => s.type === 'l2').every((s) => !stallHasArm(s.type))).toBe(true);
  });

  it('anchors on the PEDESTAL, not on the parking space', () => {
    // The previous arm used stall.position — the car's spot. ChargingField puts
    // the pedestal 4.5 plan units toward the canopy spine. They must differ by
    // exactly that, or the arms are growing out of the tarmac again.
    for (const s of dcfc()) {
      const p = placeArm(s.id, s.position.x, s.position.y);
      const carWorldX = p.carWorld[0];
      const armWorldX = p.world[0];
      expect(Math.abs(carWorldX - armWorldX)).toBeCloseTo(PEDESTAL_OFFSET_PU, 6);
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
    // mount height must be expressed in plan units too
    expect(p.world[1]).toBeCloseTo(MOUNT_HEIGHT_M * PLAN_UNITS_PER_METRE, 6);
  });
});

describe('the arm actually reaches every vehicle it is asked to serve', () => {
  it('solves exactly onto the port, entering along the port axis', () => {
    const oems = ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null, 'unknown-oem'];
    let checked = 0;
    for (const s of dcfc()) {
      for (let i = 0; i < 12; i++) {
        for (const oem of oems) {
          const port = portFor(`veh-${s.id}-${i}`, oem);
          const target = portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M);
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
      port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M),
      normal: { x: 0, y: 0, z: -1 },
    };
    const L = spec.limits;
    for (let t = 0; t <= DURATION; t += 2) {
      const { phase, t: frac } = phaseAt(t, DURATION);
      const pose = poseFor({ phase, t: frac, elapsed: t }, target, spec);
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
      port: portInArmFrame(2.4, 0.75, CAR_HALF_WIDTH_M), // way past the window
      normal: { x: 0, y: 0, z: -1 },
    };
    const pose = poseFor({ phase: 'charging', t: 0.5, elapsed: 0 }, target, spec);
    expect(pose.ok).toBe(false);
    expect(pose.engaged).toBe(false);
    // and it parks itself rather than reaching
    const tip = forwardTCP(pose.angles, spec);
    expect(tip.z).toBeLessThan(1.0);
  });
});
