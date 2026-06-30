// ============================================================================
// TwinMotionDriver — Tier-A hyperreal motion off the LIVE backend twin.
//
// The twin (OTTO-Q) owns the DISCRETE truth: which vehicle is in which state /
// stall, and what's next. This driver owns only the SMOOTH MOTION between those
// states — it never invents world state. On every snapshot it:
//   1. holds a STABLE per-vehicle stall assignment (no re-shuffle jitter), and
//   2. when a vehicle's target changes (gate→charge→wash→stage→egress), routes
//      it along the real depot lanes (sitePlan.routeToStall / routeToEgress).
//
// Motion is driven by Yuka steering (FollowPath + Arrive + Separation): vehicles
// follow the lane path at speed, decelerate smoothly into the stall, and push
// apart so they never overlap/clump (e.g. at the gate). The renderer reads the
// resulting position; Vehicle3D faces the travel direction.
//
// Runs only in backend-twin mode (active sim_run + offline engine NOT running)
// so it never fights the offline-demo engine for the vehicle/depot stores.
// ============================================================================
import { EntityManager, Vehicle as YukaVehicle, Path, FollowPathBehavior, SeparationBehavior, Vector3 } from "yuka";
import { useDepotStore, type StallStatus } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import type { Vehicle, VehicleStatus } from "@/engine/types";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { routeToStall, routeToEgress, INGRESS, EGRESS } from "@/lib/sitePlan";

type Lane = "dcfc" | "l2" | "wash" | "service" | "staging";

// Base travel speed in logical units / sim-second (1 u ≈ 1.57 ft → ~13 u/s ≈
// 14 mph), scaled by the operator's sim speed. Yuka maxSpeed uses this.
const BASE_SPEED = 13;
// How close (logical units) before a vehicle is considered "arrived" at its
// final destination, and the gate fan / separation spacing.
const ARRIVE_EPS = 1.6;
const NEIGHBORHOOD = 9;

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

// destination = the last point a vehicle is currently headed for
function destOf(v: Vehicle): { x: number; y: number } {
  if (v.waypoints && v.waypoints.length) return v.waypoints[v.waypoints.length - 1];
  if (v.targetPosition) return v.targetPosition;
  return v.position;
}

interface YukaEntry {
  yv: YukaVehicle;
  follow: FollowPathBehavior | null;
  pathRef: unknown;            // identity of the waypoint set the current path was built from
  final: { x: number; y: number } | null;
}

