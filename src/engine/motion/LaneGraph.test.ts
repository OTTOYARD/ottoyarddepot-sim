import { describe, it, expect } from "vitest";
import { buildDepotLanes, LaneGraph } from "./LaneGraph";
import { GAP_LANES, NORTH_LANE_Y, SOUTH_LANE_Y, INGRESS } from "@/lib/sitePlan";

function pathLen(pts: { x: number; y: number }[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

describe("LaneGraph — one-way depot routing", () => {
  const g = buildDepotLanes();

  it("routes from the ingress gate up to a charging gap lane and ends at the destination", () => {
    const dest = { x: GAP_LANES.westOfA, y: 100 }; // up gap lane 0, in the canopy band
    const path = g.route({ x: INGRESS.x, y: INGRESS.y }, dest);
    expect(path.length).toBeGreaterThan(2);
    const end = path[path.length - 1];
    expect(Math.hypot(end.x - dest.x, end.y - dest.y)).toBeLessThan(5);
    // it must travel NORTH (y decreasing) somewhere near the gap-lane x — i.e. it
    // drove up the one-way gap lane rather than teleporting across the lot
    const nearGap = path.filter((p) => Math.abs(p.x - GAP_LANES.westOfA) < 8);
    expect(nearGap.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...nearGap.map((p) => p.y))).toBeLessThan(SOUTH_LANE_Y - 40);
  });

  it("enforces one-way gap lanes: going north→south near a gap takes a detour, not the gap", () => {
    // from just north of gap0 to just south of gap0. The direct gap distance is
    // ~ (SOUTH_LANE_Y - NORTH_LANE_Y) ≈ 98. Because the gap is northbound-only,
    // the route must detour around an avenue → much longer.
    const from = { x: GAP_LANES.westOfA, y: NORTH_LANE_Y };
    const to = { x: GAP_LANES.westOfA, y: SOUTH_LANE_Y };
    const direct = SOUTH_LANE_Y - NORTH_LANE_Y;
    const L = pathLen(g.route(from, to));
    expect(L).toBeGreaterThan(direct * 1.5); // had to go around
  });

  it("drive paths are offset to the right of travel (lanes separated, no head-on)", () => {
    const a = { x: 50, y: 0 };
    const b = { x: 50, y: 100 }; // travel south (+y)
    const fwd = LaneGraph.offsetRight([a, b], 2.4);
    // travelling +y, right is -x → offset point shifts to smaller x
    expect(fwd[0].x).toBeLessThan(50);
    const rev = LaneGraph.offsetRight([b, a], 2.4); // travel north (-y), right is +x
    expect(rev[0].x).toBeGreaterThan(50);
  });
});
