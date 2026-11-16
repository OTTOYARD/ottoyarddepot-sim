// ============================================================================
// siteCanopy.test.ts — each fast-charger canopy's plant (its board and its vacuum producer) stands where nothing else
// does, and every line the canopy's OTTO-CLEAN ARMs take from it is measured: the arms' supply and network cables, the
// board's feed from TX-AUX and its fibre from the office, the vacuum main.
//
// Chase, 2026-11-16: "Sounds great. Yeah just keep going." on closing the clean arm's 2 open lines. What is asserted:
//   1. The plant stands under its own canopy's roof, either side of its last spine column, clear of that column's plinth
//      and of every parked car, charger cabinet and rail bed, in every charger build; the board keeps 1 m clear in front
//      of it (ASSUMPTION: the site's electrical design sets the working space). And no OTTO-CLEAN ARM can reach it.
//   2. Each of the 30 arms' cables runs from its canopy's board, up the last column's west face, along the tray on the
//      arm's own side to its drop, in square legs; its network run stays inside a twisted-pair channel's 90 m of fixed
//      cable, and its supply's drop is small.
//   3. Each board's feed leaves TX-AUX, joins the charger feeds' duct bank in the strip, crosses no building, and keeps
//      its drop under 3 %; the office's fibre reaches each board.
//   4. Each canopy's vacuum main runs from its producer up the last column's east face to both sides' farthest arms.
// (The structure set holds the plant against every recorded car: structureClearance.replay.test.ts; and the OTTO-CHARGE
// ARM's parts at every pose: armColumnClearance.test.ts.)
// ============================================================================
import { afterEach, describe, expect, it } from 'vitest';
import { CANOPIES, LIGHT_POLES, canopyPlants, generateStallsV2, type PlantBox } from './sitePlan';
import { setChargerBuild } from './chargerBuild';
import { armBedFootprints, boxGap, boxOf, cabinetFootprints, canopyColumnYs, parkedBox } from './structurePlan';
import { FEEDER_ROUTE } from './siteFeeders';
import { RISER_OFF_U, armRuns, canopyBoards, canopyKeepOuts, vacuumMains } from './siteCanopy';
import { placeCleanArm } from './ottoCleanArm/cleanArmPlacement';
import { CLEAN_ARM } from './ottoCleanArm/cleanArmSpec';

const M = 0.4785;
/** A spine column's plinth, half its side, plan units (SolarCanopy.tsx: a 2.0 u plinth). */
const PLINTH_HALF = 1.0;
/** What the plant keeps from a car, a cabinet or a rail bed, plan units (0.5 u = 0.24 m). */
const PLANT_CLEAR = 0.5;
const rect = (b: PlantBox) => ({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });

afterEach(() => { setChargerBuild('as_built'); });