class TwinMotionDriver {
  private rafId: number | null = null;
  private last: number | null = null;
  private vehicles = new Map<string, Vehicle>();
  private assign = new Map<string, { lane: Lane; stallId: string }>(); // vehicle → claimed stall
  private em = new EntityManager();
  private yuka = new Map<string, YukaEntry>();

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
    this.yuka.clear();
    this.em = new EntityManager();
  }

  /** Reconcile render state against a fresh backend snapshot (sets routes). */
  reconcile(snap: TwinSnapshot) {
    const depot = useDepotStore.getState();
    const stalls = depot.stalls;
    const byLane: Record<string, typeof stalls> = { dcfc: [], l2: [], wash: [], service: [], staging: [] };
    for (const s of stalls) (byLane[s.type] ??= []).push(s);

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

  /** Get-or-create the Yuka entity backing a render vehicle. */
  private yukaFor(v: Vehicle): YukaEntry {
    let e = this.yuka.get(v.id);
    if (!e) {
      const yv = new YukaVehicle();
      yv.position.set(v.position.x, v.position.y, 0);
      yv.maxSpeed = BASE_SPEED;
      yv.updateNeighborhood = true;
      yv.neighborhoodRadius = NEIGHBORHOOD;
      const sep = new SeparationBehavior();
      // Gentle anti-overlap ONLY — must stay well below the FollowPath weight (1)
      // so cars hold their lane polyline instead of being shoved sideways off the
      // lanes and over structures. (Sparse start = little clustering to resolve.)
      sep.weight = 0.35;
      yv.steering.add(sep);
      this.em.add(yv);
      e = { yv, follow: null, pathRef: null, final: null };
      this.yuka.set(v.id, e);
    }
    return e;
  }

  private loop = (ts: number) => {
    if (this.last === null) {
      this.last = ts;
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }
    const dt = Math.min(ts - this.last, 100) / 1000;
    this.last = ts;
    this.tickMotion(dt);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** One motion step of `dt` seconds. Public so the Yuka motion can be
   *  unit-tested directly (the rAF loop just calls this each frame). */
  tickMotion(dt: number) {
    // Cars ALWAYS drive at a believable depot taxi speed (~14 mph), DECOUPLED
    // from the simulation clock. The twin runs at 60x for the energy/throughput
    // math (correct, untouched) — but a car animated at 60x looks like a
    // teleporting slide/swarm. At BASE_SPEED a full route takes a realistic
    // ~15-20s of real time and the car then SITS PARKED until its next backend
    // state change — which reads as real pacing, not teleport. Cars still reach
    // their stall well within one ~30s twin tick, so they don't fall behind.
    const speed = BASE_SPEED;

    // Sync Yuka entities to the render vehicles' current routes.
    for (const v of this.vehicles.values()) {
      const e = this.yukaFor(v);
      e.yv.maxSpeed = speed;
      if (v.targetPosition) {
        const full = [v.targetPosition, ...(v.waypoints ?? [])];
        // (re)build the path only when the route actually changed
        if (e.pathRef !== v.waypoints || !e.follow) {
          const path = new Path();
          for (const p of full) path.add(new Vector3(p.x, p.y, 0));
          if (e.follow) e.yv.steering.remove(e.follow);
          e.follow = new FollowPathBehavior(path, 3);
          e.follow.weight = 1;
          e.yv.steering.add(e.follow);
          e.pathRef = v.waypoints;
          e.final = full[full.length - 1];
        }
        // Pull-in: ease the speed down over the last ~16 units so the car
        // decelerates smoothly into its stall (a real parking maneuver) instead
        // of driving full-speed then snapping to a dead stop.
        if (e.final) {
          const dist = Math.hypot(v.position.x - e.final.x, v.position.y - e.final.y);
          e.yv.maxSpeed = speed * Math.max(0.22, Math.min(1, dist / 16));
        }
      }
    }

    // Advance all steering.
    this.em.update(dt);

    // Read positions back; handle arrivals + departures.
    let moved = false;
    const remove: string[] = [];
    for (const v of this.vehicles.values()) {
      const e = this.yuka.get(v.id);
      if (!e) continue;
      if (v.targetPosition && e.final) {
        const nx = e.yv.position.x, ny = e.yv.position.y;
        if (nx !== v.position.x || ny !== v.position.y) { v.position = { x: nx, y: ny }; moved = true; }
        if (Math.abs(nx - e.final.x) < ARRIVE_EPS && Math.abs(ny - e.final.y) < ARRIVE_EPS) {
          // arrived at the final destination
          v.position = { ...e.final };
          e.yv.velocity.set(0, 0, 0);
          if (e.follow) { e.yv.steering.remove(e.follow); e.follow = null; }
          e.pathRef = null; e.final = null;
          if (v.status === "departing") remove.push(v.id);
          else { v.targetPosition = null; v.waypoints = []; }
          moved = true;
        }
      } else {
        // parked: keep the Yuka entity pinned to the render position
        e.yv.position.set(v.position.x, v.position.y, 0);
        e.yv.velocity.set(0, 0, 0);
      }
    }
    for (const id of remove) {
      const e = this.yuka.get(id);
      if (e) { this.em.remove(e.yv); this.yuka.delete(id); }
      this.vehicles.delete(id);
    }
    if (moved || remove.length) this.flush();
  }

  private flush() {
    const arr = Array.from(this.vehicles.values()).map((v) => ({ ...v, position: { ...v.position } }));
    const store = useVehicleStore.getState();
    store.setVehicles(arr);
    store.setQueueDepth(arr.filter((v) => v.status === "queued").length);
  }
}

export const twinMotionDriver = new TwinMotionDriver();
