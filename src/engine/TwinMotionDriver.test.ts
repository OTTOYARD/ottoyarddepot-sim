import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
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

describe("TwinMotionDriver — twin-driven lane motion", () => {
  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 115, 2);
  });

  it("a fresh arrival appears at the gate, NOT teleported to a stall", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    const v = find("v1");
    expect(v).toBeTruthy();
    expect(v!.status).toBe("queued");
    expect(v!.targetPosition).toBeNull();         // no route yet — waits at the gate
    expect(v!.position.y).toBeGreaterThan(150);    // ingress apron (south)
  });

  it("on a state change it ROUTES along the lanes (multi-leg path), not a teleport", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "arrived_at_gate" }]));
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const v = find("v1")!;
    expect(v.status).toBe("charging");
    expect(v.assignedStall).toMatch(/^DCFC-/);
    expect(v.targetPosition).not.toBeNull();
    expect(v.waypoints?.length ?? 0).toBeGreaterThanOrEqual(2);   // a real path, not one hop
    const stall = useDepotStore.getState().stalls.find((s) => s.id === v.assignedStall)!;
    const last = v.waypoints![v.waypoints!.length - 1];
    expect(Math.abs(last.x - stall.position.x)).toBeLessThan(1);  // path ends AT the stall
    expect(Math.abs(last.y - stall.position.y)).toBeLessThan(1);
    expect(stall.status).toBe("charging");                        // stall reserved
  });

  it("keeps a STABLE stall assignment across repeated snapshots (no jitter)", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const first = find("v1")!.assignedStall;
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    expect(find("v1")!.assignedStall).toBe(first);
  });

  it("re-routes to a new lane when the backend moves the vehicle (charge → wash)", () => {
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "charging_dcfc" }]));
    const dcfc = find("v1")!.assignedStall!;
    twinMotionDriver.reconcile(snap([{ id: "v1", state: "in_wash_bay" }]));
    const v = find("v1")!;
    expect(v.status).toBe("washing");
    expect(v.assignedStall).toMatch(/^WASH-/);
    expect(v.assignedStall).not.toBe(dcfc);
    expect(v.waypoints?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(useDepotStore.getState().stalls.find((s) => s.id === dcfc)!.status).toBe("available"); // old stall freed
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
    const v = find("v1");
    expect(v!.status).toBe("departing");
    expect(v!.targetPosition).not.toBeNull();
  });
});
