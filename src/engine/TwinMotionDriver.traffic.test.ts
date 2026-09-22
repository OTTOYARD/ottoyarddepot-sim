// ============================================================================
// TRAFFIC MECHANISMS — the pieces behind the 2026-09-22 flow fix, one at a time.
//
// TwinMotionDriver.flow.test.ts proves the depot moves on the live captures;
// these pin WHY, so a later change that quietly undoes one mechanism fails here
// by name instead of as a vaguer number there.
// ============================================================================
import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { LaneGraph, buildDepotLanes } from "./motion/LaneGraph";
import { buildRail, movementsConflict, RailLocks, stepRail, type RailBody, type Sweep } from "./motion/RailFlow";
import { EGRESS, GAP_LANES, NORTH_LANE_Y, TEMP_LANE_X } from "@/lib/sitePlan";

type Entry = {
  car: { x: number; y: number; heading: number; speed: number };
  tracker: { pts: { x: number; y: number }[]; s: number; total: number; v: number } | null;
  reverse: { straight?: number; remaining: number; steer: number; end?: { x: number; y: number; hx: number; hy: number } } | null;
  stallId: string | null;
  dwellStartMs: number | null;
};
const internals = () => twinMotionDriver as unknown as {
  entries: Map<string, Entry>;
  legs: Map<string, unknown>;
  contractPace(id: string, rail: { total: number; s: number }): number | undefined;
};
const entry = (id: string) => internals().entries.get(id)!;
const stallPos = (id: string) => useDepotStore.getState().stalls.find((s) => s.id === id)!.position;

function snap(vehicles: { id: string; state: string; stall_id?: string | null }[], extra: Partial<TwinSnapshot> = {}): TwinSnapshot {
  return {
    run: { sim_run_id: "traffic", scenario: "t", status: "running", sim_clock: "", tick_count: 1, time_scale: 1, seed: 1 },
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v) => ({ av_id: v.id, make: "x", stall_id: null, soc: 50, platform: "waymo", ...v })),
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
    ...extra,
  } as unknown as TwinSnapshot;
}
/** release commit-and-hold on a docked service car (its visible-dwell floor) */
const passDwell = (id: string) => { const e = entry(id); if (e.dwellStartMs != null) e.dwellStartMs -= 13000; };

beforeEach(() => {
  twinMotionDriver.clear();
  useVehicleStore.getState().reset();
  useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
});

describe("leaving a charger — the gas-pump exit", () => {
  it("a re-tasked charger car drives OUT forward, up its gap lane, and never south", () => {
    // three cars fill the west DCFC column north-first: DCFC-01..03
    const cars = ["A", "B", "C"].map((id) => ({ id, state: "charging_dcfc" }));
    twinMotionDriver.reconcile(snap(cars));
    const bStall = entry("B").stallId!;
    const st = stallPos(bStall);
    passDwell("B");
    twinMotionDriver.reconcile(snap([cars[0], { id: "B", state: "staged_awaiting_service" }, cars[2]]));

    const e = entry("B");
    // not a back-out: the stall behind it is the next one in the column
    expect(e.reverse).toBeNull();
    expect(e.tracker).not.toBeNull();
    const pts = e.tracker!.pts;
    const gx = Math.abs(st.x - GAP_LANES.westOfA) < Math.abs(st.x - GAP_LANES.AB) ? GAP_LANES.westOfA : GAP_LANES.AB;
    // it reaches its own gap lane NORTH of the stall, then the north collector
    const onLane = pts.findIndex((p) => Math.abs(p.x - gx) < 0.5);
    expect(onLane).toBeGreaterThan(0);
    expect(pts[onLane].y).toBeLessThan(st.y);
    expect(pts.some((p) => Math.abs(p.x - gx) < 0.5 && Math.abs(p.y - NORTH_LANE_Y) < 1)).toBe(true);
    // …and nothing before the collector runs south of where it was parked:
    // the gap lanes are one-way NORTHBOUND (founder-locked doctrine)
    const upToCollector = pts.slice(0, pts.findIndex((p) => Math.abs(p.y - NORTH_LANE_Y) < 1) + 1);
    for (const p of upToCollector) expect(p.y).toBeLessThanOrEqual(st.y + 1e-6);
    // and its path never comes within a lane-half of the cars still parked either side
    for (const other of ["A", "C"]) {
      const o = stallPos(entry(other).stallId!);
      for (const p of upToCollector) expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeGreaterThan(1.7);
    }
  });
});

