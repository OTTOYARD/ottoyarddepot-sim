import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { useSimulationStore } from "@/store/simulationStore";
import { poseStore } from "./motion/poseStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { DISCONNECT_SECONDS } from "@/lib/ottoChargeArm/armStateMachine";
import { PARK_RUNS } from "@/lib/sitePlan";

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
/** Is this stall under a PERIMETER CARPORT (the W/E/S runs)? Daytime parking
 *  there is the failure state the founder named; the open NE block is intake. */
const isPerimeterCarport = (stallId: string | null | undefined) => {
  const s = useDepotStore.getState().stalls.find((st) => st.id === stallId);
  if (!s) return false;
  return PARK_RUNS.some((r) => {
    const c = r.carport;
    return !!c && s.position.x >= c.x && s.position.x <= c.x + c.w
      && s.position.y >= c.y && s.position.y <= c.y + c.h;
  });
};

describe("TwinMotionDriver — kinematic motion off the twin", () => {
  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  it("an arrival OTTO-Q reserved NOTHING for drives to a staging stall (no line)", () => {
    // UPDATED (A3) — scope narrowed on purpose. This test used to stand for
    // "an arrival gets a STAGE- stall", which is the defect: it got one ALWAYS,
    // even when OTTO-Q had a charger reserved for it. Staging is right only when
    // nothing was reserved, which is what this now says; the reserved case is
    // covered in "arrivals go to what they need" below.
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
    // NOTE: the staging code here is a REAL backend one (NASH-STG-<group><nnn>).
    // It used to be 'NASH-STAGING-STALL-42', a shape the backend never emits —
    // so this test passed while the mapping it "covered" was collapsing all six
    // real staging groups onto nineteen renderer stalls. See the group-collision
    // test below.
    twinMotionDriver.setTwinStallMap([
      { id: "uuid-dcfc-7", code: "NASH-DCFC-STALL-07", type: "dcfc" },
      { id: "uuid-stage-b4", code: "NASH-STG-B004", type: "staging" },
    ]);
    twinMotionDriver.reconcile(snap([
      { id: "v1", state: "charging_dcfc", stall_id: "uuid-dcfc-7" },
      { id: "v2", state: "arrived_at_gate", stall_id: "uuid-stage-b4" }, // brain's congestion park
      { id: "v3", state: "charging_dcfc", stall_id: "uuid-unknown" },    // unmapped → fallback
    ]));
    expect(find("v1")!.assignedStall).toBe("DCFC-07");   // OTTO-Q's exact pick, rendered
    expect(find("v2")!.assignedStall).toBe("STAGE-04");  // exact staging park too
    expect(find("v3")!.assignedStall).toMatch(/^DCFC-/); // graceful zone fallback
    expect(find("v3")!.assignedStall).not.toBe("DCFC-07"); // no double-book
  });

  it("STALL-NAME COLLAPSE: the twin's six staging GROUPS never share a renderer stall", () => {
    // The backend names staging NASH-STG-{B,E,I,N,S,W}001..019. Keeping only the
    // trailing digits mapped B004, E004, I004, N004, S004 and W004 all onto
    // STAGE-04 — ~100 twin stalls onto 19 renderer slots, every one of them in
    // the WEST PERIMETER CARPORT column, which aimed a large share of all
    // staging traffic at the perimeter.
    // SIZE IS DERIVED FROM THE RENDERER, NOT HARDCODED. This used to build a flat
    // 6 x 19 = 114 and assert 114 against a renderer that drew 115 staging stalls. The
    // founder's 2026-08-11 cut of the two temp columns (13 -> 12) took the renderer to
    // 113, and the test then failed on the LAST assertion — not because the mapping
    // collapsed, but because slot 114 named a stall that no longer exists. That is a
    // real property, and it is now asserted as its own precondition instead of being
    // smuggled in via a magic number that silently tracked one particular layout.
    const groups = ["B", "E", "I", "N", "S", "W"];
    const stagingCount = useDepotStore.getState().stalls.filter((s) => s.type === "staging").length;
    // spread the count over the six groups, remainder to the earliest — every group
    // still shares an index range with every other, which is what reproduces the
    // original collapse (B004 / E004 / … / W004 all landing on STAGE-04).
    const per = groups.map((_, i) =>
      Math.floor(stagingCount / groups.length) + (i < stagingCount % groups.length ? 1 : 0));
    const layout = groups.flatMap((g, gi) =>
      Array.from({ length: per[gi] }, (_, i) => ({
        id: `stg-${g}-${i + 1}`,
        code: `NASH-STG-${g}${String(i + 1).padStart(3, "0")}`,
        type: "staging",
      })),
    );
    expect(layout.length).toBe(stagingCount);
    expect(Math.min(...per)).toBeGreaterThanOrEqual(4); // the index ranges really do overlap

    twinMotionDriver.setTwinStallMap(layout);
    const map = (twinMotionDriver as unknown as { twinStall: Map<string, string> }).twinStall;

    // the two the founder's depot actually collided on
    expect(map.get("stg-B-4")).toBeDefined();
    expect(map.get("stg-W-4")).toBeDefined();
    expect(map.get("stg-B-4")).not.toBe(map.get("stg-W-4"));

    // …and no pair anywhere in the layout collides
    const resolved = layout.map((s) => map.get(s.id)).filter((x): x is string => !!x);
    expect(resolved.length).toBe(stagingCount);        // every twin stall mapped
    expect(new Set(resolved).size).toBe(stagingCount); // onto that many DISTINCT stalls
    // every one resolves to a stall the renderer actually draws. This holds only while
    // the twin's staging count does not EXCEED the renderer's: setTwinStallMap numbers
    // slots 1..N with no reference to renderer capacity, so a twin with more staging
    // rows than the renderer draws would aim cars at stalls that do not exist. Today
    // the two are the same number by construction (the seed mints what sitePlan draws),
    // so this is stated as a precondition rather than left implicit.
    const ids = new Set(useDepotStore.getState().stalls.map((s) => s.id));
    expect(layout.length).toBeLessThanOrEqual(stagingCount);
    expect(resolved.every((r) => ids.has(r))).toBe(true);
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
    const entries = (twinMotionDriver as unknown as { entries: Map<string, { vstatus: string; tracker: unknown; reverse: unknown }> }).entries;
    // A released departer is one that has STARTED leaving — which means a rail
    // OR a back-out maneuver. Cars parked nose-in toward the south apron must
    // reverse out before they can head north to the ring, and during that cusp
    // they legitimately hold no tracker yet. (Counting only `tracker` used to
    // work by accident, back when departures mis-routed FORWARD toward the
    // entrance spur and never needed to reverse.)
    let active = 0;
    for (const [, e] of entries) if (e.vstatus === "departing" && (e.tracker || e.reverse)) active++;
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
    expect(e.stallId).toMatch(/^STAGE-/); // nothing reserved for it → staging
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
    // The gate queue holds FOUR cars per poll, not six. A car body is 10.2u long
    // and the queue may not extend past x≈247, where the SE ring corner replaces
    // the ingress stub as the nearest lane node and an arrival would route the
    // wrong way around the ring (see QUEUE_MAX_X in TwinMotionDriver). Six only
    // ever fit because they were spaced 8u apart — i.e. overlapping. The fifth
    // is DEFERRED, not dropped, which the next poll asserts.
    const ids = ["a", "b", "c", "d"];
    twinMotionDriver.reconcile(snap([...ids, "e"].map((id) => ({ id, state: "arrived_at_gate" }))));
    // each arrival gets its OWN staging stall — never a shared queue line
    const stalls = ids.map((id) => find(id)!.assignedStall!);
    expect(new Set(stalls).size).toBe(ids.length);
    expect(stalls.every((s) => /^STAGE-/.test(s))).toBe(true); // none reserved
    // ...and no two of them are drawn inside each other (bodies are 10.2u long)
    const qs = ids.map((id) => poseStore.get(id)!);
    for (let i = 0; i < qs.length; i++) {
      for (let j = i + 1; j < qs.length; j++) {
        expect(Math.hypot(qs[i].x - qs[j].x, qs[i].y - qs[j].y)).toBeGreaterThan(10.2);
      }
    }
    // and they enter from the ingress and spread across the depot toward those stalls
    for (let i = 0; i < 300; i++) twinMotionDriver.tickMotion(0.05);
    const ps = ids.map((id) => poseStore.get(id)!);
    const spreadX = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    const spreadY = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
    expect(Math.max(spreadX, spreadY)).toBeGreaterThan(12); // dispersed, not stacked in one spot
    // the deferred fifth arrival is not lost — it enters on the next poll
    twinMotionDriver.reconcile(snap([...ids, "e"].map((id) => ({ id, state: "arrived_at_gate" }))));
    expect(poseStore.get("e")).toBeDefined();
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

// ─────────────────────────────────────────────────────────────────────────────
// RUN LIFECYCLE — Stop clears the depot, Pause holds it.
// A stopped run keeps its sim_run_id, so the run-SWITCH check can't see it and
// the scene used to draw the last known positions forever ("Stop doesn't clear
// the depot"). The fix keys on live→terminal — and must NOT fire on `paused`,
// which is a live status the operator expects to freeze the scene, not wipe it.
// ─────────────────────────────────────────────────────────────────────────────
describe("run lifecycle — stop clears, pause holds", () => {
  const withStatus = (s: TwinSnapshot, status: string): TwinSnapshot => ({
    ...s, run: { ...(s.run as object), status },
  } as unknown as TwinSnapshot);

  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  it("STOP (running → completed) clears the scene", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    expect(fleet().length).toBeGreaterThan(0);
    // backend has emptied the depot: same run id, terminal status, no vehicles
    twinMotionDriver.reconcile(withStatus(snap([], "t"), "completed"));
    expect(fleet().length).toBe(0);
    expect(poseStore.get("v1")).toBeUndefined();
  });

  it("PAUSE (running → paused) does NOT clear the scene", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const before = fleet().length;
    expect(before).toBeGreaterThan(0);
    // a paused run still reports its fleet — the scene must survive untouched
    twinMotionDriver.reconcile(withStatus(snap([{ id: "v1", state: "charging_dcfc" }]), "paused"));
    expect(fleet().length).toBe(before);
    expect(find("v1")).toBeDefined();
    // and resuming from pause must not clear either
    twinMotionDriver.reconcile(withStatus(snap([{ id: "v1", state: "charging_dcfc" }]), "running"));
    expect(find("v1")).toBeDefined();
  });

  it("a run already terminal on first sight does not spuriously reset", () => {
    // fresh cockpit load against a completed run: nothing to clear, and the
    // first snapshot must not be treated as a live→terminal edge
    twinMotionDriver.reconcile(withStatus(snap([{ id: "v9", state: "charging_dcfc" }]), "completed"));
    expect(find("v9")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 RENDER CONTRACT — OTTO-Q's timed legs pace the motion.
// The contract supplies WHAT moves and by WHEN; the physics still supplies HOW it
// looks getting there (rails, IDM car-following, node locks). These tests pin the
// two properties that make that true, and the one that must never be true.
// ─────────────────────────────────────────────────────────────────────────────
describe("T4 — timed-leg contract paces motion", () => {
  type Priv = {
    legs: Map<string, unknown>;
    simAnchorClock: number;
    simAnchorAt: number;
    simSpeedX: number;
    simNow(): number;
    contractPace(id: string, rail: { total: number; s: number }): number | undefined;
  };
  const priv = () => twinMotionDriver as unknown as Priv;

  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  const leg = (vehicle_id: string, endInSec: number, nowIso: string) => ({
    leg_id: `L-${vehicle_id}`, vehicle_id, seq: 1, leg_type: "taxi",
    intent: "taxi_to_charger", kind: "travel",
    from_stall: null, to_stall: null,
    from_x: null, from_y: null, to_x: null, to_y: null,
    start_sim: nowIso,
    end_sim: new Date(Date.parse(nowIso) + endInSec * 1000).toISOString(),
    duration_s: endInSec, status: "active", geometry: "measured",
  });

  it("SIM CLOCK runs off the WALL clock — motion continues when the feed stalls", () => {
    const iso = "2026-07-27T12:00:00.000Z";
    const s = snap([{ id: "V1", state: "staged_for_departure" }]);
    s.run.sim_clock = iso;
    s.run.speed_x = 1;
    twinMotionDriver.reconcile(s);

    // simNow() is already extrapolating, so it is a hair past the anchor by the
    // time we read it — that is the mechanism working, not drift. Allow a few ms.
    const t0 = priv().simNow();
    expect(Math.abs(t0 - Date.parse(iso))).toBeLessThan(50);
    // advance the wall clock only — NO new snapshot arrives
    priv().simAnchorAt -= 5000;
    const t1 = priv().simNow();
    expect(t1 - t0).toBeGreaterThanOrEqual(4900);
    expect(t1 - t0).toBeLessThanOrEqual(5100);
  });

  it("speed_x scales the sim clock (2x view = 2 sim seconds per real second)", () => {
    const iso = "2026-07-27T12:00:00.000Z";
    const s = snap([{ id: "V1", state: "staged_for_departure" }]);
    s.run.sim_clock = iso; s.run.speed_x = 2;
    twinMotionDriver.reconcile(s);
    priv().simAnchorAt -= 1000;             // one real second
    expect(priv().simNow() - Date.parse(iso)).toBeGreaterThanOrEqual(1900); // ~2 sim seconds
  });

  it("PACE lands the car at planned_end_sim: 60u of rail with 30s left => ~2 u/s", () => {
    const iso = "2026-07-27T12:00:00.000Z";
    const s = snap([{ id: "V1", state: "staged_for_departure" }]);
    s.run.sim_clock = iso; s.run.speed_x = 1;
    s.legs = [leg("V1", 30, iso)] as never;
    twinMotionDriver.reconcile(s);
    const v = priv().contractPace("V1", { total: 60, s: 0 });
    expect(v).toBeDefined();
    expect(v!).toBeGreaterThan(1.8);
    expect(v!).toBeLessThan(2.2);
  });

  it("an OVERDUE leg is UNCAPPED — a late car catches up instead of crawling forever", () => {
    const iso = "2026-07-27T12:00:00.000Z";
    const s = snap([{ id: "V1", state: "staged_for_departure" }]);
    s.run.sim_clock = iso; s.run.speed_x = 1;
    s.legs = [leg("V1", -60, iso)] as never;   // ended a minute ago
    twinMotionDriver.reconcile(s);
    expect(priv().contractPace("V1", { total: 60, s: 0 })).toBeUndefined();
  });

  it("a car with NO leg is uncapped — pre-T4 behaviour is exactly preserved", () => {
    const iso = "2026-07-27T12:00:00.000Z";
    const s = snap([{ id: "V1", state: "staged_for_departure" }]);
    s.run.sim_clock = iso;
    twinMotionDriver.reconcile(s);
    expect(priv().contractPace("V1", { total: 60, s: 0 })).toBeUndefined();
  });

  it("DWELL legs never steer motion — only kind='travel' is a movement", () => {
    const iso = "2026-07-27T12:00:00.000Z";
    const s = snap([{ id: "V1", state: "charging_dcfc" }]);
    s.run.sim_clock = iso;
    s.legs = [{ ...leg("V1", 30, iso), kind: "charge_curve", leg_type: "charge_dcfc" }] as never;
    twinMotionDriver.reconcile(s);
    expect(priv().legs.size).toBe(0);
    expect(priv().contractPace("V1", { total: 60, s: 0 })).toBeUndefined();
  });

  it("a RUN SWITCH drops the contract — stale legs never pace a new fleet", () => {
    const iso = "2026-07-27T12:00:00.000Z";
    const a = snap([{ id: "V1", state: "staged_for_departure" }], "runA");
    a.run.sim_clock = iso; a.legs = [leg("V1", 30, iso)] as never;
    twinMotionDriver.reconcile(a);
    expect(priv().legs.size).toBe(1);

    const b = snap([{ id: "V9", state: "staged_for_departure" }], "runB");
    b.run.sim_clock = iso;                    // different run, no legs
    twinMotionDriver.reconcile(b);
    expect(priv().legs.has("V1")).toBe(false);
  });
});

describe("robotic tether (OTTO-CHARGE ARM still mated)", () => {
  // A DCFC stall is robot-served, and StopTransaction is NOT the unplug: OTTO-Q holds
  // the vehicle for ~11.5 s while the arm demates. The renderer has to be told, because
  // its own arm animation runs off a local clock that can finish first — and a car shown
  // driving out of a stall the orchestrator has locked is the exact lie this prevents.
  const tetherSnap = (
    rows: { id: string; tethered?: boolean; tether_until?: string | null }[],
    simClock = "2026-08-11T00:12:30.134Z",
  ): TwinSnapshot => {
    const s = snap([]);
    (s as unknown as { run: { sim_clock: string } }).run.sim_clock = simClock;
    (s as unknown as { stalls_status: unknown[] }).stalls_status = rows.map((r) => ({
      id: r.id, status: "occupied", vehicle_id: "v1", ...r,
    }));
    return s;
  };

  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
    twinMotionDriver.setTwinStallMap([{ id: "twin-1", code: "NASH-DCFC-STALL-08", type: "dcfc" }]);
  });

  it("resolves a tethered stall and the demate time still owed", () => {
    twinMotionDriver.reconcile(tetherSnap([
      { id: "twin-1", tethered: true, tether_until: "2026-08-11T00:12:41.634Z" },
    ]));
    expect(twinMotionDriver.isStallTethered("DCFC-08")).toBe(true);
    // 00:12:41.634 - 00:12:30.134 = the 11.5 s demate window
    expect(twinMotionDriver.stallTetherRemainingS("DCFC-08")).toBeCloseTo(11.5, 3);
  });

  it("reports NOT tethered for an untethered stall, an absent flag and an unknown id", () => {
    twinMotionDriver.reconcile(tetherSnap([{ id: "twin-1" }]));
    expect(twinMotionDriver.isStallTethered("DCFC-08")).toBe(false);
    expect(twinMotionDriver.stallTetherRemainingS("DCFC-08")).toBeNull();
    // a stall the layout cannot resolve must not answer "tethered" by accident
    expect(twinMotionDriver.isStallTethered("DCFC-99")).toBe(false);
    expect(twinMotionDriver.stallTetherRemainingS("DCFC-99")).toBeNull();
  });

  it("clears the tether as soon as a later snapshot drops it", () => {
    // The window is ~11.5 s. A tether left standing from a previous snapshot would
    // draw a cable on a car that has already driven away, so the set is rebuilt
    // wholesale every reconcile rather than merged.
    twinMotionDriver.reconcile(tetherSnap([
      { id: "twin-1", tethered: true, tether_until: "2026-08-11T00:12:41.634Z" },
    ]));
    expect(twinMotionDriver.isStallTethered("DCFC-08")).toBe(true);
    twinMotionDriver.reconcile(tetherSnap([{ id: "twin-1", tethered: false }]));
    expect(twinMotionDriver.isStallTethered("DCFC-08")).toBe(false);
  });

  it("falls back to a full demate when the deadline is unusable", () => {
    // Showing the connector a moment too long is a much smaller lie than releasing
    // a car OTTO-Q still has locked, so an unparseable deadline errs toward mated.
    twinMotionDriver.reconcile(tetherSnap([
      { id: "twin-1", tethered: true, tether_until: null },
    ]));
    expect(twinMotionDriver.stallTetherRemainingS("DCFC-08")).toBeCloseTo(DISCONNECT_SECONDS, 3);
  });

  it("never reports negative time once the deadline has passed", () => {
    twinMotionDriver.reconcile(tetherSnap([
      { id: "twin-1", tethered: true, tether_until: "2026-08-11T00:12:20.000Z" },
    ]));
    expect(twinMotionDriver.stallTetherRemainingS("DCFC-08")).toBe(0);
  });
});

// ============================================================================
// THE ARM'S CLOCK.
//
// ChargingArm derives its phase from serviceStartTime / serviceDuration on the
// rendered vehicle. flush() used to hardcode BOTH to null in twin mode, so the
// guard in the arm's frame loop never passed, phaseAt() was never called, and
// every OTTO-CHARGE ARM sat at its 'stowed' initialiser for the entire run.
// Arm GEOMETRY was well covered (kinematics / depotIntegration); nothing
// asserted the clock was published, which is why that shipped. This is that
// missing coverage.
// ============================================================================
describe("service clock published to the arms", () => {
  const CLOCK = "2026-08-11T18:00:00.000Z";
  const priv = () => twinMotionDriver as unknown as {
    simAnchorAt: number;
    dwells: Map<string, unknown[]>;
  };

  /** A snapshot with a sim clock, a mapped DCFC stall and optional dwell legs. */
  const dwellSnap = (
    vehicles: { id: string; state: string; stall_id?: string | null }[],
    legs: Record<string, unknown>[] = [],
    clock = CLOCK,
  ): TwinSnapshot => {
    const s = snap(vehicles);
    (s as unknown as { run: { sim_clock: string; speed_x: number } }).run.sim_clock = clock;
    (s as unknown as { run: { sim_clock: string; speed_x: number } }).run.speed_x = 1;
    (s as unknown as { legs: unknown[] }).legs = legs;
    return s;
  };

  /** A charge DWELL leg (kind != 'travel') at a twin stall. */
  const chargeDwell = (vehicleId: string, twinStall: string, durationS: number, start = CLOCK) => ({
    leg_id: `${vehicleId}-dwell`, vehicle_id: vehicleId, seq: 1,
    leg_type: "charge_dcfc", intent: null, kind: "charge_session",
    from_stall: twinStall, to_stall: twinStall,
    from_x: null, from_y: null, to_x: null, to_y: null,
    start_sim: start,
    end_sim: new Date(Date.parse(start) + durationS * 1000).toISOString(),
    duration_s: durationS, status: "active", geometry: "measured",
  });

  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useSimulationStore.getState().resetConfig();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
    twinMotionDriver.setTwinStallMap([{ id: "twin-d3", code: "NASH-DCFC-STALL-03", type: "dcfc" }]);
  });

  it("publishes OTTO-Q's dwell window as the docked car's service clock", () => {
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }],
      [chargeDwell("v1", "twin-d3", 1500)],
    ));
    const v = find("v1")!;
    expect(v.assignedStall).toBe("DCFC-03");
    expect(v.serviceDuration).toBe(1500);         // OTTO-Q's number, not a guess
    expect(v.serviceStartTime).not.toBeNull();
    // …and it is in the SAME frame as the clock the arm counts against, so
    // `simTime - serviceStartTime` is a real elapsed and not an 18-hour offset.
    twinMotionDriver.tickMotion(0.016);
    const elapsed = useSimulationStore.getState().simTime - v.serviceStartTime!;
    expect(Math.abs(elapsed)).toBeLessThan(2);
  });

  it("NO dwell leg on the wire → NO clock: absence is published, never a plausible guess", () => {
    twinMotionDriver.reconcile(dwellSnap([{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }]));
    expect(find("v1")!.serviceStartTime).toBeNull();
    expect(find("v1")!.serviceDuration).toBeNull();
  });

  it("a dwell leg for a DIFFERENT stall is never borrowed as this dock's clock", () => {
    twinMotionDriver.setTwinStallMap([
      { id: "twin-d3", code: "NASH-DCFC-STALL-03", type: "dcfc" },
      { id: "twin-d9", code: "NASH-DCFC-STALL-09", type: "dcfc" },
    ]);
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }],
      [chargeDwell("v1", "twin-d9", 1500)],   // a different service step
    ));
    expect(find("v1")!.assignedStall).toBe("DCFC-03");
    expect(find("v1")!.serviceStartTime).toBeNull();
  });

  it("a car still DRIVING IN gets no clock — an arm cannot mate into an empty stall", () => {
    // prime the driver so the next newcomer drives in from the ingress
    twinMotionDriver.reconcile(dwellSnap([{ id: "seed", state: "staged_for_departure" }]));
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "seed", state: "staged_for_departure" },
       { id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }],
      [chargeDwell("v1", "twin-d3", 1500)],
    ));
    expect(find("v1")!.assignedStall).toBe("DCFC-03");
    expect(find("v1")!.serviceStartTime).toBeNull(); // still taxiing — no mate yet
  });

  it("the ROSTER FINGERPRINT includes the service window (else the clock never ships)", () => {
    // flush() skips the store push when its fingerprint is unchanged. Status,
    // stall and SoC are all identical across these two polls — only the window
    // appears. If it is not in the key, the arm waits forever for a clock that
    // was already computed.
    twinMotionDriver.reconcile(dwellSnap([{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }]));
    expect(find("v1")!.serviceStartTime).toBeNull();
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }],
      [chargeDwell("v1", "twin-d3", 900)],
    ));
    expect(find("v1")!.serviceDuration).toBe(900);
  });

  it("the DEPOT CLOCK advances from the snapshot's own sim clock, and marks itself live", () => {
    const sim = () => useSimulationStore.getState();
    expect(sim().simTime).toBe(50400);       // frozen default before any run
    expect(sim().simClockLive).toBe(false);
    twinMotionDriver.reconcile(dwellSnap([{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }]));
    twinMotionDriver.tickMotion(0.016);
    const t0 = sim().simTime;
    expect(sim().simClockLive).toBe(true);   // the scrub slider stands down
    expect(t0).not.toBe(50400);
    // one real minute at speed_x = 1 is one sim minute
    priv().simAnchorAt -= 60_000;
    twinMotionDriver.tickMotion(0.016);
    expect(sim().simTime - t0).toBeGreaterThanOrEqual(59);
    expect(sim().simTime - t0).toBeLessThanOrEqual(61);
  });

  it("PAUSE freezes the depot clock with everything else (an arm must not mate on a held depot)", () => {
    twinMotionDriver.reconcile(dwellSnap([{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }]));
    twinMotionDriver.tickMotion(0.016);
    const t0 = useSimulationStore.getState().simTime;
    twinMotionDriver.setPaused(true);
    priv().simAnchorAt -= 60_000;
    twinMotionDriver.tickMotion(0.016);
    expect(useSimulationStore.getState().simTime).toBe(t0);
    twinMotionDriver.setPaused(false);
  });

  it("a RUN SWITCH drops the dwell windows with the rest of the contract", () => {
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "v1", state: "charging_dcfc", stall_id: "twin-d3" }],
      [chargeDwell("v1", "twin-d3", 1500)],
    ));
    expect(priv().dwells.size).toBe(1);
    const b = dwellSnap([{ id: "v2", state: "charging_dcfc" }]);
    (b as unknown as { run: { sim_run_id: string } }).run.sim_run_id = "run-B";
    twinMotionDriver.reconcile(b);
    expect(priv().dwells.size).toBe(0);
  });
});