describe.each(['as_built', 'dcfc20', 'dcfc30'] as const)('the %s build: each fast-charger canopy\'s plant', (build) => {
  it('stands under its canopy\'s roof, either side of its last column, clear of every car, cabinet, bed and plinth', () => {
    setChargerBuild(build);
    const stalls = generateStallsV2();
    const cabs = cabinetFootprints(stalls);
    const plants = canopyPlants();
    expect(plants.map((p) => p.canopy)).toEqual(CANOPIES.slice(0, { as_built: 1, dcfc20: 2, dcfc30: 3 }[build]).map((c) => c.id));
    const others = [
      ...stalls.map((s) => ({ what: s.id, box: parkedBox(s.position) })),
      ...cabs.map((k) => ({ what: `${k.stallId}'s cabinet`, box: k.box })),
      ...armBedFootprints(stalls).map((k) => ({ what: `${k.stallId}'s rail bed`, box: k.box })),
    ];
    for (const p of plants) {
      const c = CANOPIES.find((k) => k.id === p.canopy)!;
      const yCol = Math.max(...canopyColumnYs(c, cabs, stalls));
      const plinth = boxOf({ x0: c.cx - PLINTH_HALF, x1: c.cx + PLINTH_HALF, y0: yCol - PLINTH_HALF, y1: yCol + PLINTH_HALF });
      for (const [what, b] of [['board', p.board], ['vacuum producer', p.vacuum]] as const) {
        expect(b.x0 >= c.x && b.x1 <= c.x + c.w && b.y0 >= c.y && b.y1 <= c.y + c.h, `canopy ${c.id}'s ${what} under its roof`).toBe(true);
        expect(boxGap(boxOf(rect(b)), plinth), `canopy ${c.id}'s ${what} off the last column's plinth`).toBeGreaterThan(0);
        for (const o of others) {
          expect(boxGap(boxOf(rect(b)), o.box), `canopy ${c.id}'s ${what} vs ${o.what}`).toBeGreaterThanOrEqual(PLANT_CLEAR);
        }
      }
      expect(p.board.x1, 'the board west of the column').toBeLessThan(c.cx - PLINTH_HALF);
      expect(p.vacuum.x0, 'the producer east of it').toBeGreaterThan(c.cx + PLINTH_HALF);
      // the site's light poles (one stands just past each canopy's south end): 1 m clear of a pole's centre, its footing
      // being 0.7 u across the radius (UtilityEquipment.buildLightPoles)
      for (const l of LIGHT_POLES) {
        for (const b of [p.board, p.vacuum]) {
          const dx = Math.max(b.x0 - l.x, 0, l.x - b.x1), dy = Math.max(b.y0 - l.y, 0, l.y - b.y1);
          expect(Math.hypot(dx, dy) * M, `canopy ${c.id}'s plant vs the pole at (${l.x}, ${l.y})`).toBeGreaterThan(1);
        }
      }
      // its working space: 1 m in front of the board (north), clear of everything but the plant
      const front = boxOf({ x0: p.board.x0, x1: p.board.x1, y0: p.board.y0 - 1.0 / M, y1: p.board.y0 });
      for (const o of others) expect(boxGap(front, o.box), `the board's working space vs ${o.what}`).toBeGreaterThan(0);
      expect(boxGap(front, boxOf(rect(p.vacuum)))).toBeGreaterThan(0);
    }
  });
});

describe('the plant is out of every OTTO-CLEAN ARM\'s reach', () => {
  it('lies farther from each arm\'s J1 than its links, wand and nozzle reach', () => {
    setChargerBuild('dcfc30');
    const reachU = (CLEAN_ARM.link1.len + CLEAN_ARM.link2.len + CLEAN_ARM.wand.base + CLEAN_ARM.wand.maxExt + CLEAN_ARM.nozzle.len) / M;
    for (const s of generateStallsV2()) {
      if (s.type !== 'dcfc') continue;
      const j1 = placeCleanArm(s.position.x, s.position.y, s.position.angle, 0).j1Plan;
      for (const p of canopyPlants()) {
        for (const b of [p.board, p.vacuum]) {
          const dx = Math.max(b.x0 - j1.x, 0, j1.x - b.x1), dy = Math.max(b.y0 - j1.y, 0, j1.y - b.y1);
          expect(Math.hypot(dx, dy), `${s.id}'s arm vs canopy ${p.canopy}'s plant`).toBeGreaterThan(reachU + PLANT_CLEAR);
        }
      }
    }
  });
});

