// ============================================================================
// A FAULTED CHARGER IS DOWN, AND NO CAR IS ROUTED TO IT — the renderer's half.
//
// Chase, 2026-10-07: "make sure it indicates somewhere visually that that charging
// station is down due to a fault and cars are not routed to it. If it falls mid run,
// make sure OTTO-Q is aware of that and route cars away from that specific charger."
//
// The engine already books no faulted charger (otto-q-core 0612; run fd6ed035: 14
// faults, 0 bookings, cars or sessions on a faulted stall during its repair) and
// lists every Faulted charger in the snapshot's stalls_status. These cases hold the
// motion driver to the same rule, at first sight and mid-run, and check that it
// publishes WHY the stall is down for the plan, the 3D field and the chip.
// ============================================================================
import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { poseStore } from "./motion/poseStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";

type Row = TwinSnapshot["stalls_status"][number];
type Car = { id: string; state: string; stall_id?: string | null };

function snap(vehicles: Car[], stalls: Row[] = []): TwinSnapshot {
  return {
    run: { sim_run_id: "t", scenario: "t", status: "running", sim_clock: "2026-09-02T10:00:00+00:00", tick_count: 1, time_scale: 1, seed: 1 },
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v) => ({ av_id: v.id, make: "x", stall_id: null, soc: 50, platform: "waymo", ...v })),
    },
    stalls_status: stalls, energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

/** The live shape of a faulted charger's row (read from run fd6ed035's snapshot, 2026-10-07). */
const faulted = (id: string, extra: Partial<Row> = {}): Row => ({
  id, status: "faulted", vehicle_id: null, reserved_by: null, reserved_until: null, tethered: false,
  tether_until: null, tether_direction: null, tether_phase: null,
  charger_state: "Faulted", fault_code: "fault.communication_dropout", fault_until: "2026-09-02T11:07:00+00:00",
  ...extra,
});

const internals = () => twinMotionDriver as unknown as {
  twinStall: Map<string, string>;
  entries: Map<string, { tracker: unknown; reverse: unknown; playback: string; dwellStartMs: number | null }>;
};
const car = (id: string) => useVehicleStore.getState().vehicles.find((v) => v.id === id);
const stall = (id: string) => useDepotStore.getState().stalls.find((s) => s.id === id)!;
/** DCFC stalls in the order the driver offers them (north first). */
const dcfcPool = () => useDepotStore.getState().stalls.filter((s) => s.type === "dcfc")
  .sort((a, b) => a.position.y - b.position.y).map((s) => s.id);
const distTo = (id: string, sid: string) => {
  const p = poseStore.get(id)!;
  const s = stall(sid);
  return Math.hypot(p.x - s.position.x, p.y - s.position.y);
};