describe("leaving a staging stall — the back-out", () => {
  it("backs out into its aisle, swings to face along it, and drives off the way it points", () => {
    // pin the car to TE-6 (renderer STAGE-107, nose east, aisle TEMP_LANE_X to its west)
    twinMotionDriver.setTwinStallMap([{ id: "te6", code: "T-107", type: "staging" }]);
    twinMotionDriver.reconcile(snap([{ id: "V", state: "staged_awaiting_service", stall_id: "te6" }]));
    const parkedAt = stallPos(entry("V").stallId!);
    expect(parkedAt.x).toBeGreaterThan(TEMP_LANE_X);

    twinMotionDriver.reconcile(snap([{ id: "V", state: "charging_l2" }]));
    const e = entry("V");
    expect(e.reverse).not.toBeNull();
    expect(e.reverse!.straight).toBeGreaterThan(5);        // straight back first…
    expect(Math.abs(e.reverse!.steer)).toBeCloseTo(0.5, 6); // …then on full lock
    // it plans to finish in the aisle, not across it or back in the column
    expect(Math.abs(e.reverse!.end!.x - TEMP_LANE_X)).toBeLessThan(7.75);

    for (let i = 0; i < 400 && entry("V").reverse; i++) twinMotionDriver.tickMotion(0.05);
    const after = entry("V");
    expect(after.reverse).toBeNull();
    expect(after.tracker).not.toBeNull();
    expect(Math.abs(after.car.x - TEMP_LANE_X)).toBeLessThan(7.75);
    // the rail it now follows starts the way the car is facing — never behind it
    const pts = after.tracker!.pts;
    let k = 1;
    while (k < pts.length - 1 && Math.hypot(pts[k].x - pts[0].x, pts[k].y - pts[0].y) < 4) k++;
    const dir = Math.atan2(pts[k].y - pts[0].y, pts[k].x - pts[0].x);
    let d = dir - after.car.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    expect(Math.abs(d)).toBeLessThan(Math.PI / 3);
  });
});

describe("the stall ledger — a deferred re-task keeps the stall it is still parked in", () => {
  it("the sixth car of a batch re-task (over the approach cap) still holds its staging stall", () => {
    const ids = ["v1", "v2", "v3", "v4", "v5", "v6"];
    twinMotionDriver.reconcile(snap(ids.map((id) => ({ id, state: "staged_awaiting_service" }))));
    const before = new Map(ids.map((id) => [id, entry(id).stallId]));
    // all six re-tasked to a charger at once: five go, one is staggered
    twinMotionDriver.reconcile(snap(ids.map((id) => ({ id, state: "charging_dcfc" }))));
    const waiting = ids.filter((id) => !entry(id).tracker && !entry(id).reverse);
    expect(waiting.length).toBeGreaterThanOrEqual(1);
    for (const id of waiting) {
      // the entry still says its old staging stall, AND the ledger agrees — before
      // the fix the ledger had already moved it to a charger and freed this stall
      expect(entry(id).stallId).toBe(before.get(id));
      expect(twinMotionDriver.stallHeldBy(id)).toBe(before.get(id));
    }
    // no two cars claim one stall
    const held = ids.map((id) => entry(id).stallId);
    expect(new Set(held).size).toBe(held.length);
  });
});

