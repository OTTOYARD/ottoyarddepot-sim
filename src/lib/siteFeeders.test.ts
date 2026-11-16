// ============================================================================
// siteFeeders.test.ts — every post's 480 V feed has a route, from the transformer the engine names, that keeps out of the
// battery yard and the office, and the feed holds its voltage at full load on the longest one.
//
// The posts are all-in-one 350 kW chargers since 2026-11-15 (Chase: "All-in-one posts"), so each takes its feed straight
// from its charger transformer. What is asserted, and why:
//   1. The 30 posts of the 30-post build each have a feed from the transformer otto-q-core's one-line (0810) puts them under
//      (the Power tab's lab-day fixture is the one-line as the engine served it).
//   2. No route crosses the battery yard or the office and service bays: the duct bank goes round them.
//   3. On the longest route the feed drops at most 3 % of 480 V at full load (2 conductors of 350 kcmil a phase).
//   4. The farthest post is further from the office than a twisted-pair Ethernet channel may run (100 m), which is why the
//      site's network cable is fibre (charge_cabinet.py, CHG-SNW). If the layout ever brings every post within it, this
//      fails, and copper becomes a choice again.
//   5. The CAD reads these lengths (cad/spec/robots.json, siteFeeders): cadSpec.test.ts holds that file equal to cadSpec().
// ============================================================================
import { describe, expect, it } from 'vitest';
import labDay from '@/components/tabs/__fixtures__/powerOneLine.labDay.json';
import { FEED, feederKeepOuts, postFeeders } from './siteFeeders';

const feeders = postFeeders();

describe('every post has its feed', () => {
  it('30 posts, each fed by the transformer the engine\'s one-line names', () => {
    const parentOf = new Map((labDay as { nodes: { code: string; parent: string | null }[] }).nodes.map((n) => [n.code, n.parent]));
    expect(feeders).toHaveLength(30);
    for (const f of feeders) expect(f.transformer, f.post).toBe(parentOf.get(`NASH-${f.post}`));
  });

  it('every route starts at its transformer and ends on its post\'s pad, square legs only', () => {
    for (const f of feeders) {
      for (let i = 1; i < f.route.length; i++) {
        const a = f.route[i - 1], b = f.route[i];
        expect(a.x === b.x || a.y === b.y, `${f.post} leg ${i}`).toBe(true);
      }
    }
  });
});

describe('the duct bank goes round the yards and the buildings', () => {
  it('no leg of any route crosses the battery yard or the office', () => {
    for (const f of feeders) {
      for (let i = 1; i < f.route.length; i++) {
        const a = f.route[i - 1], b = f.route[i];
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        for (const k of feederKeepOuts()) {
          const crosses = x1 > k.x0 && x0 < k.x1 && y1 > k.y0 && y0 < k.y1;
          expect(crosses, `${f.post} leg ${i} crosses the ${k.name}`).toBe(false);
        }
      }
    }
  });
});

describe('the feed holds its voltage', () => {
  it('drops at most 3 % of 480 V at full load, even on the longest route', () => {
    const worst = Math.max(...feeders.map((f) => f.dropPct));
    expect(FEED.amps).toBeGreaterThan(400);
    expect(FEED.amps).toBeLessThan(500);
    expect(worst).toBeLessThan(3);
  });

  it('every conductor is between 40 and 160 m in the duct bank', () => {
    for (const f of feeders) {
      expect(f.acM, f.post).toBeGreaterThan(40);
      expect(f.acM, f.post).toBeLessThan(160);
    }
  });
});

describe('the site\'s network is fibre, and why', () => {
  it('the farthest post is more than 100 m of cable from the office: past a copper Ethernet channel', () => {
    expect(Math.max(...feeders.map((f) => f.netM))).toBeGreaterThan(100);
  });
});
