/**
 * The memo predicate that decides whether a car's 3D badge redraws.
 *
 * This is the whole of FIX B2. The founder reported that state of charge never
 * increases in the 3D view. The twin read path was checked three times and is
 * sound — the SoC really was climbing. What was not climbing was the RENDER:
 * the predicate bucketed SoC into 5-percentage-point steps, so the badge (which
 * prints Math.round(soc)) kept showing whatever the value was at the last bucket
 * crossing. Watch a car for a few minutes of a DCFC charge and you see a number
 * that does not move.
 *
 * A memo predicate is display logic wearing perf clothing, and nothing else in
 * the suite can see it. Hence this file.
 */

import { describe, it, expect } from 'vitest';
import { vehicleRenderEqual } from './Vehicle3D';
import type { Vehicle } from '@/engine/types';

function car(over: Partial<Vehicle> = {}): { vehicle: Vehicle } {
  return {
    vehicle: {
      id: 'twin-sim-026',
      status: 'charging',
      assignedStall: 'DCFC-01',
      oem: 'waymo',
      currentSoC: 40,
      ...over,
    } as Vehicle,
  };
}

describe('vehicleRenderEqual', () => {
  it('redraws for a ONE point SoC change — the precision the badge prints', () => {
    // Under the old Math.round(soc / 5) predicate this returned true (no redraw)
    // for every step below, which is the frozen-SoC report.
    expect(vehicleRenderEqual(car({ currentSoC: 40 }), car({ currentSoC: 41 }))).toBe(false);
    expect(vehicleRenderEqual(car({ currentSoC: 41 }), car({ currentSoC: 42 }))).toBe(false);
    expect(vehicleRenderEqual(car({ currentSoC: 42 }), car({ currentSoC: 43 }))).toBe(false);
  });

  it('redraws across a whole charging climb, not just at bucket boundaries', () => {
    // 40 -> 46 is six real points. Math.round(40/5)=8 and Math.round(46/5)=9, so
    // the old predicate allowed exactly ONE redraw across the entire climb.
    let redraws = 0;
    for (let soc = 40; soc < 46; soc++) {
      if (!vehicleRenderEqual(car({ currentSoC: soc }), car({ currentSoC: soc + 1 }))) redraws++;
    }
    expect(redraws).toBe(6);
  });

  it('still skips the redraw when nothing the car draws has changed', () => {
    // The predicate is a PERF gate as well; sub-point jitter on a 132-car roster
    // must not force a fleet-wide re-render every twin poll.
    expect(vehicleRenderEqual(car({ currentSoC: 40.1 }), car({ currentSoC: 40.3 }))).toBe(true);
    expect(vehicleRenderEqual(car(), car())).toBe(true);
  });

  it('redraws when the port or the paint could move', () => {
    expect(vehicleRenderEqual(car(), car({ id: 'twin-sim-027' }))).toBe(false);
    expect(vehicleRenderEqual(car(), car({ status: 'staging' }))).toBe(false);
    expect(vehicleRenderEqual(car(), car({ assignedStall: 'DCFC-02' }))).toBe(false);
    expect(vehicleRenderEqual(car(), car({ oem: 'zoox' }))).toBe(false);
  });
});
