// ============================================================================
// RailFlow — the geometry a car is actually asked to drive.
//
// These cover the three defects behind "vehicle turning is kind of messed up:
// they move diagonally, bend rapidly, or the rear bumper slides at an
// intersection". Each one is a property of the ROUTE, measured here directly,
// not a look-and-see:
//   • a routed rail must never double back on itself (the SE-corner U-turn)
//   • an intersection a route crosses must actually be locked
//   • a corner must have a finite turn radius, not a tangent discontinuity
// ============================================================================
import { describe, it, expect } from "vitest";
import { buildRail, roundCorners, pointAt } from "./RailFlow";
import { buildDepotLanes } from "./LaneGraph";
import { EGRESS, SOUTH_LANE_Y } from "@/lib/sitePlan";
import type { Pt } from "./PathTracker";

/** Signed progress of a polyline along +x, leg by leg. */
function legs(pts: Pt[]) {
  const out: { dx: number; dy: number; len: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    out.push({ dx, dy, len: Math.hypot(dx, dy) });
  }
  return out;
}

describe("route geometry — a rail never doubles back", () => {
  const g = buildDepotLanes();

  // A car in the east staging block heading for the WEST egress used to join the
  // ring at the Euclidean-nearest node, SE (272.25, 172). Its rail then read
  //   (252.8,168.8) (271.9,168.8) (220.0,168.8) (200.0,168.8) …
  // — 19u EAST down the WESTBOUND side of the boulevard, a 180° spin in the
  // corner, then back west past its own start.
  //
  // THAT DEFECT IS GONE, AND NOT BECAUSE OF ANY CHANGE IN THIS STACK. It was a
  // property of the PRE-REBUILD depot. Measured on the current one, with the plain
  // Euclidean-nearest join still in place: 3.2u of eastward drift, not 19u. The
  // driven-distance join scoring written to fix it was measured in this tree and
  // deliberately NOT taken — it sends a car queued at the gate 43u north-west off
  // the approach road and wedges it (see TwinMotionDriver.fixture.test.ts). These
  // stay as a REGRESSION GUARD on a property the geometry currently gives us for
  // free, which is exactly the kind of property that quietly stops being true.
  it.each([
    ["east staging block", { x: 252.8, y: 168.8 }],
    ["temp block, mid column", { x: 260, y: 120 }],
  ])("a westbound departure from the %s never drives east first", (_name, from) => {
    const pts = g.route(from, { x: EGRESS.x, y: EGRESS.y });
    const eastward = legs(pts)
      .filter((l) => l.dx > 0)
      .reduce((a, l) => a + l.dx, 0);
    // a couple of units of eastward drift while turning is fine; a leg back to
    // the corner is 19u+.
    expect(eastward).toBeLessThan(6);
  });

  it("the east-staging departure is a direct run, not a there-and-back", () => {
    // 201.2u on today's depot with the nearest-node join. The turning branch
    // claimed 239.5u -> 201.2u as its own improvement; measured here, the 201.2
    // is what the rebuilt geometry already produces and the join scoring changes
    // it by nothing at all on this origin. Kept as a length guard.
    const pts = g.route({ x: 252.8, y: 168.8 }, { x: EGRESS.x, y: EGRESS.y });
    const total = legs(pts).reduce((a, l) => a + l.len, 0);
    expect(total).toBeLessThan(215);
  });
});