describe("SoC reaches the roster at full resolution", () => {
  // FOUNDER-OBSERVED: "the state of charge percentage never increases." The roster
  // fingerprint bucketed SoC to 5 points, so React never saw a sub-5-point change and
  // the number on screen sat still for minutes. This is the gate that binds — the 3D
  // badge's own comparator is downstream of it.
  const socSnap = (soc: number): TwinSnapshot =>
    snap([{ id: "v1", state: "charging_dcfc", soc }]);
  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  it("republishes the roster on a ONE point SoC change", () => {
    twinMotionDriver.reconcile(socSnap(41));
    const first = find("v1")?.currentSoC;
    expect(first).toBe(41);
    twinMotionDriver.reconcile(socSnap(42));
    expect(find("v1")?.currentSoC).toBe(42);
  });

  it("carries every point across a climb, not one step in five", () => {
    // 40 -> 46 is six real points. Under the old 5-point fingerprint this whole climb
    // produced at most one visible change.
    const seen: number[] = [];
    for (const soc of [40, 41, 42, 43, 44, 45, 46]) {
      twinMotionDriver.reconcile(socSnap(soc));
      const v = find("v1")?.currentSoC;
      if (v != null && seen[seen.length - 1] !== v) seen.push(v);
    }
    expect(seen).toEqual([40, 41, 42, 43, 44, 45, 46]);
  });
});

