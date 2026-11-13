import { describe, expect, it } from 'vitest';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { chargeableArmSides, mateTarget } from '@/lib/fleetModels/ports';
import { solveIK } from './cobotIK';
import { MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M, SERVICE_WINDOW } from './cobotSpec';
import { ARM_REACH, railTravelNeeded, solveMate } from './mateSolver';

const fleet = FLEET_SPECS.map((spec) => ({ key: spec.key, spec, target: mateTarget(spec)! }));

describe('charge arm: mating each vehicle where its inlet is', () => {
  it('every vehicle has an inlet the arm can be told about', () => {
    expect(fleet.every((f) => f.target)).toBe(true);
  });

  it('the fixed pedestal could not do this: that is why the rail and the telescope exist', () => {
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
        expect(m.extendM).toBeGreaterThan(0);
        expect(m.extendM).toBeLessThanOrEqual(ARM_REACH.telescopeM + 1e-9);
        expect(m.planClearanceM!).toBeGreaterThanOrEqual(ARM_REACH.rearMateClearanceM);
      } else {
        // A side inlet is met dead abeam the base, with the forearm at its fixed length.
        expect(Math.abs(m.port.x - m.slideM)).toBeLessThan(1e-9);
        expect(m.extendM).toBe(0);
      }
    }
  });

  it('left and right stalls mirror each other for a vehicle both can charge', () => {
    for (const key of ['tesla_cybercab', 'zoox_robotaxi']) {
      const t = fleet.find((f) => f.key === key)!.target;
      const r = solveMate(t, true);
      const l = solveMate(t, false);
      expect(l.extendM).toBeCloseTo(r.extendM, 6);
      if (t.face === 'rear') expect(l.slideM).toBeCloseTo(-r.slideM, 6);
    }
  });

  it('the rail is as long as the fleet needs and no longer than 0.25 m more', () => {
    const need = railTravelNeeded(fleet.map((f) => f.target));
    expect(ARM_REACH.railTailM).toBeGreaterThanOrEqual(need.tailM);
    expect(ARM_REACH.railNoseM).toBeGreaterThanOrEqual(need.noseM);
    expect(ARM_REACH.railTailM - need.tailM).toBeLessThan(0.25);
    expect(ARM_REACH.railNoseM - need.noseM).toBeLessThan(0.25);
  });

  it('two connectors on the head cover the fleet', () => {
    expect(new Set(fleet.map((f) => f.target.connector)).size).toBe(2);
    expect(fleet.every((f) => ARM_REACH.heads.includes(f.target.connector))).toBe(true);
  });

  it('reports each side mate\'s flank standoff, because the safe window was measured at one', () => {
    for (const f of fleet) {
      const m = solveMate(f.target, f.target.face !== 'left');
      // Within 0.1 m of the standoff the window was measured at, for every vehicle in the fleet.
      expect(Math.abs(m.flankStandoffM - SERVICE_WINDOW.flankStandoff)).toBeLessThan(0.1);
    }
  });
});
