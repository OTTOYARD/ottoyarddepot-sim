// ============================================================================
// siteAir.test.ts — the depot's one compressed-air plant stands in the service building, and its main reaches every
// canopy and the wash hall without crossing a yard or a building.
//
// Chase, 2026-11-16: the charge arms' heads are electric, the clean arms keep their air knives, and one compressor in the
// service building feeds them. What is asserted, and why:
//   1. The plant room stands inside the ops building's office block, inside its walls and clear of both service bays, so
//      no car and no bay's work meets it.
//   2. Its main leaves through the building's south wall and reaches each canopy's north end and the wash hall's corner,
//      in square legs, crossing neither electrical yard and no building but its own (which it leaves) and the wash hall
//      (which it ends at).
//   3. The charge arm takes no air: its cable schedule has no air line (cadCables.test.ts holds that from the parts list).
// ============================================================================
import { describe, expect, it } from 'vitest';
import { AIR_PLANT, BUILDING, CANOPIES, WASH } from './sitePlan';
import { OPS_SHELL, WALL_T } from './structurePlan';
import { AIR_PLANT_EXIT, PEAK_FREE_AIR_M3_MIN, airKeepOuts, airMains } from './siteAir';

const plant = { x0: AIR_PLANT.x, x1: AIR_PLANT.x + AIR_PLANT.w, y0: AIR_PLANT.y, y1: AIR_PLANT.y + AIR_PLANT.h };

describe('the plant room stands in the service building', () => {
  it('inside the office block\'s walls, clear of both service bays', () => {
    const office = OPS_SHELL.office!;
    expect(plant.x0).toBeGreaterThanOrEqual(office.x0 + WALL_T);
    expect(plant.x1).toBeLessThanOrEqual(office.x1 - WALL_T / 2);
    expect(plant.y0).toBeGreaterThanOrEqual(office.y0 + WALL_T);
    expect(plant.y1).toBeLessThanOrEqual(office.y1 - WALL_T);
    for (const b of OPS_SHELL.bays) expect(plant.x1 <= b.x0 || plant.x0 >= b.x1, b.id).toBe(true);
  });

  it('is big enough for a compressor, a dryer and a receiver with room to work: at least 3 x 4 m', () => {
    const M = 0.4785;
    expect(Math.min(AIR_PLANT.w, AIR_PLANT.h) * M).toBeGreaterThanOrEqual(3);
    expect(Math.max(AIR_PLANT.w, AIR_PLANT.h) * M).toBeGreaterThanOrEqual(4);
  });
});

describe('its main reaches every canopy and the wash hall', () => {
  const mains = airMains();

  it('leaves the building through its south wall, under the room', () => {
    expect(AIR_PLANT_EXIT.y).toBe(BUILDING.y + BUILDING.h);
    expect(AIR_PLANT_EXIT.x).toBeGreaterThan(plant.x0);
    expect(AIR_PLANT_EXIT.x).toBeLessThan(plant.x1);
  });

  it('one main to each of the 3 canopies, ending at its north end on its spine, and one to the wash hall', () => {
    expect(mains.map((m) => m.to)).toEqual([...CANOPIES.map((c) => `canopy ${c.id}`), 'wash hall']);
    for (const c of CANOPIES) {
      const end = mains.find((m) => m.to === `canopy ${c.id}`)!.route.at(-1)!;
      expect(end).toEqual({ x: c.cx, y: c.y });
    }
    expect(mains.at(-1)!.route.at(-1)).toEqual({ x: WASH.x, y: WASH.y + WASH.h });
  });

  it('in square legs, crossing neither electrical yard and running south of every building once out of its own', () => {
    for (const m of mains) {
      for (let i = 1; i < m.route.length; i++) {
        const a = m.route[i - 1], b = m.route[i];
        expect(a.x === b.x || a.y === b.y, `${m.to} leg ${i}`).toBe(true);
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        for (const k of airKeepOuts()) expect(x1 > k.x0 && x0 < k.x1 && y1 > k.y0 && y0 < k.y1, `${m.to} crosses the ${k.name}`).toBe(false);
        if (i > 1) expect(y0, `${m.to} leg ${i} stays south of the buildings`).toBeGreaterThanOrEqual(BUILDING.y + BUILDING.h);
      }
    }
  });

  it('every main is under 80 m, so the plant is near all it feeds', () => {
    for (const m of mains) {
      expect(m.lengthM, m.to).toBeGreaterThan(0);
      expect(m.lengthM, m.to).toBeLessThan(80);
    }
  });

  it('the clean arms could take 4.5 m3/min of free air if all 30 blew at once', () => {
    expect(PEAK_FREE_AIR_M3_MIN).toBeCloseTo(4.5, 6);
  });
});
