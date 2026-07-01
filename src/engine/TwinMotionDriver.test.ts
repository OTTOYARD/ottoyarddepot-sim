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

  it("a fresh arrival appears at the gate, NOT teleported to a stall", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    const v = find("v1")!;
    expect(v.status).toBe("queued");
    expect(v.assignedStall ?? null).toBeNull();
    expect(v.position.y).toBeGreaterThan(150); // south ingress apron
    expect(typeof v.heading).toBe("number");   // has a real body heading
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

  it("arrivals queue single-file at the gate and NEVER overlap/stack", () => {
    twinMotionDriver.reconcile(snap([
      { id: "a", state: "arrived_at_gate" }, { id: "b", state: "arrived_at_gate" },
      { id: "c", state: "arrived_at_gate" }, { id: "d", state: "arrived_at_gate" },
      { id: "e", state: "arrived_at_gate" },
    ]));
    for (let i = 0; i < 240; i++) twinMotionDriver.tickMotion(0.05); // let the queue settle
    const ids = ["a", "b", "c", "d", "e"];
    const ps = ids.map((id) => poseStore.get(id)!);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const gap = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
        expect(gap).toBeGreaterThan(6); // no two cars occupy the same spot
      }
    }
  });
});