describe("contract pacing at 8x — the deadline is sim time, the car moves in motion time", () => {
  const leg = (vehicle_id: string, endInSec: number, iso: string) => ({
    leg_id: `L-${vehicle_id}`, vehicle_id, seq: 1, kind: "travel",
    start_sim: iso, end_sim: new Date(Date.parse(iso) + endInSec * 1000).toISOString(),
  });
  it("scales the ceiling by viewMult / speed_x, and never paces below a walk", () => {
    const iso = "2026-09-22T12:00:00.000Z";
    const s = snap([{ id: "V1", state: "staged_for_departure" }]);
    s.run.sim_clock = iso;
    (s.run as { speed_x?: number }).speed_x = 8;
    s.legs = [leg("V1", 30, iso)] as never;
    twinMotionDriver.setViewMult(8); // clamps to the 3x motion ceiling
    twinMotionDriver.reconcile(s);
    // 60u with 30 sim-s left = 30 x 3/8 = 11.25 motion-s => 5.33 u/s (was 2.0)
    const v = internals().contractPace("V1", { total: 60, s: 0 })!;
    expect(v).toBeGreaterThan(5.2);
    expect(v).toBeLessThan(5.5);
    // the last unit into a stall with 20 sim-s still on the leg: a walk, not a creep
    s.legs = [leg("V1", 20, iso)] as never;
    twinMotionDriver.reconcile(s);
    expect(internals().contractPace("V1", { total: 1.5, s: 0 })).toBe(2);
    twinMotionDriver.setViewMult(1);
  });
});

