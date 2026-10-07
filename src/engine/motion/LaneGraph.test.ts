import { describe, it, expect } from "vitest";
import { buildDepotLanes, LaneGraph } from "./LaneGraph";
import { GAP_LANES, NORTH_LANE_Y, SOUTH_LANE_Y, INGRESS, EGRESS } from "@/lib/sitePlan";

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

  it("a departure from the east/south staging block never routes BACKWARDS through the entrance", () => {
    // The block the renderer fills first (S3 row, ~x 212 y 197) sits Euclidean-
    // closer to the ingress stub (200,210) than to any real ring node, so the old
    // unfiltered nearestNode made the ENTRANCE the origin of every departure out
    // of it — the car drove to the gate and was despawned there by the TTL.
    const from = { x: 212, y: 197 };
    const path = g.route(from, { x: EGRESS.x, y: EGRESS.y });
    expect(path.length).toBeGreaterThan(2);
    // it must never double back onto the ingress stub...
    const nearIngress = path.filter(
      (p) => Math.hypot(p.x - INGRESS.x, p.y - (INGRESS.y - 5)) < 6,
    );
    expect(nearIngress).toHaveLength(0);
    // ...and must actually reach the egress
    const end = path[path.length - 1];
    expect(Math.hypot(end.x - EGRESS.x, end.y - EGRESS.y)).toBeLessThan(8);
    // a straight shot east→west is ~112 units; anything near 2x means it detoured
    // out to the gate and back. (1.8x was 201.6 against a route of 201.2; mitered
    // corners — the outside of a turn now runs in its real lane instead of cutting
    // toward the centreline — make the same route 201.8. The detour this guards
    // against adds ~90.)
    expect(pathLen(path)).toBeLessThan((from.x - EGRESS.x) * 1.85);
  });

  it("still routes a car that is genuinely AT the ingress out of the ingress", () => {
    // the spur filter must not strand a just-spawned arrival
    const path = g.route({ x: INGRESS.x, y: INGRESS.y - 5 }, { x: GAP_LANES.AB, y: 100 });
    expect(path.length).toBeGreaterThan(2);
    expect(pathLen(path)).toBeGreaterThan(20);
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

describe("LaneGraph — a junction's stop line clears the nearest stream crossing the way in", () => {
  const g = buildDepotLanes();
  const N = -Math.PI / 2, S = Math.PI / 2, E = 0, W = Math.PI;

  it("waits further back where the divided ring's outer stream crosses (DIVIDED_SPAN)", () => {
    // the ingress spur onto the south collector: its near stream is the eastbound, 4.8u out
    expect(g.stopDistance("S_in", N, 6)).toBeCloseTo(7.6, 9);
    // down the aisle north of Tn onto the north collector: the westbound, 4.8u out
    expect(g.stopDistance("Tn", S, 6)).toBeCloseTo(7.6, 9);
    // the N1 approach onto the east avenue's stub: its southbound stream, 4.0u out
    expect(g.stopDistance("N1e", E, 6)).toBeCloseTo(6.8, 9);
  });

  it("keeps the 6u stop wherever the near stream is still 3.2u out", () => {
    expect(g.stopDistance("Ng1", N, 6)).toBeCloseTo(6, 9); // a gap lane onto the eastbound north collector
    expect(g.stopDistance("Ts", S, 6)).toBeCloseTo(6, 9);  // the aisle onto the westbound south collector
    expect(g.stopDistance("Sg1", W, 6)).toBeCloseTo(6, 9); // westbound along the south collector, past a gap mouth
    expect(g.stopDistance("Sg1", E, 6)).toBe(6);           // eastbound past it: nothing crosses on the near side
  });
});