// ============================================================================
// A3 — WHERE AN ARRIVAL ACTUALLY GOES.
//
// reconcile() hardcoded `const lane = entering ? "staging" : ...`, so an arrival
// could only ever be given a parking space and OTTO-Q's real assignment was
// discarded. And because 'arrived_at_gate' was named in neither doctrine-aware
// pool, it fell through to the raw ingress-sorted staging list, whose
// nearest-to-INGRESS entries are the SOUTH PERIMETER CARPORT rows.
//
// The depot is a PIT STOP: an arriving car goes to the work it came in for, or
// to TEMP intake staging — never to the perimeter in daylight.
// ============================================================================
describe("arrivals go to what they need, not to an invented perimeter park", () => {
  const dayClock = "2026-08-11T17:00:00.000Z";   // 12:00 depot time — daytime
  const nightClock = "2026-08-12T04:00:00.000Z"; // 23:00 depot time — overnight

  const at = (
    vehicles: { id: string; state: string; stall_id?: string | null }[],
    clock = dayClock,
  ): TwinSnapshot => {
    const s = snap(vehicles);
    (s as unknown as { run: { sim_clock: string } }).run.sim_clock = clock;
    return s;
  };

  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  it("an arrival with a CHARGER reserved is taken to the charger, not to a parking space", () => {
    twinMotionDriver.setTwinStallMap([{ id: "twin-d5", code: "NASH-DCFC-STALL-05", type: "dcfc" }]);
    twinMotionDriver.reconcile(at([{ id: "v1", state: "arrived_at_gate", stall_id: "twin-d5" }]));
    // OTTO-Q reserved DCFC-05 for this car; the renderer used to park it in
    // staging and throw that away.
    expect(find("v1")!.assignedStall).toBe("DCFC-05");
  });

  it("an arrival with a WASH BAY reserved is taken to the bay", () => {
    twinMotionDriver.setTwinStallMap([{ id: "twin-w1", code: "NASH-WSH-01", type: "wash_bay" }]);
    twinMotionDriver.reconcile(at([{ id: "v1", state: "arrived_at_gate", stall_id: "twin-w1" }]));
    expect(find("v1")!.assignedStall).toBe("WASH-01");
  });

  it("an arrival with NOTHING reserved takes the shortest taxi from the gate", () => {
    // MEASURED, and deliberately NOT the intake block. Sending unreserved
    // arrivals to the NE block raised wedged-car time 21% on the busy_day replay:
    // the block is reached up the depot's narrowest corridor and is already full
    // of day holds. The structural fix is capacity (33 short-hold stalls against
    // a 94-car staging peak), not a sort order. See the pool selector.
    twinMotionDriver.reconcile(at([{ id: "v1", state: "arrived_at_gate" }]));
    const stall = find("v1")!.assignedStall!;
    expect(stall).toMatch(/^STAGE-/);
    const s = useDepotStore.getState().stalls.find((x) => x.id === stall)!;
    expect(Math.hypot(s.position.x - 200, s.position.y - 215)).toBeLessThan(40); // INGRESS
  });

  it("OVERNIGHT the perimeter carports are first-class again — night is not day", () => {
    // Overnight flips the intake pool's zone preference. A day HOLD is the case
    // that exercises it (the arrival path is ingress-first at every hour).
    twinMotionDriver.reconcile(at([{ id: "h1", state: "charge_complete_holding" }], nightClock));
    expect(isPerimeterCarport(find("h1")!.assignedStall)).toBe(true);
  });

  it("day HOLDS stay off the perimeter too (charge-complete, service-complete, awaiting service)", () => {
    twinMotionDriver.reconcile(at([
      { id: "h1", state: "charge_complete_holding" },
      { id: "h2", state: "service_complete_holding" },
      { id: "h3", state: "staged_awaiting_service" },
    ]));
    for (const id of ["h1", "h2", "h3"]) {
      expect(isPerimeterCarport(find(id)!.assignedStall)).toBe(false);
    }
  });

  it("a DEPLOY-READY car still stages by the EXIT — that path is doctrine-endorsed, not the failure state", () => {
    // The founder's failure state is a car STRANDED on the perimeter, not a car
    // about to leave staging next to the gate it leaves through. Measured on the
    // captured busy_day run: penalising this pool too did not move deploy-ready
    // cars off the perimeter (there is nowhere else for ~90 of them to be), it
    // just made them eat the 33-stall intake block the arrivals need.
    twinMotionDriver.reconcile(at([{ id: "d1", state: "staged_for_departure" }]));
    const s = useDepotStore.getState().stalls.find((x) => x.id === find("d1")!.assignedStall)!;
    const dOut = Math.hypot(s.position.x - 100, s.position.y - 215); // EGRESS
    expect(dOut).toBeLessThan(60); // pooled by the exit, not scattered
  });

  it("an UNKNOWN stall type can never reach a lane cast — it falls back to staging", () => {
    // The guard has to be a TOTAL function. This codebase has twice been taken
    // down by an unmapped enum value sailing through a seam into a cast.
    useDepotStore.setState({
      stalls: [
        ...useDepotStore.getState().stalls,
        { id: "MYSTERY-01", type: "hydrogen" as never, status: "available",
          vehicleId: null, position: { x: 150, y: 106, angle: 0 } },
      ],
    });
    twinMotionDriver.setTwinStallMap([{ id: "twin-x", code: "NASH-MYSTERY-01", type: "staging" }]);
    (twinMotionDriver as unknown as { twinStall: Map<string, string> }).twinStall
      .set("twin-x", "MYSTERY-01");
    twinMotionDriver.reconcile(at([{ id: "v1", state: "arrived_at_gate", stall_id: "twin-x" }]));
    // no crash, no car parked on an unknown stall type — it lands in staging
    expect(find("v1")!.assignedStall).toMatch(/^STAGE-/);
  });
});

