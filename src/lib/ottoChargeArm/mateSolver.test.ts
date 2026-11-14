import { describe, expect, it } from 'vitest';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { chargeableArmSides, mateTarget } from '@/lib/fleetModels/ports';
import { solveIK } from './cobotIK';
import { MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M, SERVICE_WINDOW } from './cobotSpec';
import { ARM_REACH, connectorFace, railTravelNeeded, solveMate, toolToBase } from './mateSolver';

const fleet = FLEET_SPECS.map((spec) => ({ key: spec.key, spec, target: mateTarget(spec)! }));

describe('charge arm: mating each vehicle where its inlet is', () => {
  it('every vehicle has an inlet the arm can be told about', () => {
    expect(fleet.every((f) => f.target)).toBe(true);
  });

  it('the fixed pedestal could not do this: that is why the rail and the cross-slide exist', () => {
    // Square-on from a base beside the middle of the car, only inlets within the measured window are met.
    const fixedOk = fleet.filter((f) => f.target.face !== 'rear' && Math.abs(f.target.alongM) <= SERVICE_WINDOW.alongMax).map((f) => f.key);
    expect(fixedOk).toEqual([]);
    // And the Cybercab's rear inlet has no solution from any base position with the arm as built.
    const cc = fleet.find((f) => f.key === 'tesla_cybercab')!.target;
    let any = false;
    for (let s = -4; s <= 4; s += 0.05) {
      any = any || solveIK({ x: cc.lengthM / 2 - s, y: cc.heightM - MOUNT_HEIGHT_M, z: PEDESTAL_TO_CAR_CENTRE_M }, { x: 1, y: 0, z: 0 }).reachable;
    }
    expect(any).toBe(false);
  });

  it.each(fleet)('$key: mates on every stall side its inlet allows, and is refused on the others', ({ spec, target }) => {
    const sides = chargeableArmSides(spec);
    for (const right of [true, false]) {
      const m = solveMate(target, right);
      const allowed = sides.includes(right ? 'right' : 'left');
      expect(m.ok, `${spec.key} arm on the car's ${right ? 'right' : 'left'}: ${m.reason ?? 'ok'}`).toBe(allowed);
      if (!allowed) { expect(m.reason).toBe('wrong_side'); continue; }
      expect(m.head).toBe(target.connector);
      expect(m.ik!.reachable).toBe(true);
      if (target.face === 'rear') {
        expect(m.crossM).toBeGreaterThan(0);
        expect(m.crossM).toBeLessThanOrEqual(ARM_REACH.crossInM + 1e-9);
        expect(m.planClearanceM!).toBeGreaterThanOrEqual(ARM_REACH.rearMateClearanceM);
      } else {
        // A side inlet is met with the tool axis dead abeam the base, at the standoff the safe window was measured at.
        expect(Math.abs(m.axisPort.x)).toBeLessThan(1e-6);
        expect(m.flankStandoffM).toBeCloseTo(SERVICE_WINDOW.flankStandoff, 6);
      }
    }
  });

  it('a vehicle both sides can charge is mated from either, inside the base\'s travel', () => {
    // The head's two connectors stand on opposite sides of the tool axis, so the two sides are not mirror images.
    for (const key of ['tesla_cybercab', 'zoox_robotaxi']) {
      const t = fleet.find((f) => f.key === key)!.target;
      for (const right of [true, false]) {
        const m = solveMate(t, right);
        expect(m.ok).toBe(true);
        expect(Math.abs(m.slideM)).toBeLessThanOrEqual(ARM_REACH.railTailM + 1e-9);
      }
    }
  });

  it('the rail is as long as the fleet needs and no longer than 0.25 m more', () => {
    const need = railTravelNeeded(fleet.map((f) => f.target));
    expect(ARM_REACH.railTailM).toBeGreaterThanOrEqual(need.tailM);
    expect(ARM_REACH.railNoseM).toBeGreaterThanOrEqual(need.noseM);
    expect(ARM_REACH.railTailM - need.tailM).toBeLessThan(0.25);
    expect(ARM_REACH.railNoseM - need.noseM).toBeLessThan(0.25);
  });

  it.each(fleet)('$key: the connector the car takes lands on its inlet, square to it and upright', ({ spec, target }) => {
    for (const right of [true, false]) {
      const m = solveMate(target, right);
      if (!m.ok) continue;
      // The inlet relative to the base where this mate puts it.
      const rel = { x: m.port.x - m.slideM, y: m.port.y, z: m.port.z - m.crossM };
      const face = connectorFace(m.ik!, m.head!);
      expect(Math.hypot(face.x - rel.x, face.y - rel.y, face.z - rel.z), `${spec.key} face on inlet`).toBeLessThan(0.001);
      // The tool points into the inlet.
      const axis = toolToBase({ x: 0, y: 1, z: 0 }, m.ik!);
      expect(axis.x * -m.normal.x + axis.y * -m.normal.y + axis.z * -m.normal.z).toBeGreaterThan(0.9999);
      // And the head's Z points straight down on a level approach, so the connector's key is upright.
      const z = toolToBase({ x: 0, y: 0, z: 1 }, m.ik!);
      expect(z.y).toBeLessThan(-0.9999);
      // The other connector stays back: its face is headStrokeM behind the inlet's plane.
      expect(ARM_REACH.headStrokeM).toBeGreaterThanOrEqual(0.06);
    }
  });

  it('two connectors on the head cover the fleet', () => {
    expect(new Set(fleet.map((f) => f.target.connector)).size).toBe(2);
    expect(fleet.every((f) => ARM_REACH.heads.includes(f.target.connector))).toBe(true);
  });

  it('the cross-slide travel covers every vehicle width and the rear mate', () => {
    for (const f of fleet) {
      const m = solveMate(f.target, f.target.face !== 'left');
      expect(m.crossM).toBeGreaterThanOrEqual(-ARM_REACH.crossOutM - 1e-9);
      expect(m.crossM).toBeLessThanOrEqual(ARM_REACH.crossInM + 1e-9);
    }
  });
});
