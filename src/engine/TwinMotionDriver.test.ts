import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { poseStore } from "./motion/poseStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";

// Minimal snapshot carrying only what the driver reads (fleet.vehicles).
function snap(vehicles: { id: string; state: string; soc?: number; platform?: string; stall_id?: string | null }[], runId = "t"): TwinSnapshot {
  return {
    run: { sim_run_id: runId, scenario: "t", status: "running", sim_clock: "", tick_count: 1, time_scale: 1, seed: 1 },
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v) => ({ av_id: v.id, make: "x", stall_id: null, soc: 50, platform: "waymo", ...v })),
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

const fleet = () => useVehicleStore.getState().vehicles;
const find = (id: string) => fleet().find((v) => v.id === id);
// commit-and-hold: fast-forward a docked service car past its visible-dwell floor
const passDwell = (id: string) => {
  const e = (twinMotionDriver as unknown as {
    entries: Map<string, { dwellStartMs: number | null }>;
  }).entries.get(id);
  if (e && e.dwellStartMs != null) e.dwellStartMs -= 13000;
};
const distToStall = (v: { position: { x: number; y: number } }, stallId: string) => {
  const s = useDepotStore.getState().stalls.find((st) => st.id === stallId)!;
  return Math.hypot(v.position.x - s.position.x, v.position.y - s.position.y);
};

