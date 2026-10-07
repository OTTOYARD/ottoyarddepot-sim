// ============================================================================
// startOnHeading — a rail starts the way the car points.
//
// A rail's first point is the car's own position, so nothing rounds the join
// between where the car points and where the rail's first segment goes; the drawn
// heading eases across it at YAW_PER_UNIT = 2.5 rad per unit of travel, i.e. the
// body pivots about its own centre. These pin the geometry that replaces it: an
// arc tangent to the heading, then a straight that meets the route at an ordinary
// corner.
// ============================================================================
import { describe, it, expect } from "vitest";
import { startOnHeading, START_R, buildRail, pointAt } from "./RailFlow";
import type { Pt } from "./PathTracker";

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;

/** Largest heading change per unit travelled along the rail built from a polyline,
 *  over any 6u window. (A rounded arc is still a polyline sampled every ~1u, so a
 *  shorter window reads its vertices as kinks; 6u reads an arc of radius R as
 *  about 1.2 / R.) */
function maxCurvature(pts: Pt[]): number {
  const rail = buildRail(pts, [], null);
  const W = 6;
  let worst = 0;
  for (let s = 0; s + W <= rail.total; s += 0.25) {
    const a = pointAt(rail.pts, rail.cum, s + 0.01).heading;
    const b = pointAt(rail.pts, rail.cum, s + W).heading;
    worst = Math.max(worst, Math.abs(wrap(b - a)) / W);
  }
  return worst;
}

describe("startOnHeading — the opening of a rail", () => {
  // The south-row case measured on the founder's run: a staging back-out ends with
  // the car pointing 20° short of west (heading 160°, toward the stall row) about 10u
  // south of the westbound lane line, and the route's first segment jumps to a join
  // point 8u up that lane — 72° off the way the car points.
  const car = { x: 150, y: 179.2 };
  const heading = 160 * DEG;
  const route: Pt[] = [car, { x: 140, y: 168.8 }, { x: 60, y: 168.8 }, { x: 30, y: 168.8 }];

  it("the route as given starts 72° off the car's heading — the kink that pivoted it", () => {
    const first = Math.atan2(route[1].y - car.y, route[1].x - car.x);
    expect(Math.abs(wrap(first - heading)) / DEG).toBeGreaterThan(60);
  });

  it("opens with an arc tangent to the heading, from exactly where the car is", () => {
    const out = startOnHeading(route, heading);
    expect(out[0]).toEqual(car);
    const first = Math.atan2(out[1].y - out[0].y, out[1].x - out[0].x);
    // the first 1u chord of an R 7u arc lies half its own turn (≈ 4°) off the tangent
    expect(Math.abs(wrap(first - heading)) / DEG).toBeLessThan(6);
  });

  it("then turns no tighter than START_R anywhere, and ends on the route it was given", () => {
    const out = startOnHeading(route, heading);
    // curvature of the rail built from it (corner rounding included) stays near 1/START_R
    expect(maxCurvature(out)).toBeLessThan(1.3 / START_R);
    // the rest is the original route, untouched
    expect(out[out.length - 1]).toEqual(route[route.length - 1]);
    expect(out.slice(-2)).toEqual(route.slice(-2));
  });

  it("leaves a route alone when it already starts the way the car points", () => {
    const straight: Pt[] = [{ x: 0, y: 0 }, { x: 20, y: 1 }, { x: 60, y: 1 }];
    expect(startOnHeading(straight, 0)).toBe(straight);
  });

  it("leaves a route alone when it leaves behind the car (the caller backs out instead)", () => {
    const behind: Pt[] = [{ x: 0, y: 0 }, { x: -10, y: 0 }, { x: -60, y: 0 }];
    expect(startOnHeading(behind, 0)).toBe(behind);
  });

  it("a right-angle start becomes a turn, not a pivot: the heading changes over metres, not centimetres", () => {
    // pointing east, route goes due north from the car
    const north: Pt[] = [{ x: 0, y: 0 }, { x: 0, y: -40 }, { x: 0, y: -80 }];
    const out = startOnHeading(north, 0);
    expect(out.length).toBeGreaterThan(north.length);
    expect(maxCurvature(out)).toBeLessThan(1.3 / START_R);
  });
});