describe("node locks — an intersection a route crosses is actually held", () => {
  const g = buildDepotLanes();

  it("a run down the south boulevard locks the junctions it passes through", () => {
    // This was the bug: route() shifts every interior road vertex
    // drive-on-the-right by rightOffset = 3.2u, and the annotation threshold was
    // 3u, so a rail could never come close enough to a node it traversed. A
    // staging→egress route crossing S_in, Sg2, Sg1 and Sg0 locked NONE of them.
    const pts = g.route({ x: 252.8, y: 168.8 }, { x: EGRESS.x, y: EGRESS.y });
    const rail = buildRail(pts, g.nodes.values(), null);
    const ids = new Set(rail.nodes.map((n) => n.id));
    for (const id of ["Sg3", "S_in", "Sg2", "Sg1", "S_eg"]) expect(ids.has(id)).toBe(true);
  });

  it("does not claim a junction the route never reaches", () => {
    // Sg0 (x=80) is 20u west of the egress spur — a route that turns out at
    // S_eg (x=100) must not hold it, or it would stall traffic it never meets.
    const pts = g.route({ x: 252.8, y: 168.8 }, { x: EGRESS.x, y: EGRESS.y });
    const rail = buildRail(pts, g.nodes.values(), null);
    expect(rail.nodes.some((n) => n.id === "Sg0")).toBe(false);
  });

  it("annotated node positions land on the rail near the junction", () => {
    const pts = g.route({ x: 252.8, y: 168.8 }, { x: EGRESS.x, y: EGRESS.y });
    const rail = buildRail(pts, g.nodes.values(), null);
    for (const n of rail.nodes) {
      const node = g.nodes.get(n.id)!;
      const p = pointAt(rail.pts, rail.cum, n.s);
      expect(Math.hypot(p.x - node.x, p.y - node.y)).toBeLessThanOrEqual(5);
      // and the y stays on the boulevard, i.e. the s is a real crossing point
      if (/^(Sg\d|S_in|S_eg)$/.test(n.id)) {
        expect(Math.abs(p.y - SOUTH_LANE_Y)).toBeLessThan(8);
      }
    }
  });
});

describe("roundCorners — a corner has a turn radius, not a discontinuity", () => {
  it("leaves the endpoints exactly where they were", () => {
    const raw: Pt[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const out = roundCorners(raw);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 50, y: 50 });
  });

  it("turns a 90° vertex into a bounded arc instead of a tangent flip", () => {
    const raw: Pt[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const out = roundCorners(raw);
    // the sharp vertex is gone…
    expect(out.some((p) => p.x === 50 && p.y === 0)).toBe(false);
    // …and no single joint turns more than a fraction of the corner
    let worst = 0;
    const ls = legs(out);
    for (let i = 1; i < ls.length; i++) {
      const a = Math.atan2(ls[i - 1].dy, ls[i - 1].dx);
      const b = Math.atan2(ls[i].dy, ls[i].dx);
      worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
    }
    expect(worst).toBeLessThan(0.5); // was π/2 across one point
  });

  it("keeps the arc inside the lane — the cut never exceeds CORNER_MAX_CUT", () => {
    // A corner arc deviates toward the INSIDE of the turn. The lane it is cutting
    // into is only 2 x LaneGraph.rightOffset = 6.4u wide, so the deviation is
    // capped; measured here against the vertex it replaced.
    const raw: Pt[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const out = roundCorners(raw);
    let nearest = Infinity;
    for (const p of out) nearest = Math.min(nearest, Math.hypot(p.x - 50, p.y - 0));
    expect(nearest).toBeLessThanOrEqual(1.25);
  });

  it("leaves a straight run untouched", () => {
    const raw: Pt[] = [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 50, y: 0 }];
    expect(roundCorners(raw)).toEqual(raw);
  });

  it("survives degenerate input (duplicate points, two-point paths)", () => {
    expect(roundCorners([{ x: 1, y: 2 }]).length).toBe(1);
    expect(roundCorners([{ x: 1, y: 2 }, { x: 3, y: 4 }]).length).toBe(2);
    const dup = roundCorners([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(dup.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("a rail built from a routed corner has a finite maximum curvature", () => {
    const g = buildDepotLanes();
    const pts = g.route({ x: 252.8, y: 168.8 }, { x: EGRESS.x, y: EGRESS.y });
    const rail = buildRail(pts, g.nodes.values(), null);
    // sample the tangent every 0.5u and measure yaw per unit travelled
    let worst = 0;
    let prev = pointAt(rail.pts, rail.cum, 0).heading;
    for (let s = 0.5; s < rail.total - 0.5; s += 0.5) {
      const h = pointAt(rail.pts, rail.cum, s).heading;
      const d = Math.abs(Math.atan2(Math.sin(h - prev), Math.cos(h - prev)));
      worst = Math.max(worst, d / 0.5);
      prev = h;
    }
    // a raw polyline vertex is an infinite-curvature point; a rounded one is not
    expect(worst).toBeLessThan(1.2);
  });
});
