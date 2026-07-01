import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { poseStore } from "./motion/poseStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";

// Minimal snapshot carrying only what the driver reads (fleet.vehicles).
function snap(vehicles: { id: string; state: string; soc?: number; platform?: string }[]): TwinSnapshot {
  return {
    run: { sim_run_id: "t", scenario: "t", status: "running", sim_clock: "", tick_count: 1, time_scale: 1, seed: 1 },
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