describe('each arm\'s supply and network cables, from its canopy\'s board', () => {
  const runs = armRuns();
  const plants = canopyPlants(3);

  it('one pair for each of the 30 arms, 10 to a canopy', () => {
    expect(runs.length).toBe(30);
    for (const c of CANOPIES) expect(runs.filter((r) => r.canopy === c.id).length).toBe(10);
  });

  it('out of the board\'s top, up the last column\'s west face, along the tray on the arm\'s own side to its drop', () => {
    for (const r of runs) {
      const p = plants.find((k) => k.canopy === r.canopy)!;
      const [top, , ladder, tray, drop] = r.route;
      expect(top.x).toBeGreaterThan(p.board.x0);
      expect(top.x).toBeLessThan(p.board.x1);
      expect(ladder.x).toBeCloseTo(p.cx - RISER_OFF_U, 9);
      expect(Math.sign(tray.x - p.cx), r.stall).toBe(r.side);
      expect(drop.x).toBe(tray.x);
      const s = generateStallsV2(30, 0).find((k) => k.id === r.stall)!;
      const j1 = placeCleanArm(s.position.x, s.position.y, s.position.angle, 0).j1Plan;
      expect(drop.y).toBeCloseTo(j1.y, 9);
      expect(Math.abs(tray.x - j1.x), `${r.stall}: the tray over its drop column`).toBeLessThan(0.01);
      for (let i = 1; i < r.route.length; i++) {
        const a = r.route[i - 1], b = r.route[i];
        expect(a.x === b.x || a.y === b.y, `${r.stall} leg ${i}`).toBe(true);
      }
      expect(r.riseM, 'up from the board\'s top to the tray').toBeGreaterThan(2);
    }
  });

  it('every network run stays inside a twisted-pair channel\'s 90 m of fixed cable, and every supply drops under 1 %', () => {
    // the CAD's own piece (the conduit drop and the tail in the enclosure) is under 3 m (clean_arm.py)
    for (const r of runs) {
      expect(r.networkM + 3, r.stall).toBeLessThan(90);
      expect(r.supplyDropPct, r.stall).toBeLessThan(1);
      expect(r.supplyM, r.stall).toBeGreaterThan(10);
    }
  });
});

describe('each canopy\'s board, fed from TX-AUX', () => {
  const boards = canopyBoards();

  it('leaves TX-AUX, joins the charger feeds\' duct bank in the strip, and crosses no building', () => {
    expect(boards.map((b) => b.canopy)).toEqual(['A', 'B', 'C']);
    for (const b of boards) {
      expect(b.route.some((q) => q.x === FEEDER_ROUTE.stripX && q.y === FEEDER_ROUTE.forecourtY), `${b.canopy}: under the forecourt by the strip`).toBe(true);
      for (let i = 1; i < b.route.length; i++) {
        const a = b.route[i - 1], q = b.route[i];
        expect(a.x === q.x || a.y === q.y, `${b.canopy} leg ${i}`).toBe(true);
        const x0 = Math.min(a.x, q.x), x1 = Math.max(a.x, q.x), y0 = Math.min(a.y, q.y), y1 = Math.max(a.y, q.y);
        for (const k of canopyKeepOuts()) expect(x1 > k.x0 && x0 < k.x1 && y1 > k.y0 && y0 < k.y1, `${b.canopy} crosses the ${k.name}`).toBe(false);
      }
    }
  });

  it('keeps every board\'s drop under 3 % on one conductor size, and carries 10 arms and their producer', () => {
    expect(new Set(boards.map((b) => b.conductor)).size).toBe(1);
    for (const b of boards) {
      expect(b.dropPct, b.canopy).toBeLessThan(3);
      expect(b.loadKw, b.canopy).toBeCloseTo(10 * (2.4 + 3.0), 9);
      expect(b.feedM).toBeGreaterThan(b.routeM);
    }
  });

  it('takes the office\'s fibre, which is past a copper channel\'s 100 m to the farther boards', () => {
    for (const b of boards) expect(b.netM).toBeGreaterThan(0);
    expect(Math.max(...boards.map((b) => b.netM))).toBeGreaterThan(100);
  });
});

describe('each canopy\'s vacuum main', () => {
  it('runs from its producer up the last column to both sides\' farthest arms', () => {
    const mains = vacuumMains();
    expect(mains.map((v) => v.canopy)).toEqual(['A', 'B', 'C']);
    // at least the two sides' runs from the column line to the farthest row (2 x 74 u), and not much more
    for (const v of mains) {
      expect(v.routeM, v.canopy).toBeGreaterThan(2 * 70 * M);
      expect(v.routeM, v.canopy).toBeLessThan(120);
      expect(v.riseM, v.canopy).toBeGreaterThan(2);
    }
  });
});
