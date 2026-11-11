// ============================================================================
// electricalYard.test.ts — the depot's electrical ground is buildable, clear of everything else, and no lane enters it.
//
// Founder, 2026-11-11, on a marked-up screenshot: "Utilize all the area within red that is available to add
// electrical/battery gear. No vehicles travel there." The red area is the fenced north-west corner out to the
// building's west wall, and the strip behind the office. otto-q-core's one-line (0810) says what must stand there:
// seven 2,500 kVA transformers and a primary switchgear.
//
// What is asserted, and why:
//   1. Every unit the one-line names has a place: six charger transformers in the transformer yard, TX-AUX and the
//      switchgear in the battery yard, each inside its fence.
//   2. They can be built and worked on: 0.9 m between neighbours, 3 m of working room in front of each charger unit,
//      nothing overlapping anything.
//   3. The yards touch nothing else on the site: no building, no carport, no stall.
//   4. No lane or junction is inside either yard, and the rear apron still starts east of the transformer yard, so
//      "no vehicles travel there" is a property of the lane graph, not a hope.
//   5. The battery yard's south fence is clear of the recorded turn at the west avenue's north end (the replay tests
//      drive every recorded car against both yards; this pins the number that made them pass).
// ============================================================================
import { describe, expect, it } from 'vitest';
import labDay from '@/components/tabs/__fixtures__/powerOneLine.labDay.json';
import {
  AUX_TRANSFORMER, BESS_YARD, BUILDING, CHARGER_TRANSFORMERS, MV_SWITCHGEAR, PARK_RUNS, SERVICE_BAY_XS, TX_PAD, TX_PITCH,
  TX_YARD, WASH, generateStallsV2,
} from './sitePlan';
import { allStructureSolids, electricalYardSolids, parkedBox, boxAabb, rectOf, rectsOverlap, type Rect } from './structurePlan';
import { buildDepotLanes } from '@/engine/motion/LaneGraph';

const M = 0.4785;                                       // metres per plan unit
const padRect = (t: { x: number; y: number }): Rect =>
  ({ x0: t.x - TX_PAD.w / 2, x1: t.x + TX_PAD.w / 2, y0: t.y - TX_PAD.d / 2, y1: t.y + TX_PAD.d / 2 });
const inside = (a: Rect, b: Rect, margin = 0) => a.x0 >= b.x0 + margin && a.x1 <= b.x1 - margin && a.y0 >= b.y0 + margin && a.y1 <= b.y1 - margin;
const swgr: Rect = {
  x0: MV_SWITCHGEAR.x - MV_SWITCHGEAR.w / 2, x1: MV_SWITCHGEAR.x + MV_SWITCHGEAR.w / 2,
  y0: MV_SWITCHGEAR.y - MV_SWITCHGEAR.d / 2, y1: MV_SWITCHGEAR.y + MV_SWITCHGEAR.d / 2,
};

describe('every unit the one-line names has a place', () => {
  it('the plan stands exactly the transformers otto-q-core\'s one-line declares', () => {
    const declared = (labDay as { nodes: { code: string; kind: string }[] }).nodes.filter((n) => n.kind === 'transformer').map((n) => n.code).sort();
    expect([...CHARGER_TRANSFORMERS.map((t) => t.code), AUX_TRANSFORMER.code].sort()).toEqual(declared);
    expect(declared).toHaveLength(7);
  });

  it('six charger transformers stand inside the transformer yard, TX-AUX and the switchgear inside the battery yard', () => {
    for (const t of CHARGER_TRANSFORMERS) expect(inside(padRect(t), rectOf(TX_YARD), 0.5)).toBe(true);
    expect(inside(padRect(AUX_TRANSFORMER), rectOf(BESS_YARD), 1)).toBe(true);
    expect(inside(swgr, rectOf(BESS_YARD), 1)).toBe(true);
    expect(rectsOverlap(swgr, padRect(AUX_TRANSFORMER))).toBe(false);
  });
});

describe('they can be built and worked on', () => {
  it('neighbours stand at least 0.9 m apart', () => {
    expect((TX_PITCH - TX_PAD.w) * M).toBeGreaterThanOrEqual(0.9);
  });

  it('each charger transformer has 3 m of working room in front, short of the fence and the office wall', () => {
    const front = Math.max(...CHARGER_TRANSFORMERS.map((t) => padRect(t).y1));
    expect((TX_YARD.y + TX_YARD.h - front) * M).toBeGreaterThanOrEqual(3);
    expect(TX_YARD.y + TX_YARD.h).toBeLessThanOrEqual(BUILDING.y - 1);      // the yard's fence stops short of the rear wall
  });
});

describe('the yards touch nothing else', () => {
  it('no building, carport or other solid overlaps a yard', () => {
    const yards = electricalYardSolids().map((y) => y.r);
    expect(rectsOverlap(yards[0], yards[1])).toBe(false);
    for (const y of yards) {
      expect(rectsOverlap(y, rectOf(BUILDING))).toBe(false);
      expect(rectsOverlap(y, rectOf(WASH))).toBe(false);
      for (const run of PARK_RUNS) if (run.carport) expect(rectsOverlap(y, rectOf(run.carport))).toBe(false);
      for (const k of allStructureSolids()) {
        if (k.kind === 'battery-yard' || k.kind === 'transformer-yard') continue;
        expect(rectsOverlap(y, k.r), `${k.kind} overlaps a yard`).toBe(false);
      }
    }
  });

  it('no stall, as a parked car lies in it, overlaps a yard', () => {
    const yards = electricalYardSolids().map((y) => y.r);
    for (const s of generateStallsV2()) {
      const body = boxAabb(parkedBox(s.position));
      for (const y of yards) expect(rectsOverlap(y, body), `${s.id}`).toBe(false);
    }
  });
});

describe('no vehicle travels there', () => {
  it('no junction and no lane point lies inside either yard, with a car\'s half-width to spare', () => {
    const g = buildDepotLanes();
    const half = 2.1 + g.rightOffset;                   // half a car body beside a lane's offset drive line
    const grown = electricalYardSolids().map((y) => ({ x0: y.r.x0 - half, x1: y.r.x1 + half, y0: y.r.y0 - half, y1: y.r.y1 + half }));
    const hit = (x: number, y: number) => grown.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
    for (const n of g.nodes.values()) expect(hit(n.x, n.y), `node ${n.id}`).toBe(false);
    for (const lane of g.lanes.values()) {
      const pts = (lane as unknown as { pts: { x: number; y: number }[] }).pts;
      for (let i = 1; i < pts.length; i++) {
        for (let k = 0; k <= 20; k++) {
          const x = pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / 20;
          const y = pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / 20;
          expect(hit(x, y), `lane ${lane.id}`).toBe(false);
        }
      }
    }
  });

  it('the transformer yard ends a car\'s length west of the first service bay, where the rear apron begins', () => {
    expect(SERVICE_BAY_XS[0] - (TX_YARD.x + TX_YARD.w)).toBeGreaterThanOrEqual(9.8);
  });

  it('the battery yard\'s south fence is north of the recorded turn at the west avenue\'s end (a corner at y 45.7)', () => {
    expect(BESS_YARD.y + BESS_YARD.h).toBeLessThanOrEqual(45.7 - 1.5);
  });
});
