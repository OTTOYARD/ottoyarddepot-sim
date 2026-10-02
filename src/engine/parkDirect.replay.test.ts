// ============================================================================
// PARK DIRECT — a car bound for a staging stall turns straight into it.
//
// The founder, 2026-10-01: "they go past their designated stall first and then
// come back to it and park ... Literally what it looks like is reverse and then
// pull into a parking spot. ... It needs to immediately turn into that spot."
//
// The staging route ended at the graph node NEAREST the stall's turn-in point, and
// a stall sits somewhere along a lane up to ~98u long, so that node was as often
// PAST the stall as short of it: the car drove by, turned round at the node and came
// back (a hairpin whose heading lag drew as the car reversing). It now leaves the
// road ABREAST of the stall (LaneGraph.routeOff). Measured with arrivalProbe.ts,
// every staging arrival on five replays, overshoot = the car's centre got more than
// 2u past the stall's axis while in front of it, before coming back to park:
//
//                  overshoot                         double-back      tail-first
//                  before            after           before  after    before  after
//   busy_day        3/11  (6.7u)     0/11             4/11    1/11     0/11    0/11
//   fresh0922 @8x  25/70  (43.5u)    0/70            18/70    9/70     3/70    0/70
//   fresh0922 @3x  25/72  (43.4u)    0/72            18/72    9/72     3/72    0/72
//   live0922       39/114 (44.6u)    0/113           32/114   1/113   10/114   0/113
//   live0922rec    10/32  (43.5u)    0/33             7/32    0/33     4/32    0/33
//
// before = origin/main 177253f; (n) the worst overshoot. Double-back = the path's
// direction of travel turns > 135° within 14u; tail-first = the body drawn moving
// backwards while on its arrival rail (the hairpin's heading lag). The arrival
// count moves by one on two captures because departure timing moves with it.
// (The worst were the temp block, TW/TE: its aisle is one 98u lane between the two
// collectors, so a car bound for a mid-column stall drove the length of it and back.)
//
// Not counted as overshoot, because no head-in route avoids it: S3's first stall
// (x 212) sits right beside the gate, nose south, so a car entering northbound
// through the gate has to loop round on the collector to come at it from the north
// (all 9 double-backs left on fresh0922, and the 1 on busy_day and live0922).
// ============================================================================
import { describe, expect, it } from "vitest";
import { probeArrivals, summarize, OVERSHOOT_TOL } from "./__fixtures__/arrivalProbe";
import { buildDepotLanes } from "./motion/LaneGraph";
import { TEMP_LANE_X, WEST_AISLE_X, SOUTH_LANE_Y, NORTH_LANE_Y } from "@/lib/sitePlan";

const RUNS = [
  ["busyday", "busyday", {}, 10],
  ["fresh0922 @8x", "fresh0922", { maxWallMs: 420_000 }, 60],
  ["live0922rec", "live0922rec", { maxWallMs: 600_000 }, 25],
] as const;

describe("a car bound for a staging stall turns straight into it (replayed motion)", () => {
  for (const [name, fixture, opts, minArrivals] of RUNS) {
    it(`${name}: no arrival drives past its stall and comes back`, () => {
      const r = probeArrivals(fixture, opts);
      console.log(summarize(name, r));
      expect(r.arrivals.length).toBeGreaterThanOrEqual(minArrivals); // the replay really parked cars
      const over = r.arrivals.filter((a) => a.overshootU > OVERSHOOT_TOL);
      expect(over.map((a) => `${a.zone} (${a.stall.x},${a.stall.y}) +${a.overshootU.toFixed(1)}u`)).toEqual([]);
      // a rail is only ever driven forward: no car is drawn moving tail-first into its stall
      expect(r.arrivals.filter((a) => a.tailFirstSteps > 0).map((a) => `${a.zone} @${JSON.stringify(a.tailFirstAt)}`)).toEqual([]);
    }, 180_000);
  }
});

describe("LaneGraph.routeOff — leave the road abreast of the turn-in", () => {
  const g = buildDepotLanes();
  const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2;

  it("a TW stall reached from the south collector is turned into on the way up the aisle, not driven past", () => {
    // TW column, x 233.5, faces WEST (its aisle is east of it); turn-in 9u back from the nose
    const to = { x: 242.5, y: 119.65 };
    const r = g.routeOff({ x: 200, y: 175.2 }, 0, to, Math.PI)!;
    expect(r).not.toBeNull();
    expect(r[r.length - 1]).toEqual(to);
    // nothing on the way gets north of the turn-in (the old route went on to Tn, y 74)
    expect(Math.min(...r.map((p) => p.y))).toBeGreaterThan(to.y - 1);
    // the last road point is abreast of it, on a lane line of the temp aisle
    const exit = r[r.length - 2];
    expect(exit.y).toBeCloseTo(to.y, 5);
    expect(Math.abs(Math.abs(exit.x - TEMP_LANE_X) - g.rightOffset)).toBeLessThan(1e-6);
  });

  it("a W stall reached down the west avenue turns in where it stands, short of the SW corner", () => {
    const to = { x: 24.5, y: 120 }; // W column faces west, aisle x 30
    const r = g.routeOff({ x: 60, y: NORTH_LANE_Y + 3.2 }, Math.PI, to, Math.PI)!;
    expect(Math.max(...r.map((p) => p.y))).toBeLessThanOrEqual(to.y + 1e-6);
    const exit = r[r.length - 2];
    expect(exit).toEqual({ x: WEST_AISLE_X - g.rightOffset, y: to.y }); // the southbound lane line
  });

  it("a south-row stall is not taken sideways off the gate spur that runs beside it", () => {
    // S2's last stall (x 187.9) faces SOUTH; the ingress spur passes 12u east of it
    const to = { x: 187.9, y: 188 };
    const r = g.routeOff({ x: 217, y: 213 }, undefined, to, SOUTH)!;
    const exit = r[r.length - 2];
    expect(exit.x).toBeCloseTo(to.x, 5);            // abreast of the stall …
    expect(exit.y).toBeLessThan(SOUTH_LANE_Y);       // … on the collector, coming in from the north
  });

  it("returns null when no lane runs abreast of the point", () => {
    expect(g.routeOff({ x: 200, y: 175.2 }, 0, { x: 150, y: 120 }, NORTH)).toBeNull(); // the middle of a canopy
  });
});