describe("TwinMotionDriver: a faulted charger is down and no car is routed to it", () => {
  let X: string; // the charger that faults: the FIRST one the driver would hand out
  let Y: string; // the next one
  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
    [X, Y] = dcfcPool();
    internals().twinStall.set("uuid-x", X);
    internals().twinStall.set("uuid-y", Y);
  });

  it("renders the faulted charger offline, publishes why, and assigns it to no car", () => {
    // ten cars for ten fast chargers, one of them faulted: nine get a charger, none gets X
    const cars = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, state: "charging_dcfc" }));
    twinMotionDriver.reconcile(snap(cars, [faulted("uuid-x")]));
    expect(stall(X).status).toBe("offline");
    expect(stall(X).down).toEqual({ kind: "fault", code: "fault.communication_dropout", until: "2026-09-02T11:07:00+00:00" });
    const held = cars.map((c) => car(c.id)?.assignedStall).filter(Boolean);
    expect(held).not.toContain(X);
    expect(held.filter((s) => s!.startsWith("DCFC-"))).toHaveLength(9);
    // a second poll changes nothing: the stall stays down and empty
    twinMotionDriver.reconcile(snap(cars, [faulted("uuid-x")]));
    expect(cars.map((c) => car(c.id)?.assignedStall)).not.toContain(X);
  });

  it("a Faulted charger on a stall that itself reads available is down too", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }], [faulted("uuid-x", { status: "available" })]));
    expect(stall(X).status).toBe("offline");
    expect(stall(X).down?.kind).toBe("fault");
    expect(car("v1")!.assignedStall).toBe(Y);
  });

  it("the twin's own 'offline' keeps its name: down, but not a fault", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }], [{ id: "uuid-x", status: "offline", vehicle_id: null }]));
    expect(stall(X).status).toBe("offline");
    expect(stall(X).down).toEqual({ kind: "offline", code: null, until: null });
    expect(car("v1")!.assignedStall).not.toBe(X);
  });

  it("an arrival whose hold is on a faulted charger is not drawn onto it", () => {
    twinMotionDriver.reconcile(snap([{ id: "v9", state: "arrived_at_gate" }], [faulted("uuid-x", { reserved_by: "v9" })]));
    expect(car("v9")!.assignedStall).toMatch(/^STAGE-/);
  });

  it("MID-RUN: a car driving to a charger that faults is routed to another one, and never reaches it", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    expect(car("v1")!.assignedStall).toBe(X); // on its way to X
    for (let i = 0; i < 60; i++) twinMotionDriver.tickMotion(0.05);
    expect(internals().entries.get("v1")!.tracker).not.toBeNull(); // still driving
    // X faults while v1 is on its way; the twin still says "charging", no stall named
    const down = snap([{ id: "v1", state: "charging_dcfc" }], [faulted("uuid-x")]);
    twinMotionDriver.reconcile(down);
    expect(car("v1")!.assignedStall).toBe(Y);
    let closest = Infinity;
    for (let round = 0; round < 30; round++) {
      for (let i = 0; i < 100; i++) {
        twinMotionDriver.tickMotion(0.05);
        closest = Math.min(closest, distTo("v1", X));
      }
      twinMotionDriver.reconcile(down);
    }
    expect(car("v1")!.assignedStall).toBe(Y);
    expect(distTo("v1", Y)).toBeLessThan(1); // docked at the other charger
    expect(closest).toBeGreaterThan(6); // and never pulled into X (DCFC rows are 14u apart)
    expect(stall(X).status).toBe("offline");
  });

  it("MID-RUN: a car still on the charger stays while the twin says it is there, and leaves when the twin moves it", () => {
    // first sight: v1 charging ON X (placed parked, as the twin says)
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc", stall_id: "uuid-x" }]));
    expect(car("v1")!.assignedStall).toBe(X);
    // X faults; the twin has not moved v1 yet: it stays (the renderer only draws)
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc", stall_id: "uuid-x" }], [faulted("uuid-x", { vehicle_id: "v1" })]));
    expect(car("v1")!.assignedStall).toBe(X);
    expect(stall(X).status).toBe("offline");
    // the twin moves v1 to Y: it goes, though X and Y are in the same lane
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc", stall_id: "uuid-y" }], [faulted("uuid-x")]));
    expect(car("v1")!.assignedStall).toBe(Y);
    const e = internals().entries.get("v1")!;
    expect(e.tracker !== null || e.reverse !== null).toBe(true); // leaving now, not later
  });

  it("MID-RUN: a car the twin sends to staging off a faulted charger leaves at once, not after the dwell floor", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc", stall_id: "uuid-x" }]));
    expect(internals().entries.get("v1")!.playback).toBe("docked"); // inside its 12 s visible-dwell floor
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "staged_awaiting_service" }], [faulted("uuid-x")]));
    expect(car("v1")!.assignedStall).toMatch(/^STAGE-/);
  });

  it("with no other charger free, a car whose charger faulted waits in staging, not on the charger", () => {
    // nine cars hold the other nine chargers
    const others = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, state: "charging_dcfc" }));
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc", stall_id: "uuid-x" }, ...others]));
    expect(car("v1")!.assignedStall).toBe(X);
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }, ...others], [faulted("uuid-x")]));
    expect(car("v1")!.assignedStall).toMatch(/^STAGE-/);
    expect(car("v1")!.status).toBe("staging"); // drawn as waiting, never as charging in a staging stall
  });

  it("clears the reading when the charger comes back, and on a scene clear", () => {
    twinMotionDriver.reconcile(snap([], [faulted("uuid-x")]));
    expect(stall(X).down?.kind).toBe("fault");
    twinMotionDriver.reconcile(snap([]));
    expect(stall(X).status).toBe("available");
    expect(stall(X).down ?? null).toBeNull();
    twinMotionDriver.reconcile(snap([], [faulted("uuid-x")]));
    twinMotionDriver.clear();
    expect(stall(X).down ?? null).toBeNull();
    expect(stall(X).status).toBe("available");
  });
});