describe("lane geometry", () => {
  it("offsetRight takes a MITER join at a corner, so the turn stays in its lane", () => {
    // east, then south (y-down): right of east is south (+y), right of south is west (-x)
    const out = LaneGraph.offsetRight([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 3.2);
    expect(out[1].x).toBeCloseTo(6.8, 6);   // where the two shifted legs actually meet
    expect(out[1].y).toBeCloseTo(3.2, 6);
    // a straight join is unchanged by the miter
    const straight = LaneGraph.offsetRight([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], 3.2);
    expect(straight[1].x).toBeCloseTo(5, 6);
    expect(straight[1].y).toBeCloseTo(3.2, 6);
    // outside [miterFrom, miterTo] a vertex keeps the old chord normal (a road-to-off-road join)
    const chord = LaneGraph.offsetRight([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 3.2, 2, 0);
    expect(Math.hypot(chord[1].x - 10, chord[1].y)).toBeCloseTo(3.2, 6);
  });

  it("a car joins the lane AHEAD of its nose, not the nearest node behind it", () => {
    const g = buildDepotLanes();
    const southbound = g.routeFacing({ x: 249, y: 120 }, Math.PI / 2, { x: EGRESS.x, y: EGRESS.y });
    // the join is on the aisle's southbound drive line, ahead of the car
    expect(southbound[1].x).toBeCloseTo(TEMP_LANE_X - g.rightOffset, 6);
    expect(southbound[1].y).toBeGreaterThan(120);
    // nothing in the route goes back north past the car before the collector
    const beforeCollector = southbound.slice(0, southbound.findIndex((p) => p.y > 168));
    for (const p of beforeCollector) expect(p.y).toBeGreaterThanOrEqual(120 - 1e-6);
    const northbound = g.routeFacing({ x: 249, y: 120 }, -Math.PI / 2, { x: EGRESS.x, y: EGRESS.y });
    expect(northbound[1].x).toBeCloseTo(TEMP_LANE_X + g.rightOffset, 6);
    expect(northbound[1].y).toBeLessThan(120);
  });

  it("a car facing no lane falls back to the ordinary route", () => {
    const g = buildDepotLanes();
    // on the gate approach road facing west: no lane runs west there
    const r = g.routeFacing({ x: 230, y: 213 }, Math.PI, { x: EGRESS.x, y: EGRESS.y });
    expect(r).toEqual(g.route({ x: 230, y: 213 }, { x: EGRESS.x, y: EGRESS.y }));
  });

  it("a car turning RIGHT through a junction still registers it (mitered corners run wide of the node)", () => {
    const g = buildDepotLanes();
    // eastbound on the south collector, right turn at S_eg into the egress spur
    const pts = g.route({ x: 60, y: 175.2 }, { x: EGRESS.x, y: EGRESS.y });
    const rail = buildRail(pts, g.nodes.values(), null);
    expect(rail.nodes.map((n) => n.id)).toContain("S_eg");
  });
});

describe("junctions admit compatible movements together", () => {
  const sweep = (pts: [number, number][]): Sweep => {
    const sw: Sweep = { x: [], y: [], hx: [], hy: [] };
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
      const [px, py] = pts[Math.max(0, i - 1)];
      const dx = i < pts.length - 1 ? nx - x : x - px, dy = i < pts.length - 1 ? ny - y : y - py;
      const m = Math.hypot(dx, dy) || 1;
      sw.x.push(x); sw.y.push(y); sw.hx.push(dx / m); sw.hy.push(dy / m);
    }
    return sw;
  };
  const line = (x0: number, y0: number, x1: number, y1: number, n = 21): [number, number][] =>
    Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)] as [number, number]);

  const eastbound = sweep(line(-10, 3.2, 10, 3.2));
  const westbound = sweep(line(10, -3.2, -10, -3.2));
  const northbound = sweep(line(3.2, 10, 3.2, -10));
  it("the two streams of a divided road pass without waiting for each other", () => {
    expect(movementsConflict(eastbound, westbound)).toBe(false);
  });
  it("a crossing conflicts", () => {
    expect(movementsConflict(eastbound, northbound)).toBe(true);
  });
  it("two approaches into one exit (a merge) conflict", () => {
    const fromSouth = sweep([...line(0, 10, 0, 5, 6), ...line(1, 4, 10, 3.2, 10)]);
    expect(movementsConflict(eastbound, fromSouth)).toBe(true);
  });
  it("one approach is a queue, not a conflict", () => {
    expect(movementsConflict(eastbound, sweep(line(-10, 3.2, 10, 3.2)))).toBe(false);
  });
  it("a junction lets compatible cars in together and holds a conflicting one out", () => {
    const locks = new RailLocks();
    expect(locks.enter("J", "east", eastbound)).toBe(true);
    expect(locks.enter("J", "west", westbound)).toBe(true);   // opposing stream: together
    expect(locks.enter("J", "north", northbound)).toBe(false); // crosses both
    locks.releaseAll("east");
    locks.leave("J", "west");
    expect(locks.enter("J", "north", northbound)).toBe(true);
  });
});