describe("TwinMotionDriver — kinematic motion off the twin", () => {
  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 115, 2);
  });

  it("a fresh arrival enters at the ingress and drives to a STAGING stall (no line)", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    const v = find("v1")!;
    expect(v.status).toBe("staging");                // parked in staging, not lined up
    expect(v.assignedStall).toMatch(/^STAGE-/);      // targets a real staging stall
    expect(v.position.y).toBeGreaterThan(150);        // starts at the south ingress (not teleported north)
    const st = useDepotStore.getState().stalls.find((s) => s.id === v.assignedStall)!;
    expect(Math.hypot(v.position.x - st.position.x, v.position.y - st.position.y)).toBeGreaterThan(5); // still driving to it
    expect(typeof v.heading).toBe("number");
  });

  it("on a state change it reserves a stall and ROUTES (does not teleport onto it)", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const v = find("v1")!;
    expect(v.status).toBe("charging");
    expect(v.assignedStall).toMatch(/^DCFC-/);
    expect(distToStall(v, v.assignedStall!)).toBeGreaterThan(20); // still at the gate, will drive
    const stall = useDepotStore.getState().stalls.find((s) => s.id === v.assignedStall)!;
    expect(stall.status).toBe("charging"); // stall reserved
  });

  it("keeps a STABLE stall assignment across repeated snapshots", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const first = find("v1")!.assignedStall;
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    expect(find("v1")!.assignedStall).toBe(first);
  });

  it("re-assigns + frees the old stall when the backend moves it (charge → wash)", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const dcfc = find("v1")!.assignedStall!;
    // commit-and-hold: the car is SEEN charging first, then moves to wash after
    // its visible dwell — advance past the floor to observe the transition
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay" }])); // held at charger
    passDwell("v1");
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay" }])); // released → wash
    const v = find("v1")!;
    expect(v.status).toBe("washing");
    expect(v.assignedStall).toMatch(/^WASH-/);
    expect(useDepotStore.getState().stalls.find((s) => s.id === dcfc)!.status).toBe("available");
  });

  it("REAR EXIT: a serviced bay car pulls out the rear (north) and routes EAST, never west toward the BESS", () => {
    // the initial snapshot places v1 parked IN a wash bay (no drive-in)
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay" }]));
    expect(find("v1")!.assignedStall).toMatch(/^WASH-/);
    const bay = poseStore.get("v1")!;
    expect(bay.y).toBeGreaterThan(34);   // seated in the bay row (y≈41)
    expect(bay.y).toBeLessThan(50);
    // the twin sends it on to staging → it must LEAVE the bay
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }]));
    passDwell("v1");
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }]));
    let minX = Infinity, reachedApron = false;
    for (let i = 0; i < 400; i++) {
      twinMotionDriver.tickMotion(0.05);
      const p = poseStore.get("v1")!;
      minX = Math.min(minX, p.x);
      if (p.y < 30) reachedApron = true;   // pulled forward out the rear into the apron
    }
    expect(reachedApron).toBe(true);        // exited the REAR (north), not reversed out the front
    expect(minX).toBeGreaterThan(110);      // never headed WEST toward the fenced BESS / switchgear
  });

  it("never double-books a stall", () => {
    twinMotionDriver.reconcile(snap([
      { id: "a", state: "charging_dcfc" },
      { id: "b", state: "charging_dcfc" },
    ]));
    expect(find("a")!.assignedStall).not.toBe(find("b")!.assignedStall);
  });

  it("a vehicle the backend drops heads for the egress gate", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    twinMotionDriver.reconcile(snap([])); // gone from the backend (mid-dwell → held)
    passDwell("v1");
    twinMotionDriver.reconcile(snap([])); // floor met → departs
    expect(find("v1")!.status).toBe("departing");
  });

  it("kinematically DRIVES a routed vehicle toward its stall (no teleport, no slide)", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const stallId = find("v1")!.assignedStall!;
    const stall = useDepotStore.getState().stalls.find((s) => s.id === stallId)!;
    // live position comes from the imperative poseStore, not the React roster
    const d = () => { const lp = poseStore.get("v1")!; return Math.hypot(lp.x - stall.position.x, lp.y - stall.position.y); };
    const d0 = d();
    expect(d0).toBeGreaterThan(20);
    // east ingress → a west-of-center DCFC stall is the depot's LONGEST arrival
    // route (across the south boulevard, up the far gap lane), so allow the full
    // taxi time — the point is it DRIVES the whole way and docks, no teleport.
    for (let i = 0; i < 1400; i++) twinMotionDriver.tickMotion(0.05); // ~70s of driving
    const d1 = d();
    expect(d1).toBeLessThan(d0); // drove measurably closer to its stall
    expect(d1).toBeLessThan(6);  // and effectively arrived
  });

  it("parks a vehicle in the twin's EXACT assigned stall when the layout maps it", () => {
    twinMotionDriver.setTwinStallMap([
      { id: "uuid-dcfc-7", code: "NASH-DCFC-STALL-07", type: "dcfc" },
      { id: "uuid-stage-42", code: "NASH-STAGING-STALL-42", type: "staging" },
    ]);
    twinMotionDriver.reconcile(snap([
      { id: "v1", state: "charging_dcfc", stall_id: "uuid-dcfc-7" },
      { id: "v2", state: "arrived_at_gate", stall_id: "uuid-stage-42" }, // brain's congestion park
      { id: "v3", state: "charging_dcfc", stall_id: "uuid-unknown" },    // unmapped → fallback
    ]));
    expect(find("v1")!.assignedStall).toBe("DCFC-07");   // OTTO-Q's exact pick, rendered
    expect(find("v2")!.assignedStall).toBe("STAGE-42");  // exact staging park too
    expect(find("v3")!.assignedStall).toMatch(/^DCFC-/); // graceful zone fallback
    expect(find("v3")!.assignedStall).not.toBe("DCFC-07"); // no double-book
  });

  it("NEVER migrates a car to a 'better' stall in the same lane (stability bias)", () => {
    // v1 gets a zone-based stall first (no layout map yet)
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const first = find("v1")!.assignedStall!;
    // the twin then names a DIFFERENT dcfc stall — same lane → must NOT reshuffle
    twinMotionDriver.setTwinStallMap([{ id: "uuid-d9", code: "NASH-DCFC-STALL-09", type: "dcfc" }]);
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc", stall_id: "uuid-d9" }]));
    expect(find("v1")!.assignedStall).toBe(first); // stays put — no fleet reshuffles
    // but a LANE CHANGE still honors the twin's exact stall (after the charge
    // dwell — commit-and-hold keeps it at the charger until the floor)
    twinMotionDriver.setTwinStallMap([{ id: "uuid-w2", code: "NASH-WASH-BAY-02", type: "wash_bay" }]);
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay", stall_id: "uuid-w2" }])); // held
    passDwell("v1");
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay", stall_id: "uuid-w2" }])); // → wash
    expect(find("v1")!.assignedStall).toBe("WASH-02");
  });

  it("a serviced bay car pulls THROUGH forward (no reverse) — bays are pull-through, not back-out", () => {
    // car parked in a WASH bay, nosed NORTH (toward the rear apron)
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay" }]));
    const p0 = { ...poseStore.get("v1")! };
    expect(Math.abs(p0.heading - -Math.PI / 2)).toBeLessThan(0.01); // facing north
    // the twin stages it onward — a pull-through bay is exited FORWARD out the
    // rear (north), never reversed out the front
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }])); // held (dwell)
    passDwell("v1");
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }])); // released → staging
    const entries = (twinMotionDriver as unknown as {
      entries: Map<string, { reverse: unknown }>;
    }).entries;
    expect(entries.get("v1")!.reverse).toBeNull(); // NO back-out — pulls forward out the rear
    // and it plays out cleanly (finite pose, no NaN), advancing NORTH into the apron
    for (let i = 0; i < 40; i++) twinMotionDriver.tickMotion(0.05);
    const p1 = poseStore.get("v1")!;
    expect(isFinite(p1.x) && isFinite(p1.y) && isFinite(p1.heading)).toBe(true);
    expect(p1.y).toBeLessThan(p0.y); // moved north toward the rear apron, not south
  });

  it("a RUN SWITCH resets the scene — the old fleet vanishes instead of ghost-departing", () => {
    twinMotionDriver.reconcile(snap([{ id: "old1", state: "charge_complete_holding" }], "run-A"));
    expect(find("old1")).toBeDefined();
    twinMotionDriver.reconcile(snap([{ id: "new1", state: "charge_complete_holding" }], "run-B"));
    expect(find("old1")).toBeUndefined();          // no 100-car ghost wave to the egress
    expect(poseStore.get("old1")).toBeUndefined();
    expect(find("new1")).toBeDefined();            // the new run's fleet is placed
  });

  it("a deploy wave departs in STAGGERED packets and always fully drains", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `w${i}`);
    twinMotionDriver.reconcile(snap(ids.map((id) => ({ id, state: "staged_for_departure" }))));
    expect(fleet().length).toBe(30);
    twinMotionDriver.reconcile(snap([])); // the twin deploys ALL of them at once
    // only a packet drives at a time — the rest wait parked (no perimeter flood)
    const entries = (twinMotionDriver as unknown as { entries: Map<string, { vstatus: string; tracker: unknown }> }).entries;
    let active = 0;
    for (const [, e] of entries) if (e.vstatus === "departing" && e.tracker) active++;
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThanOrEqual(12);
    // and the wave GUARANTEED-drains (egress arrivals + TTL backstop): ~130s sim
    for (let i = 0; i < 2600; i++) twinMotionDriver.tickMotion(0.05);
    expect(fleet().length).toBe(0);
    expect(poseStore.get("w0")).toBeUndefined();
  });

  it("spawn ADMISSION CONTROL: arrivals never materialize on top of each other", () => {
    const first = Array.from({ length: 8 }, (_, i) => `a${i}`);
    twinMotionDriver.reconcile(snap(first.map((id) => ({ id, state: "arrived_at_gate" }))));
    // second poll lands while the first batch still sits at the ingress —
    // blocked spots defer their arrivals instead of stacking cars
    const second = Array.from({ length: 8 }, (_, i) => `b${i}`);
    twinMotionDriver.reconcile(snap([...first, ...second].map((id) => ({ id, state: "arrived_at_gate" }))));
    const poses = fleet().map((v) => poseStore.get(v.id)!).filter(Boolean);
    expect(poses.length).toBeLessThan(16); // some were deferred, not stacked
    for (let i = 0; i < poses.length; i++) {
      for (let j = i + 1; j < poses.length; j++) {
        const d = Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y);
        expect(d).toBeGreaterThan(2); // no two cars share a spawn spot
      }
    }
  });

  it("STAGGER never freezes a mid-taxi car mid-lane (no diagonal statues)", () => {
    // three arrival waves so >12 entries exist, the last wave still mid-drive
    const wave = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const a = wave("a", 6), b = wave("b", 6), c = wave("c", 6);
    const arrived = (id: string) => ({ id, state: "arrived_at_gate" });
    twinMotionDriver.reconcile(snap(a.map(arrived)));
    for (let i = 0; i < 200; i++) twinMotionDriver.tickMotion(0.05);
    twinMotionDriver.reconcile(snap([...a, ...b].map(arrived)));
    for (let i = 0; i < 200; i++) twinMotionDriver.tickMotion(0.05);
    twinMotionDriver.reconcile(snap([...a, ...b, ...c].map(arrived)));
    for (let i = 0; i < 40; i++) twinMotionDriver.tickMotion(0.05);
    // the twin deploys ALL of them → the stagger may queue the excess, but a
    // queued MID-TAXI car keeps its route (finishes its pull-in) — a tracker-
    // null "waiting" car must always be physically AT its stall, never mid-lane
    twinMotionDriver.reconcile(snap([]));
    const entries = (twinMotionDriver as unknown as {
      entries: Map<string, { vstatus: string; tracker: unknown; stallId: string | null; car: { x: number; y: number } }>;
    }).entries;
    const statues = [...entries.entries()].filter(([, e]) => {
      if (e.vstatus !== "departing" || e.tracker || !e.stallId) return false;
      const st = useDepotStore.getState().stalls.find((s) => s.id === e.stallId)!;
      return Math.hypot(e.car.x - st.position.x, e.car.y - st.position.y) > 3;
    });
    expect(statues.length).toBe(0);
    // and the wave still fully drains (packets + TTL backstop)
    for (let i = 0; i < 3200; i++) twinMotionDriver.tickMotion(0.05);
    expect(fleet().length).toBe(0);
  });

  it("RE-ADOPTION REPAIR: a tracker-less car away from its stall is re-routed when the backend re-adopts it", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    for (let i = 0; i < 60; i++) twinMotionDriver.tickMotion(0.05);
    const entries = (twinMotionDriver as unknown as {
      entries: Map<string, { vstatus: string; tracker: unknown; reverse: unknown; stallId: string | null; car: { x: number; y: number; speed: number } }>;
    }).entries;
    const e = entries.get("v1")!;
    expect(e.stallId).toMatch(/^STAGE-/);
    // manufacture the legacy frozen state (tow-freeze / any tracker-null residue):
    // mid-lane, mid-turn heading, no route
    e.tracker = null;
    e.reverse = null;
    e.car.speed = 0;
    // same-lane snapshot again → the stability-bias branch must detect the car
    // is NOT at its stall pose and re-issue a route instead of keeping it frozen
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    // repaired: either routed directly (rail) or backing out first (reverse,
    // with the rail rebuilt at the cusp) — never left frozen
    const e2 = entries.get("v1")! as unknown as { tracker: unknown; reverse: unknown };
    expect(e2.tracker !== null || e2.reverse !== null).toBe(true);
  });

  it("TWIN STALL TRUTH: a faulted stall recolors offline and repels assignment", () => {
    // map a twin stall uuid onto the renderer's first L2 stall, then fault it
    (twinMotionDriver as unknown as { twinStall: Map<string, string> }).twinStall.set("uuid-l2-01", "L2-01");
    const s = snap([{ id: "v1", state: "charging_l2" }]);
    (s as unknown as { stalls_status: { id: string; status: string; vehicle_id: string | null }[] }).stalls_status =
      [{ id: "uuid-l2-01", status: "faulted", vehicle_id: null }];
    twinMotionDriver.reconcile(s);
    expect(useDepotStore.getState().stalls.find((x) => x.id === "L2-01")!.status).toBe("offline");
    expect(find("v1")!.assignedStall).not.toBe("L2-01"); // routed around the dead charger
  });

  it("COMMIT-AND-HOLD: a car keeps its charger through a downstream flip until the dwell floor, then releases", () => {
    const entries = (twinMotionDriver as unknown as {
      entries: Map<string, { playback: string; dwellStartMs: number | null }>;
    }).entries;
    // placed at a DCFC charger — docked immediately (initial in-place placement)
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const dcfc = find("v1")!.assignedStall!;
    expect(dcfc).toMatch(/^DCFC-/);
    expect(entries.get("v1")!.playback).toBe("docked");
    // twin flips it downstream (charge done → holding=staging) BEFORE the floor →
    // the car must HOLD its charger (be SEEN charging), not snap to staging
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }]));
    expect(find("v1")!.assignedStall).toBe(dcfc);
    expect(entries.get("v1")!.playback).not.toBe("released");
    // once the visible-dwell floor has elapsed, the next poll RELEASES it to truth
    entries.get("v1")!.dwellStartMs! -= 13000;
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }]));
    expect(find("v1")!.assignedStall).toMatch(/^STAGE-/); // moved on to staging
  });

  it("COMMIT-AND-HOLD: a mid-dwell car that vanishes from the snapshot is not launched until the floor", () => {
    const entries = (twinMotionDriver as unknown as {
      entries: Map<string, { playback: string; dwellStartMs: number | null; vstatus: string }>;
    }).entries;
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_l2" }]));
    expect(entries.get("v1")!.playback).toBe("docked");
    // twin drops it (deployed) mid-dwell → must NOT depart yet
    twinMotionDriver.reconcile(snap([]));
    expect(entries.get("v1")!.vstatus).not.toBe("departing");
    // after the floor, it departs
    entries.get("v1")!.dwellStartMs! -= 13000;
    twinMotionDriver.reconcile(snap([]));
    expect(entries.get("v1")!.vstatus).toBe("departing");
  });

  it("MASS CHARGE: a batch of staged cars all assigned to chargers at once eventually DOCK (stagger drains, no gridlock)", () => {
    const entries = (twinMotionDriver as unknown as {
      entries: Map<string, { lane: string; playback: string; tracker: unknown }>;
    }).entries;
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const chargeState = (i: number) => (i % 3 === 0 ? "charging_dcfc" : "charging_l2");
    // arrive + let them settle into staging stalls
    twinMotionDriver.reconcile(snap(ids.map((id) => ({ id, state: "arrived_at_gate" }))));
    for (let i = 0; i < 600; i++) twinMotionDriver.tickMotion(0.05);
    // BATCH-assign the whole set to chargers in one snapshot (the gridlock trigger)
    twinMotionDriver.reconcile(snap(ids.map((id, i) => ({ id, state: chargeState(i) }))));
    // drive a long time, re-reconciling so the stagger releases deferred cars as
    // earlier ones dock and free approach slots
    for (let round = 0; round < 40; round++) {
      for (let i = 0; i < 200; i++) twinMotionDriver.tickMotion(0.05);
      twinMotionDriver.reconcile(snap(ids.map((id, i) => ({ id, state: chargeState(i) }))));
    }
    let docked = 0;
    for (const id of ids) {
      const e = entries.get(id);
      if (e && (e.lane === "dcfc" || e.lane === "l2") && e.playback === "docked" && !e.tracker) docked++;
    }
    expect(docked).toBeGreaterThanOrEqual(10); // the batch drains + docks, no gridlock
  });

  it("arrivals disperse to separate staging stalls and drive in (no shared line)", () => {
    const ids = ["a", "b", "c", "d", "e"];
    twinMotionDriver.reconcile(snap(ids.map((id) => ({ id, state: "arrived_at_gate" }))));
    // each arrival gets its OWN staging stall — never a shared queue line
    const stalls = ids.map((id) => find(id)!.assignedStall!);
    expect(new Set(stalls).size).toBe(ids.length);
    expect(stalls.every((s) => /^STAGE-/.test(s))).toBe(true);
    // and they enter from the ingress and spread across the depot toward those stalls
    for (let i = 0; i < 300; i++) twinMotionDriver.tickMotion(0.05);
    const ps = ids.map((id) => poseStore.get(id)!);
    const spreadX = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    const spreadY = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
    expect(Math.max(spreadX, spreadY)).toBeGreaterThan(12); // dispersed, not stacked in one spot
  });

  it("PAUSE freezes every car in place, and RESUME continues without a catch-up jump", () => {
    const ids = ["p1", "p2", "p3"];
    twinMotionDriver.reconcile(snap(ids.map((id) => ({ id, state: "arrived_at_gate" }))));
    for (let i = 0; i < 60; i++) twinMotionDriver.tickMotion(0.05); // get them rolling
    const moving = ids.map((id) => ({ ...poseStore.get(id)! }));
    expect(moving.some((p, i) => Math.hypot(p.x - moving[i].x, p.y - moving[i].y) >= 0)).toBe(true);

    // held: the world stops dead, however long the operator leaves it paused
    twinMotionDriver.setPaused(true);
    const held = ids.map((id) => ({ ...poseStore.get(id)! }));
    for (let i = 0; i < 200; i++) twinMotionDriver.tickMotion(0.05);
    ids.forEach((id, i) => {
      const p = poseStore.get(id)!;
      expect(p.x).toBeCloseTo(held[i].x, 6);
      expect(p.y).toBeCloseTo(held[i].y, 6);
    });

    // a snapshot arriving DURING the hold must not shift anyone: freezing motion
    // (not data) is what lets Resume pick up smoothly instead of teleporting
    twinMotionDriver.reconcile(snap(ids.map((id) => ({ id, state: "charging_dcfc" }))));
    ids.forEach((id, i) => {
      const p = poseStore.get(id)!;
      expect(Math.hypot(p.x - held[i].x, p.y - held[i].y)).toBeLessThan(1e-6);
    });

    // released: motion resumes and the depot does NOT lurch forward by the length
    // of the pause. Driven through the real loop entry point (step), because that
    // is where a stale `last` timestamp would turn a 30s hold into one huge dt.
    const drv = twinMotionDriver as unknown as { step: (ts: number) => void };
    twinMotionDriver.setPaused(false);
    const before = ids.map((id) => ({ ...poseStore.get(id)! }));
    drv.step(1_000_000);          // wall clock jumped 30s during the hold
    drv.step(1_000_050);          // one ordinary 50ms frame after it
    const resumed = ids.map((id, i) => {
      const p = poseStore.get(id)!;
      return Math.hypot(p.x - before[i].x, p.y - before[i].y);
    });
    // a 30-second catch-up would fling a car clear across the 300-unit site;
    // a correctly re-seeded clock moves it a fraction of a lane
    expect(Math.max(...resumed)).toBeLessThan(5);

    for (let i = 0; i < 60; i++) twinMotionDriver.tickMotion(0.05);
    const after = ids.map((id, i) => {
      const p = poseStore.get(id)!;
      return Math.hypot(p.x - before[i].x, p.y - before[i].y);
    });
    expect(Math.max(...after)).toBeGreaterThan(1); // genuinely moving again
  });
});
