// ============================================================================
// TwinMotionDriver — Tier-A hyperreal motion off the LIVE backend twin.
//
// The twin (OTTO-Q) owns the DISCRETE truth: which vehicle is in which state /
// stall, and what's next. This driver owns only the SMOOTH MOTION between those
// states — it never invents world state. On every snapshot it:
//   1. holds a STABLE per-vehicle stall assignment (no re-shuffle jitter), and
//   2. when a vehicle's target changes (gate→charge→wash→stage→egress), routes
//      it along the real depot lanes (sitePlan.routeToStall / routeToEgress).
// A rAF loop then interpolates each vehicle's position along its waypoints at a
// realistic depot crawl, and Vehicle3D/VehicleDot render the result. This is the
// same motion model as the offline SimulationEngine, but every state TRANSITION
// is sourced from the backend instead of a local arrival generator.
//
// Runs only in backend-twin mode (active sim_run + offline engine NOT running)
// so it never fights the offline-demo engine for the vehicle/depot stores.
// ============================================================================
import { useDepotStore, type StallStatus } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { useSimulationStore } from "@/store/simulationStore";
import type { Vehicle, VehicleStatus } from "@/engine/types";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { routeToStall, routeToEgress, INGRESS, EGRESS } from "@/lib/sitePlan";

type Lane = "dcfc" | "l2" | "wash" | "service" | "staging";

// Base travel speed in logical units / sim-second (1 u ≈ 1.57 ft → ~13 u/s ≈
// 14 mph), scaled by the operator's sim speed. Mirrors SimulationEngine.
const LERP_SPEED = 13;

// Gate holding apron just inside the ingress gate — fresh arrivals wait here
// (fanned out) until OTTO-Q assigns them a stall, then they drive across.
function gatePos(id: string): { x: number; y: number } {
  const n = hash(id) % 24;
  return { x: INGRESS.x - 30 + (n % 8) * 8, y: INGRESS.y - 16 - Math.floor(n / 8) * 7 };
}
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// backend vehicle_state → { lane, render status, stall status }
function mapState(
  state: string,
): { lane: Lane | "gate" | null; vstatus: VehicleStatus; sstatus: StallStatus } | null {
  switch (state) {
    case "charging_dcfc":            return { lane: "dcfc",    vstatus: "charging",    sstatus: "charging" };
    case "charging_l2":              return { lane: "l2",      vstatus: "charging",    sstatus: "charging" };
    case "in_wash_bay":              return { lane: "wash",    vstatus: "washing",     sstatus: "servicing" };
    case "in_detail_bay":            return { lane: "wash",    vstatus: "detailing",   sstatus: "servicing" };
    case "in_service_bay":           return { lane: "service", vstatus: "maintenance", sstatus: "servicing" };
    case "charge_complete_holding":
    case "service_complete_holding":
    case "staged_awaiting_service":
    case "staged_for_departure":     return { lane: "staging", vstatus: "staging",     sstatus: "occupied" };
    case "arrived_at_gate":          return { lane: "gate",    vstatus: "queued",      sstatus: "available" };
    // deployed / en_route_* / offline / tow → off-map (handled as departures)
    default: return null;
  }
}