describe("a wait that comes back round is a deadlock, not a queue", () => {
  // Both measured on the fresh 0682752c start (twinRun.fresh0922.json). Before
  // these, only a two-car loop at a junction was recognised, and only by the 45 s
  // watchdog anywhere else.
  const north: Sweep = { x: [], y: [], hx: [], hy: [] };
  const eastAt15: Sweep = { x: [], y: [], hx: [], hy: [] };
  for (let i = 0; i <= 20; i++) {
    north.x.push(0); north.y.push(-5 - i); north.hx.push(0); north.hy.push(-1);
    eastAt15.x.push(-10 + i); eastAt15.y.push(-15); eastAt15.hx.push(1); eastAt15.hy.push(0);
  }
  const far = (id: string, waitsOn: string | null): RailBody =>
    ({ id, x: 60 + id.length, y: 60, heading: 0, moving: true, speed: 0, waitsOn });

  it("a car joining a lane goes when the lane car at its join point is stopped for IT", () => {
    const joining = () => {
      const r = buildRail([{ x: 3, y: 0 }, { x: 0, y: -10 }, { x: 0, y: -40 }], [], null);
      r.merge = { x: 0, y: -10, hx: 0, hy: -1 };
      return r;
    };
    // beside the join point, in the lane's flow, stopped — and (the id order)
    // the one a same-spot tie goes to
    const laneCar = (waitsOn: string | null): RailBody =>
      ({ id: "a-lane", x: -2.5, y: -10, heading: -Math.PI / 2, moving: true, speed: 0, waitsOn });
    const queued = joining();
    stepRail("z-join", queued, 0.05, [laneCar(null)], new RailLocks());
    expect(queued.merge!.committed).toBeFalsy();
    expect(queued.limiter).toBe("merge");

    const blocking = joining();
    stepRail("z-join", blocking, 0.05, [laneCar("z-join")], new RailLocks());
    expect(blocking.merge!.committed).toBe(true);
  });

  it("a junction admits a car whose holder is waiting, through other cars, on it", () => {
    const run = (chainEnd: string) => {
      const locks = new RailLocks();
      locks.enter("J", "holder", eastAt15);
      const r = buildRail([{ x: 0, y: 0 }, { x: 0, y: -40 }], [{ id: "J", x: 0, y: -15 }], null);
      r.nodes[0].sweep = north;
      // holder -> c1 -> c2 -> chainEnd : four cars round, as at Ts / Sg3
      stepRail("me", r, 0.05, [far("holder", "c1"), far("c1", "c2"), far("c2", chainEnd)], locks);
      return { r, locks };
    };
    const queue = run("someone-else");
    expect(queue.locks.holds("J", "me")).toBe(false);
    expect(queue.r.limiter).toBe("node");

    const loop = run("me");
    expect(loop.locks.holds("J", "me")).toBe(true);
    expect(loop.r.limiter).not.toBe("node");
  });
});

describe("stall identity — the twin's stalls drawn where the twin put them", () => {
  it("every stall of the live layout maps, one to one, to the renderer stall standing at its database position", async () => {
    const { FIXTURES } = await import("./__fixtures__/flowReplay");
    const { readFileSync } = await import("node:fs");
    const { planFromDbFeet, PARK_RUNS } = await import("@/lib/sitePlan");
    const live = FIXTURES.live0922.stalls;
    const seed = JSON.parse(readFileSync("unreal/layoutSeed.json", "utf8")) as { stalls: { stall_code: string; render_id: string }[] };
    const seedRun = new Map(seed.stalls.map((s) => [s.stall_code, s.render_id]));
    twinMotionDriver.setTwinStallMap(live);
    const map = (twinMotionDriver as unknown as { twinStall: Map<string, string> }).twinStall;
    const renderer = new Map(useDepotStore.getState().stalls.map((s) => [s.id, s]));
    const runSlot = (x: number, y: number) => {
      for (const r of PARK_RUNS) for (let i = 0; i < r.n; i++) {
        if (Math.hypot(r.x0 + i * r.dx - x, r.y0 + i * r.dy - y) < 0.01) return `${r.id}-${i + 1}`;
      }
      return null;
    };
    expect(live.length).toBe(158);
    const used = new Set<string>();
    let wrongRun = 0;
    for (const s of live) {
      const rid = map.get(s.id);
      expect(rid, s.code).toBeDefined();
      expect(used.has(rid!), `${rid} mapped twice`).toBe(false);
      used.add(rid!);
      const r = renderer.get(rid!)!;
      const p = planFromDbFeet(s.x!, s.y!);
      expect(Math.hypot(r.position.x - p.x, r.position.y - p.y)).toBeLessThan(0.05);
      if (s.type === "staging" && runSlot(r.position.x, r.position.y) !== seedRun.get(s.code)) wrongRun++;
    }
    // the code mapping this replaces put 113 of 113 staging stalls in the wrong run slot
    expect(wrongRun).toBe(0);
  });

  it("a layout without coordinates still maps by code, exactly as before", () => {
    twinMotionDriver.setTwinStallMap([{ id: "d7", code: "NASH-DCFC-STALL-07", type: "dcfc" }]);
    const map = (twinMotionDriver as unknown as { twinStall: Map<string, string> }).twinStall;
    expect(map.get("d7")).toBe("DCFC-07");
  });
});