describe("the depot clock stops when the run does", () => {
  // A run that ENDS kept simClockLive true and simTime advancing over a wiped depot.
  // A clock ticking on an empty scene is the same class of lie as a car drawn where
  // none is — and it left the manual scrub slider disabled indefinitely.
  const runSnap = (status: string, clock: string): TwinSnapshot => {
    const s = snap([{ id: "v1", state: "charging_dcfc" }]);
    (s as unknown as { run: Record<string, unknown> }).run.status = status;
    (s as unknown as { run: Record<string, unknown> }).run.sim_clock = clock;
    return s;
  };

  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  // The clock reaches the store on the MOTION tick, not on reconcile — so a live run
  // has to actually tick before simClockLive can be true.
  it("releases the live clock when the run reaches a terminal status", () => {
    twinMotionDriver.reconcile(runSnap("running", "2026-08-11T12:00:00.000Z"));
    twinMotionDriver.tickMotion(0.05);
    expect(useSimulationStore.getState().simClockLive).toBe(true);
    twinMotionDriver.reconcile(runSnap("completed", "2026-08-11T12:05:00.000Z"));
    expect(useSimulationStore.getState().simClockLive).toBe(false);
  });

  it("does not keep advancing sim time over a wiped depot", () => {
    twinMotionDriver.reconcile(runSnap("running", "2026-08-11T12:00:00.000Z"));
    twinMotionDriver.tickMotion(0.05);
    twinMotionDriver.reconcile(runSnap("completed", "2026-08-11T12:05:00.000Z"));
    const frozen = useSimulationStore.getState().simTime;
    twinMotionDriver.reconcile(runSnap("completed", "2026-08-11T12:30:00.000Z"));
    for (let i = 0; i < 20; i++) twinMotionDriver.tickMotion(0.05);
    expect(useSimulationStore.getState().simTime).toBe(frozen);
  });
});

