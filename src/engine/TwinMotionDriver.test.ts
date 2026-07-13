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
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay" }]));
    const v = find("v1")!;
    expect(v.status).toBe("washing");
    expect(v.assignedStall).toMatch(/^WASH-/);
    expect(useDepotStore.getState().stalls.find((s) => s.id === dcfc)!.status).toBe("available");
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
    twinMotionDriver.reconcile(snap([])); // gone from the backend
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
    for (let i = 0; i < 500; i++) twinMotionDriver.tickMotion(0.05); // ~25s of driving
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
    // but a LANE CHANGE still honors the twin's exact stall
    twinMotionDriver.setTwinStallMap([{ id: "uuid-w2", code: "NASH-WASH-BAY-02", type: "wash_bay" }]);
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay", stall_id: "uuid-w2" }]));
    expect(find("v1")!.assignedStall).toBe("WASH-02");
  });

  it("a parked car whose route starts BEHIND it backs out in reverse first", () => {
    // car parked in a WASH bay, nosed NORTH (toward the bays)
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay" }]));
    const p0 = { ...poseStore.get("v1")! };
    expect(Math.abs(p0.heading - -Math.PI / 2)).toBeLessThan(0.01); // facing north
    // backend stages it SOUTH (behind its north nose) → must back out first
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }]));
    const entries = (twinMotionDriver as unknown as {
      entries: Map<string, { reverse: unknown }>;
    }).entries;
    expect(entries.get("v1")!.reverse).not.toBeNull(); // a back-out was initiated
    // and it plays out cleanly (finite pose, no NaN) through the maneuver
    for (let i = 0; i < 40; i++) twinMotionDriver.tickMotion(0.05);
    const p1 = poseStore.get("v1")!;
    expect(isFinite(p1.x) && isFinite(p1.y) && isFinite(p1.heading)).toBe(true);
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
});