function lerp(cur: number, target: number, maxStep: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

// destination = the last point a vehicle is currently headed for
function destOf(v: Vehicle): { x: number; y: number } {
  if (v.waypoints && v.waypoints.length) return v.waypoints[v.waypoints.length - 1];
  if (v.targetPosition) return v.targetPosition;
  return v.position;
}

class TwinMotionDriver {
  private rafId: number | null = null;
  private last: number | null = null;
  private vehicles = new Map<string, Vehicle>();
  private assign = new Map<string, { lane: Lane; stallId: string }>(); // vehicle → claimed stall

  start() {
    if (this.rafId !== null) return;
    this.last = null;
    this.rafId = requestAnimationFrame(this.loop);
  }
  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
  clear() {
    this.stop();
    this.vehicles.clear();
    this.assign.clear();
  }

  /** Reconcile render state against a fresh backend snapshot (sets routes). */
  reconcile(snap: TwinSnapshot) {
    const depot = useDepotStore.getState();
    const stalls = depot.stalls;
    const byLane: Record<string, typeof stalls> = { dcfc: [], l2: [], wash: [], service: [], staging: [] };
    for (const s of stalls) (byLane[s.type] ??= []).push(s);

    // stalls currently claimed by a still-assigned vehicle
    const claimed = new Set<string>();
    for (const a of this.assign.values()) claimed.add(a.stallId);

    const present = new Set<string>();
    const desiredStatus = new Map<string, StallStatus>();

    for (const bv of snap.fleet?.vehicles ?? []) {
      const m = mapState(bv.state);
      if (!m) continue; // off-map → departure pass below
      present.add(bv.id);

      // ---- resolve this vehicle's target render position ----
      let target: { x: number; y: number };
      let assignedStall: string | null = null;

      if (m.lane === "gate") {
        const prev = this.assign.get(bv.id);
        if (prev) { claimed.delete(prev.stallId); this.assign.delete(bv.id); }
        target = gatePos(bv.id);
      } else {
        const lane = m.lane;
        let a = this.assign.get(bv.id);
        if (!a || a.lane !== lane) {
          if (a) claimed.delete(a.stallId);
          const slot = (byLane[lane] ?? []).find((s) => !claimed.has(s.id));
          if (!slot) { this.assign.delete(bv.id); continue; } // lane full → overflow off-map
          claimed.add(slot.id);
          a = { lane, stallId: slot.id };
          this.assign.set(bv.id, a);
        }
        const slot = stalls.find((s) => s.id === a.stallId)!;
        assignedStall = a.stallId;
        target = { x: slot.position.x, y: slot.position.y };
        desiredStatus.set(a.stallId, m.sstatus);
      }

      // ---- create or update the render vehicle ----
      let v = this.vehicles.get(bv.id);
      if (!v) {
        // appear in place (no stampede on first paint); motion happens on the
        // NEXT state change the backend reports.
        v = {
          id: bv.id, type: "fleet", oem: bv.platform, priority: 5,
          batteryCapacity: 100, currentSoC: bv.soc ?? 0, targetSoC: 90,
          status: m.vstatus, assignedStall, serviceQueue: [], currentServiceIndex: 0,
          serviceStartTime: null, serviceDuration: null, arrivalTime: 0,
          position: { ...target }, targetPosition: null,
        };
        this.vehicles.set(bv.id, v);
      } else {
        v.currentSoC = bv.soc ?? v.currentSoC;
        v.oem = bv.platform ?? v.oem;
        v.status = m.vstatus;
        v.assignedStall = assignedStall;
        const d = destOf(v);
        if (Math.abs(d.x - target.x) > 1.5 || Math.abs(d.y - target.y) > 1.5) {
          // target moved → route along the real lanes
          v.waypoints = m.lane === "gate" ? [target] : routeToStall(v.position, target);
          v.targetPosition = v.waypoints.shift() ?? { ...target };
        }
      }
    }

    // ---- departures: vehicles we render but the backend no longer holds ----
    for (const [id, v] of this.vehicles) {
      if (present.has(id)) continue;
      const a = this.assign.get(id);
      if (a) { claimed.delete(a.stallId); this.assign.delete(id); }
      if (v.status !== "departing") {
        v.status = "departing";
        v.assignedStall = null;
        v.waypoints = routeToEgress(v.position);
        v.targetPosition = v.waypoints.shift() ?? { ...EGRESS };
      }
    }

    // ---- apply stall statuses (reserved/charging/servicing vs available) ----
    for (const s of stalls) {
      const want = desiredStatus.get(s.id) ?? "available";
      if (s.status !== want) depot.setStallStatus(s.id, want);
    }

    this.flush();
  }

  private loop = (ts: number) => {
    if (this.last === null) {
      this.last = ts;
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }
    const dt = Math.min(ts - this.last, 100) / 1000;
    this.last = ts;
    const simSpeed = Math.max(useSimulationStore.getState().simSpeed ?? 1, 1);
    const step = LERP_SPEED * dt * Math.min(simSpeed, 8);

    let moved = false;
    const remove: string[] = [];
    for (const v of this.vehicles.values()) {
      if (!v.targetPosition) continue;
      const nx = lerp(v.position.x, v.targetPosition.x, step);
      const ny = lerp(v.position.y, v.targetPosition.y, step);
      if (nx !== v.position.x || ny !== v.position.y) { v.position = { x: nx, y: ny }; moved = true; }
      if (Math.abs(nx - v.targetPosition.x) < 0.6 && Math.abs(ny - v.targetPosition.y) < 0.6) {
        v.position = { ...v.targetPosition };
        if (v.waypoints && v.waypoints.length) v.targetPosition = v.waypoints.shift()!;
        else { v.targetPosition = null; if (v.status === "departing") remove.push(v.id); }
        moved = true;
      }
    }
    for (const id of remove) this.vehicles.delete(id);
    if (moved || remove.length) this.flush();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private flush() {
    const arr = Array.from(this.vehicles.values()).map((v) => ({ ...v, position: { ...v.position } }));
    const store = useVehicleStore.getState();
    store.setVehicles(arr);
    store.setQueueDepth(arr.filter((v) => v.status === "queued").length);
  }
}

export const twinMotionDriver = new TwinMotionDriver();
