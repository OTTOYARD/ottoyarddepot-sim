// The paint is DERIVED from the graph the cars drive; these pin the median the
// founder asked for (2026-10-06): the two streams of every divided road separated by
// a strip of road nothing drives on, broken where cars turn across it.
import { describe, expect, it } from "vitest";
import { buildDepotLanes, DIVIDED_SPAN } from "./LaneGraph";
import { paintLanes, LANE_PAINT_WIDTH } from "./lanePaint";
import { CAR_BODY_WIDTH } from "./traffic";

const g = buildDepotLanes();
const paint = paintLanes(g);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** distance from p to the segment a-b */
function toSeg(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2));
  return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
}

describe("lane paint: the divided ring's median", () => {
  it("every divided road is two streams DIVIDED_SPAN apart, so opposing bodies pass a car's width apart", () => {
    let pairs = 0;
    for (const lane of g.lanes.values()) {
      if (!g.isDivided(lane.id)) continue;
      const back = `${lane.to}>${lane.from}`;
      expect(g.isDivided(back), back).toBe(true);
      expect(g.offsetOf(lane.id) + g.offsetOf(back)).toBeCloseTo(DIVIDED_SPAN, 9);
      pairs++;
    }
    expect(pairs / 2).toBe(17); // 8 south, 6 north, the two avenues, the stub north of NE
    expect(DIVIDED_SPAN - CAR_BODY_WIDTH).toBeGreaterThanOrEqual(4);
  });

  it("paints a median, not a centre stripe, on divided roads, and a stripe only on aisles", () => {
    for (const s of paint.stripes) {
      // an aisle's stripe runs on its centreline; no divided road has one
      const lane = [...g.lanes.values()].find((l) => dist(l.pts[0], s.pts[0]) < 1e-9 && dist(l.pts[1], s.pts[1]) < 1e-9)!;
      expect(g.isDivided(lane.id), lane.id).toBe(false);
    }
    // 14 of the 17 stretches. A median stops 8u short of a junction cars turn across and needs 6u of its own, so three
    // stretches are all junction gap: Sg0-S_eg and S_in-Sg3 (20u), and the east avenue's stub between the N1 lane and
    // the north collector, N1e-NE (18.8u since the north collector was centred, 2026-11-18; it was 24u and had one).
    expect(paint.medians.length).toBe(14);
    const [n1e, ne] = [g.nodes.get("N1e")!, g.nodes.get("NE")!];
    expect(dist(n1e, ne)).toBeLessThan(2 * 8 + 6);
    for (const m of paint.medians) {
      for (const q of [...m.edges[0], ...m.edges[1]]) {
        const onStub = Math.abs(q.x - ne.x) < DIVIDED_SPAN && q.y > n1e.y && q.y < ne.y;
        expect(onStub, `a median on the N1e-NE stub at (${q.x}, ${q.y})`).toBe(false);
      }
    }
    for (const m of paint.medians) expect(m.width).toBeCloseTo(DIVIDED_SPAN - LANE_PAINT_WIDTH, 9);
  });

  it("no lane's paint, and no car on its drive line, reaches into a median", () => {
    for (const m of paint.medians) {
      const [a0, a1] = m.edges[0], [b0, b1] = m.edges[1];
      const mid = { x: (a0.x + b0.x + a1.x + b1.x) / 4, y: (a0.y + b0.y + a1.y + b1.y) / 4 };
      for (const l of paint.lanes) {
        const d = Math.min(...l.driveLine.slice(1).map((q, i) => toSeg(mid, l.driveLine[i], q)));
        // half a lane of paint, and half a car, from the median's middle at least
        expect(d, l.id).toBeGreaterThanOrEqual(Math.max(LANE_PAINT_WIDTH, CAR_BODY_WIDTH) / 2 + m.width / 2 - 1e-6);
      }
    }
  });

  it("stops short of every junction a car can turn across", () => {
    for (const m of paint.medians) {
      for (const e of m.edges) {
        for (const n of g.nodes.values()) {
          // every ring node is a junction or a corner on this depot
          for (const p of e) expect(dist(p, n), n.id).toBeGreaterThan(7);
        }
      }
    }
  });
});
