import { describe, it, expect } from 'vitest';
import {
  BAY_PADS, BUILDING, CANOPIES, COLLECTOR_PAINT, LOT, NORTH_LANE_Y, PARK_RUNS, SOUTH_LANE_Y, WASH,
} from './sitePlan';
import { OPS_SHELL, WASH_SHELL } from './structurePlan';
import { buildDepotLanes } from '@/engine/motion/LaneGraph';

/**
 * THE TWO COLLECTORS ARE CENTRED, AND THE BAYS' PADS ARE AS LONG AS THE BUILDINGS (Chase, 2026-11-18):
 *   "The driving lanes between the end of the charging stall column and the service and wash bays, and the driving
 *    lanes between the ingress/egress side of the site and that sides end of the charging stall columns are not
 *    centered, and are rather very close to the ends of the charging stall columns. That needs to be centered and
 *    equidistant."
 *   "Concrete colored pads in front and behind bays on the ground isn't even compared to the building lengths."
 *
 * Before: the north collector's paint ran from y 66.0 to 80.4, 10u from the bays' doors and 0.4u INTO the canopies'
 * north end; the south collector's from 165.6 to 180.0, 1.6u from the canopies' south end and 11u from the south
 * rows' carports.
 */

const G = buildDepotLanes();
/** How far a directed lane's paint reaches from the road's centreline: its drive line's offset plus half a lane. */
const reach = (lane: string) => G.offsetOf(lane) + G.rightOffset;

const canopyNorth = Math.min(...CANOPIES.map((c) => c.y));
const canopySouth = Math.max(...CANOPIES.map((c) => c.y + c.h));
const doors = BUILDING.y + BUILDING.h; // the bays' south (front) doors
const southRows = PARK_RUNS.filter((r) => /^S\d$/.test(r.id));
const carports = Math.min(...southRows.map((r) => r.carport!.y)); // the south rows' carports, their north edge

describe('the collectors are centred between what they run between', () => {
  it('paint as wide as the lanes the cars drive (sitePlan.COLLECTOR_PAINT is LaneGraph\'s)', () => {
    // the north collector: eastbound beside the canopies (south), westbound toward the bays (north)
    expect(reach('NW>Ng0')).toBeCloseTo(COLLECTOR_PAINT.canopySide, 9);
    expect(reach('Ng0>NW')).toBeCloseTo(COLLECTOR_PAINT.farSide, 9);
    // the south collector: westbound beside the canopies (north), eastbound toward the south rows (south)
    expect(reach('Sg0>SW')).toBeCloseTo(COLLECTOR_PAINT.canopySide, 9);
    expect(reach('SW>Sg0')).toBeCloseTo(COLLECTOR_PAINT.farSide, 9);
    // every stretch of each collector, not only its west end
    for (const [a, b] of [['Ng1', 'Ng2'], ['Tn', 'NE']]) {
      expect(reach(`${a}>${b}`)).toBeCloseTo(COLLECTOR_PAINT.canopySide, 9);
      expect(reach(`${b}>${a}`)).toBeCloseTo(COLLECTOR_PAINT.farSide, 9);
    }
    for (const [a, b] of [['Sg1', 'Sg2'], ['Ts', 'SE']]) {
      expect(reach(`${b}>${a}`)).toBeCloseTo(COLLECTOR_PAINT.canopySide, 9);
      expect(reach(`${a}>${b}`)).toBeCloseTo(COLLECTOR_PAINT.farSide, 9);
    }
  });

  it('the north collector stands as far from the bays\' doors as from the canopies\' north end', () => {
    const north = NORTH_LANE_Y - reach('Ng0>NW'), south = NORTH_LANE_Y + reach('NW>Ng0');
    const toDoors = north - doors, toCanopies = canopyNorth - south;
    expect(toDoors).toBeCloseTo(toCanopies, 9);
    expect(toDoors).toBeGreaterThan(4); // 4.8u (2.3 m) each side
    // the bays' doors: both buildings' front walls are one line
    expect(WASH.y + WASH.h).toBe(doors);
  });

  it('the south collector stands as far from the canopies\' south end as from the south rows\' carports', () => {
    const north = SOUTH_LANE_Y - reach('Sg0>SW'), south = SOUTH_LANE_Y + reach('SW>Sg0');
    const toCanopies = north - canopySouth, toCarports = carports - south;
    expect(toCanopies).toBeCloseTo(toCarports, 9);
    expect(toCanopies).toBeGreaterThan(6); // 6.3u (3.0 m) each side
    // the three south rows' carports start on one line
    expect(new Set(southRows.map((r) => r.carport!.y)).size).toBe(1);
  });
});

describe('the concrete pads at the bays are exactly as long as the row of buildings', () => {
  const west = Math.min(OPS_SHELL.footprint.x0, WASH_SHELL.footprint.x0);
  const east = Math.max(OPS_SHELL.footprint.x1, WASH_SHELL.footprint.x1);

  it('front and rear run from the operations building\'s west wall to the wash hall\'s east wall', () => {
    for (const pad of [BAY_PADS.front, BAY_PADS.rear]) {
      expect(pad.x0).toBe(west);
      expect(pad.x1).toBe(east);
    }
    expect([west, east]).toEqual([70, 212]);
  });

  it('the front pad runs from the doors to the north collector\'s paint, the rear pad from the lot\'s edge to the doors', () => {
    expect(BAY_PADS.front.y0).toBe(OPS_SHELL.footprint.y1);
    expect(BAY_PADS.front.y0).toBe(WASH_SHELL.footprint.y1);
    expect(BAY_PADS.front.y1).toBeCloseTo(NORTH_LANE_Y - reach('Ng0>NW'), 9);
    expect(BAY_PADS.rear.y0).toBe(LOT.y);
    expect(BAY_PADS.rear.y1).toBe(OPS_SHELL.footprint.y0);
    expect(BAY_PADS.rear.y1).toBe(WASH_SHELL.footprint.y0);
  });
});
