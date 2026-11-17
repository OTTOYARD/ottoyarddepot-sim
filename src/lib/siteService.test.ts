// The service bays' OTTO-TIRE feeds, held to the site plan and to the code rules siteService.ts quotes.
import { describe, expect, it } from 'vitest';
import { AUX_TRANSFORMER, BESS_YARD, BUILDING, SERVICE_BAY_XS, TX_YARD } from './sitePlan';
import { OPS_SHELL } from './structurePlan';
import {
  AMPACITY_75C, SERVICE_LOADS, SERVICE_ONE_LINE, SERVICE_TRAY, TX_AUX, dropPctAmps, faultKa, loadAmps, portalSupplyAmps,
  robotSupplyAmps, serviceBayFeeds, serviceDesignAmps,
} from './siteService';
import { awgMm2 } from './siteCanopy';
import { CABINETS } from './ottoTire/tireSpec';
import { TIRE_BAY } from './ottoTire/tireBayFit';

describe('siteService: each service bay\'s feed from TX-AUX', () => {
  const feeds = serviceBayFeeds();

  it('feeds both service bays, each cabinet inside its own bay against the north wall', () => {
    expect(feeds.map((f) => f.bay)).toEqual([1, 2]);
    const bays = OPS_SHELL.bays.filter((b) => b.kind === 'service');
    feeds.forEach((f, i) => {
      expect(f.cabinet.x).toBeGreaterThan(bays[i].x0);
      expect(f.cabinet.x).toBeLessThan(bays[i].x);
      expect(f.cabinet.y).toBeGreaterThan(BUILDING.y);
      // the cabinet's west side stands inside the bay's half from its drive line to its partition
      expect((SERVICE_BAY_XS[i] - f.cabinet.x) * 0.4785 + CABINETS.bay.w / 2).toBeLessThan(TIRE_BAY.halfWidth);
    });
  });

  it('routes the feed out of the battery yard, up the strip west of the office and in through the building\'s west wall', () => {
    for (const f of feeds) {
      expect(f.route[0]).toEqual({ x: AUX_TRANSFORMER.x, y: AUX_TRANSFORMER.y });
      // the strip leg stands between the battery yard's east fence and the office, south of the transformer yard
      const strip = f.route[2].x;
      expect(strip).toBeGreaterThan(BESS_YARD.x + BESS_YARD.w);
      expect(strip).toBeLessThan(BUILDING.x);
      expect(SERVICE_TRAY.y).toBeGreaterThan(TX_YARD.y + TX_YARD.h);
      expect(f.route[4].x).toBe(BUILDING.x);
    }
    expect(feeds[1].feedM).toBeGreaterThan(feeds[0].feedM);
    expect(feeds[0].feedM).toBeGreaterThan(60);
    expect(feeds[1].feedM).toBeLessThan(90);
  });

  it('sizes the supply by NEC 670.4(A): 125 % of the pump motor\'s 7.6 A plus every other load', () => {
    const others = SERVICE_LOADS.filter((l) => l.kind !== 'motor').map(loadAmps).reduce((s, a) => s + a, 0);
    expect(serviceDesignAmps()).toBeCloseTo(1.25 * 7.6 + others, 9);
    expect(serviceDesignAmps()).toBeGreaterThan(35);
    expect(serviceDesignAmps()).toBeLessThan(50);
  });

  it('picks the smallest conductor that carries the load and keeps the farther bay under 3 %', () => {
    const f = feeds[1];
    expect(f.ampacity).toBeGreaterThanOrEqual(f.designAmps);
    expect(f.dropPct).toBeLessThan(3);
    const i = AMPACITY_75C.findIndex(([, a]) => a === f.ampacity);
    if (i > 0) {
      const [n, a] = AMPACITY_75C[i - 1];
      expect(a < f.designAmps || dropPctAmps(f.designAmps, f.feedM, awgMm2(n)) >= 3).toBe(true);
    }
  });

  it('bounds the fault current at each cabinet for its short-circuit rating', () => {
    // at TX-AUX's own terminals: about 56.6 kA (2,500 kVA at 5.32 %)
    expect(faultKa(0, 100)).toBeCloseTo(TX_AUX.kva / (Math.sqrt(3) * 0.48) / (TX_AUX.zPct / 100) / 1000, 6);
    expect(faultKa(0, 100)).toBeGreaterThan(55);
    for (const f of feeds) {
      expect(f.faultKa).toBeLessThan(10);       // a 10 kA short-circuit rating covers the cabinet
      expect(f.faultKa).toBeGreaterThan(1);
    }
  });

  it('protects the feed and the machine\'s two feeders within their conductors, each above the load it carries', () => {
    const L = SERVICE_ONE_LINE;
    const ampacity = (n: number) => AMPACITY_75C.find(([m]) => m === n)![1];
    // the feed: the breaker carries the bay's design current, its conductor carries the breaker, the main switch both
    for (const f of feeds) {
      expect(L.feedBreakerA).toBeGreaterThanOrEqual(f.designAmps);
      expect(f.ampacity).toBeGreaterThanOrEqual(L.feedBreakerA);
      expect(L.mainSwitchA).toBeGreaterThanOrEqual(L.feedBreakerA);
      expect(L.sccrKa).toBeGreaterThan(f.faultKa);
    }
    // the portal's feeder (about 30 A of drives): 10 mm2 is more copper than 8 AWG, which carries 50 A at 75 °C
    expect(portalSupplyAmps()).toBeGreaterThan(25);
    expect(L.portalFeederA).toBeGreaterThanOrEqual(portalSupplyAmps());
    expect(L.portalFeederMm2).toBeGreaterThanOrEqual(awgMm2(8));
    expect(ampacity(8)).toBeGreaterThanOrEqual(L.portalFeederA);
    // each robot's feeder (about 11 A behind its slip ring): 2.5 mm2 is more copper than 14 AWG, protected at 15 A
    expect(robotSupplyAmps()).toBeGreaterThan(10);
    expect(L.robotFeederA).toBeGreaterThanOrEqual(robotSupplyAmps());
    expect(L.robotFeederMm2).toBeGreaterThanOrEqual(awgMm2(14));
    expect(L.robotFeederA).toBeLessThanOrEqual(15);
    // the bay's whole machine is more than either feeder: the portal and the pump and the cabinets
    expect(serviceDesignAmps()).toBeGreaterThan(portalSupplyAmps());
  });
});