describe("an arrival follows OTTO-Q's COMMAND, not its current stall", () => {
  // The reservation reaches the renderer on the command bus (acceptStallCommand <-
  // ottoq/executors 'assign_stall'). The snapshot's `stall_id` is v.current_stall_id —
  // where the car IS, not what was held for it — and for a car at the gate it is
  // normally null. Reading it as a reservation is fabrication, and it silently made the
  // arrival fix a no-op on real data while its own tests passed.
  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
    twinMotionDriver.setTwinStallMap([
      { id: "twin-dcfc-5", code: "NASH-DCFC-STALL-05", type: "dcfc" },
      { id: "twin-stg-b4", code: "NASH-STG-B004", type: "staging" },
    ]);
  });

  it("routes a gate arrival to the COMMANDED charger when the snapshot names no stall", () => {
    // This is the real-world shape: stall_id null, assignment on the command bus.
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate", stall_id: null }]));
    const ok = twinMotionDriver.acceptStallCommand({
      command_id: "c1", vehicle_id: "v1", twin_stall_id: "twin-dcfc-5", not_after_sim: null,
    });
    expect(ok).toBe(true);
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate", stall_id: null }]));
    expect(find("v1")?.assignedStall).toBe("DCFC-05");
  });

  it("still falls back to a stall the car genuinely already holds", () => {
    // current_stall_id is honest about OCCUPANCY even though it is not a reservation,
    // so a car that already holds a stall is driven to that stall.
    twinMotionDriver.reconcile(snap([
      { id: "v2", state: "arrived_at_gate", stall_id: "twin-stg-b4" },
    ]));
    // one staging GROUP in this map, so A2's mapping keeps the number-preserving
    // form (STAGE-04); the group-prefixed form appears only when groups collide.
    expect(find("v2")?.assignedStall).toBe("STAGE-04");
  });

  it("invents nothing when there is neither a command nor a current stall", () => {
    twinMotionDriver.reconcile(snap([{ id: "v3", state: "arrived_at_gate", stall_id: null }]));
    // falls back to staging — never a perimeter carport during the day
    expect(find("v3")?.assignedStall).toMatch(/^STAGE-/);
  });
});

// ============================================================================
// THE DEPART GATE — the third clause of the founder's arm rule.
//
//   "stay connected the entire time until the car is at desired SoC and then the
//    arm gets ready to disconnect and retract back … and THEN the vehicle can
//    move."
//
// `vehicleMayMove` in armStateMachine has always been the definition of that
// last clause, and until armGate.ts nothing in the motion path called it: a car
// could pull out of a DCFC stall with the connector still in its port. These
// tests exercise it through the real driver, not through the gate in isolation.
//
// MEASURED, not asserted: with armReleases() stubbed back to a constant `true`
// (pre-change behaviour) three of these five fail, and they fail on the thing
// that matters —
//   · the re-tasked car is on STAGE-101 instead of its charger DCFC-01;
//   · the release never passes through unlatch/extract/retract at all;
//   · the DEPARTING car travels 92.0 units with the connector still in its port.
// The other two are the controls (an L2 car, and a car whose arm never mated);
// they pass either way, which is the point of them.
// ============================================================================
describe("TwinMotionDriver — the depart gate (a car may not drive through the arm)", () => {
  const T0 = Date.parse("2026-08-10T12:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  /** A snapshot carrying a real DWELL leg — the only thing on the wire that
   *  publishes a service window, and therefore the proof the car is parked that
   *  the arm needs before it will reach for the port. */
  function armSnap(state: string, clockMs: number, lane: "dcfc" | "l2" = "dcfc"): TwinSnapshot {
    return {
      run: {
        sim_run_id: "arm-run", scenario: "t", status: "running",
        sim_clock: iso(clockMs), tick_count: 1, time_scale: 1, seed: 1, speed_x: 1,
      },
      legs: [{
        leg_id: "leg-1", vehicle_id: "v1", seq: 1,
        leg_type: lane === "dcfc" ? "charge_dcfc" : "charge_l2", intent: null,
        kind: "charge_curve",
        from_stall: null, to_stall: null,
        from_x: null, from_y: null, to_x: null, to_y: null,
        start_sim: iso(T0), end_sim: iso(T0 + 1_800_000), duration_s: 1800,
        status: "active", geometry: "measured",
      }],
      fleet: {
        counts: {}, total: 1,
        vehicles: [{
          id: "v1", av_id: "twin-sim-001", make: "Jaguar", platform: "waymo",
          state, soc: 42, stall_id: null,
        }],
      },
      stalls_status: [], energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;
  }

  /** Poll + tick. The arms are paced by the SIM clock (same choice ChargingArm
   *  makes), and only a snapshot moves it — so a poll is how sim time passes. */
  function pollTo(state: string, clockMs: number, lane: "dcfc" | "l2" = "dcfc") {
    twinMotionDriver.reconcile(armSnap(state, clockMs, lane));
    twinMotionDriver.tickMotion(0.05);
  }

  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  /** Dock a car on a charger and run its arm all the way in. Returns the stall. */
  function mateOnCharger(): string {
    twinMotionDriver.reconcile(armSnap("charging_dcfc", T0));
    const stall = find("v1")!.assignedStall!;
    expect(stall).toMatch(/^DCFC-/);
    // walk the 18.5 s reach: unstow → approach → align → insert → latch → charging
    for (let i = 1; i <= 12; i++) pollTo("charging_dcfc", T0 + i * 5000);
    expect(twinMotionDriver.armPhaseAt(stall)).toBe("charging");
    return stall;
  }

  it("HOLDS a re-tasked car on its charger until the arm has retracted", () => {
    const stall = mateOnCharger();
    expect(twinMotionDriver.armHolds).toEqual([stall]);

    // the twin re-tasks the car (the ordinary end of a pit stop). Clear the
    // commit-and-hold dwell floor so it is the ARM, and only the arm, holding it.
    passDwell("v1");
    const before = { ...poseStore.get("v1")! }; // COPY: poseStore mutates in place
    pollTo("charge_complete_holding", T0 + 70_000);

    // OTTO-Q's decision IS published — that flip is what tells the arm to let go —
    // but the car has not been given a stall to drive to and has not moved.
    expect(find("v1")!.status).toBe("staging");
    expect(find("v1")!.assignedStall).toBe(stall);
    for (let i = 0; i < 400; i++) twinMotionDriver.tickMotion(0.05);
    const after = poseStore.get("v1")!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
    expect(twinMotionDriver.armHolds).toEqual([stall]);
  });

  it("RELEASES it once the arm reports clear — and not one phase earlier", () => {
    const stall = mateOnCharger();
    passDwell("v1");
    let t = T0 + 70_000;
    pollTo("charge_complete_holding", t);

    // watch every phase of the release. The car must still be on its charger for
    // all of unlatch / extract / retract, and may only be re-assigned after.
    const seen: string[] = [twinMotionDriver.armPhaseAt(stall)!];
    let releasedAtPhase: string | null = null;
    for (let i = 0; i < 20 && releasedAtPhase === null; i++) {
      // the phase the NEXT poll's gate decision will be taken against — read
      // before the poll, because a released car stops being an arm's problem and
      // the gate rightly forgets the stall the instant it leaves.
      const deciding = twinMotionDriver.armPhaseAt(stall);
      t += 5000;
      pollTo("charge_complete_holding", t);
      if (!find("v1")!.assignedStall?.startsWith("DCFC-")) { releasedAtPhase = deciding; break; }
      const phase = twinMotionDriver.armPhaseAt(stall);
      if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
    }
    expect(seen).toEqual(["unlatch", "extract", "retract", "clear"]);
    expect(releasedAtPhase).toBe("clear");
    expect(find("v1")!.assignedStall).toMatch(/^STAGE-/);
  });

  it("holds a DEPARTING car too — the departure launch is the other door out", () => {
    const stall = mateOnCharger();
    passDwell("v1");
    const before = { ...poseStore.get("v1")! }; // COPY: poseStore mutates in place
    // the twin drops the vehicle entirely (deployed): a departure, not a re-task
    twinMotionDriver.reconcile({
      ...armSnap("charging_dcfc", T0 + 70_000),
      fleet: { counts: {}, total: 0, vehicles: [] },
    } as unknown as TwinSnapshot);
    expect(find("v1")!.status).toBe("departing"); // the release IS requested…
    for (let i = 0; i < 400; i++) twinMotionDriver.tickMotion(0.05);
    const after = poseStore.get("v1")!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
    expect(twinMotionDriver.armHolds).toEqual([stall]); // …and still refused

    // let the demate play out, then it drives to the egress
    for (let i = 1; i <= 12; i++) {
      twinMotionDriver.reconcile({
        ...armSnap("charging_dcfc", T0 + 70_000 + i * 5000),
        fleet: { counts: {}, total: 0, vehicles: [] },
      } as unknown as TwinSnapshot);
      twinMotionDriver.tickMotion(0.05);
    }
    expect(twinMotionDriver.armHolds).toEqual([]);
    for (let i = 0; i < 200; i++) twinMotionDriver.tickMotion(0.05);
    const gone = poseStore.get("v1");
    expect(gone === undefined || Math.hypot(gone.x - before.x, gone.y - before.y) > 1).toBe(true);
  });

  it("an L2 car is COMPLETELY unaffected — only DCFC stalls have an arm", () => {
    twinMotionDriver.reconcile(armSnap("charging_l2", T0, "l2"));
    const stall = find("v1")!.assignedStall!;
    expect(stall).toMatch(/^L2-/);
    for (let i = 1; i <= 12; i++) pollTo("charging_l2", T0 + i * 5000, "l2");
    expect(twinMotionDriver.armPhaseAt(stall)).toBeNull();
    expect(twinMotionDriver.armHolds).toEqual([]);
    passDwell("v1");
    pollTo("charge_complete_holding", T0 + 70_000, "l2");
    expect(find("v1")!.assignedStall).toMatch(/^STAGE-/); // re-assigned immediately
  });

  it("never holds a car because a signal is ABSENT: no dwell leg, no arm, no hold", () => {
    // the wire carried no service window, so the arm never mated and there is
    // nothing to wait for. Publishing absence, not inventing a connection.
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }], "no-legs"));
    const stall = find("v1")!.assignedStall!;
    expect(stall).toMatch(/^DCFC-/);
    for (let i = 0; i < 50; i++) twinMotionDriver.tickMotion(0.05);
    expect(twinMotionDriver.armPhaseAt(stall)).toBe("stowed");
    passDwell("v1");
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charge_complete_holding" }], "no-legs"));
    expect(find("v1")!.assignedStall).toMatch(/^STAGE-/);
    expect(twinMotionDriver.armHolds).toEqual([]);
  });
});
