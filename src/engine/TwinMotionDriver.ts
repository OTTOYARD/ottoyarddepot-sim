// ============================================================================
// TwinMotionDriver — Tier-A hyperreal motion off the LIVE backend twin.
//
// The twin (OTTO-Q) owns the DISCRETE truth: which vehicle is in which state /
// stall. This driver owns the PHYSICAL MOTION between those states, using the
// real car-driving stack in src/engine/motion:
//   • KinematicCar  — rear-axle bicycle model (no lateral slide, real arc-turns)
//   • PathTracker   — pure-pursuit steering along the one-way LaneGraph routes
//   • idm           — Intelligent Driver Model: keeps gaps, queues, never stacks
//   • traffic       — leader-finding + a StallLedger (one car per stall)
//
// On each snapshot it holds a stable per-vehicle stall assignment and, on a
// state change, routes the car along the real one-way lanes to its new stall;
// the rAF loop then DRIVES it there with the kinematic + IDM stack. Vehicles
// arrive at the gate, taxi in, queue behind each other, and park facing the
// right way — they never teleport, slide, or overlap.
//
// Runs only in backend-twin mode (active sim_run + offline engine NOT running).
// ============================================================================
import { KinematicCar, DEFAULT_CAR_PARAMS } from "./motion/KinematicCar";
import { PathTracker, type Pt } from "./motion/PathTracker";
import { idmAccel } from "./motion/idm";
import { findLeader, StallLedger, type MovingCar } from "./motion/traffic";
import { buildDepotLanes } from "./motion/LaneGraph";
import { useDepotStore, type StallStatus } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import type { Vehicle, VehicleStatus } from "@/engine/types";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { INGRESS, EGRESS, gapLaneX, SOUTH_LANE_Y } from "@/lib/sitePlan";

type Lane = "dcfc" | "l2" | "wash" | "service" | "staging";

const LOOKAHEAD_MIN = 5;
const LOOKAHEAD_K = 0.45;
const ARRIVE_EPS = 1.8;
const NORTH = -Math.PI / 2; // facing north (−y) in the y-down logical frame

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
/** A spread-out holding spot on the south ingress apron for an arriving car. */
function gatePos(id: string): Pt {
  const n = hash(id) % 24;
  return { x: INGRESS.x - 30 + (n % 8) * 8, y: INGRESS.y - 16 - Math.floor(n / 8) * 7 };
}

// backend vehicle_state → { lane, render status, stall status }
function mapState(state: string): { lane: Lane | "gate" | null; vstatus: VehicleStatus; sstatus: StallStatus } | null {
  switch (state) {
    case "charging_dcfc": return { lane: "dcfc", vstatus: "charging", sstatus: "charging" };
    case "charging_l2": return { lane: "l2", vstatus: "charging", sstatus: "charging" };
    case "in_wash_bay": return { lane: "wash", vstatus: "washing", sstatus: "servicing" };
    case "in_detail_bay": return { lane: "wash", vstatus: "detailing", sstatus: "servicing" };
    case "in_service_bay": return { lane: "service", vstatus: "maintenance", sstatus: "servicing" };
    case "charge_complete_holding":
    case "service_complete_holding":
    case "staged_awaiting_service":
    case "staged_for_departure": return { lane: "staging", vstatus: "staging", sstatus: "occupied" };
    case "arrived_at_gate": return { lane: "gate", vstatus: "queued", sstatus: "available" };
    default: return null; // deployed / en_route / offline / tow → off-map (departure)
  }
}

/** Parked heading for a stall: chargers face NORTH (toward the bays); others use
 *  the sitePlan stall angle (0=N,90=E,180=S,270=W → heading = (deg−90)°). */
function parkedHeading(lane: Lane, angleDeg: number): number {
  if (lane === "dcfc" || lane === "l2" || lane === "wash" || lane === "service") return NORTH;
  return ((angleDeg - 90) * Math.PI) / 180;
}

interface Entry {
  car: KinematicCar;
  tracker: PathTracker | null; // null = parked
  lane: Lane | "gate" | null;
  stallId: string | null;
  stallHeading: number;
  vstatus: VehicleStatus;
  oem: string;
  soc: number;
}

class TwinMotionDriver {
  private rafId: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private last: number | null = null;
  private graph = buildDepotLanes();
  private ledger = new StallLedger();
  private entries = new Map<string, Entry>();

  start() {
    if (this.rafId !== null || this.intervalId !== null) return;
    this.last = null;
    this.rafId = requestAnimationFrame(this.loop);
    // Fallback driver: browsers PAUSE requestAnimationFrame for hidden/background
    // tabs, which would freeze the depot. A setInterval keeps motion advancing
    // regardless; dt comes from real timestamps so both paths agree and a depot
    // in a background tab (or a headless preview) still moves.
    this.intervalId = setInterval(() => this.step(performance.now()), 33);
  }
  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.rafId = null;
    this.intervalId = null;
  }
  clear() {
    this.stop();
    this.entries.clear();
    this.ledger.clear();
  }

  private createEntry(pose: { x: number; y: number; heading: number }, lane: Lane | "gate", vstatus: VehicleStatus, oem: string, soc: number): Entry {
    return {
      car: new KinematicCar(pose, DEFAULT_CAR_PARAMS),
      tracker: null, lane, stallId: null, stallHeading: pose.heading, vstatus, oem, soc,
    };
  }

  /** Route a drivable path from `pose` to a stall along the one-way lanes. Charging
   *  stalls are reached via their northbound gap lane (car ends facing north). */
  private routeToStall(pose: { x: number; y: number }, lane: Lane, stall: { x: number; y: number }): Pt[] {
    if (lane === "dcfc" || lane === "l2") {
      const gx = gapLaneX(stall.x);
      const toGap = this.graph.route(pose, { x: gx, y: SOUTH_LANE_Y - 2 });
      return [...toGap, { x: gx, y: stall.y }, { x: stall.x, y: stall.y }];
    }
    return this.graph.route(pose, { x: stall.x, y: stall.y });
  }

  /** Reconcile render state + routes against a fresh backend snapshot. */
  reconcile(snap: TwinSnapshot) {
    const depot = useDepotStore.getState();
    const stalls = depot.stalls;
    const byLane: Record<string, typeof stalls> = { dcfc: [], l2: [], wash: [], service: [], staging: [] };
    for (const s of stalls) (byLane[s.type] ??= []).push(s);

    const present = new Set<string>();
    const desiredStatus = new Map<string, StallStatus>();

    for (const bv of snap.fleet?.vehicles ?? []) {
      const m = mapState(bv.state);
      if (!m) continue;
      present.add(bv.id);
      let e = this.entries.get(bv.id);
      const oem = bv.platform ?? e?.oem ?? "waymo";
      const soc = bv.soc ?? e?.soc ?? 0;

      if (m.lane === "gate") {
        this.ledger.release(bv.id);
        const gp = gatePos(bv.id);
        if (!e) e = this.createEntry({ ...gp, heading: NORTH }, "gate", m.vstatus, oem, soc);
        e.lane = "gate"; e.stallId = null; e.tracker = null; e.vstatus = m.vstatus;
      } else {
        const cands = (byLane[m.lane] ?? []).map((s) => s.id);
        const stallId = this.ledger.claimFirstFree(bv.id, cands);
        if (!stallId) continue; // lane full → overflow off-map this tick
        const stall = stalls.find((s) => s.id === stallId)!;
        const sp = { x: stall.position.x, y: stall.position.y };
        const sh = parkedHeading(m.lane, stall.position.angle);
        if (!e) {
          // first seen already in-state → place parked AT the stall
          e = this.createEntry({ ...sp, heading: sh }, m.lane, m.vstatus, oem, soc);
          e.stallId = stallId; e.stallHeading = sh;
        } else if (e.stallId !== stallId || e.lane === "gate") {
          // newly assigned (or leaving the gate) → ROUTE there and drive
          e.tracker = new PathTracker(this.routeToStall(e.car.pose, m.lane, sp));
          e.stallId = stallId; e.stallHeading = sh;
        }
        e.lane = m.lane;
        e.vstatus = m.vstatus;
        desiredStatus.set(stallId, m.sstatus);
      }
      e.oem = oem;
      e.soc = soc;
      this.entries.set(bv.id, e);
    }

    // departures: rendered but no longer held by the backend → drive to egress
    for (const [id, e] of this.entries) {
      if (present.has(id)) continue;
      this.ledger.release(id);
      if (e.vstatus !== "departing") {
        e.vstatus = "departing";
        e.stallId = null;
        e.tracker = new PathTracker(this.graph.route(e.car.pose, { x: EGRESS.x, y: EGRESS.y }));
      }
    }

    // stall statuses
    for (const s of stalls) {
      const want = desiredStatus.get(s.id) ?? "available";
      if (s.status !== want) depot.setStallStatus(s.id, want);
    }

    this.flush();
  }

  private loop = (ts: number) => {
    this.step(ts);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Advance motion by the real elapsed time since the last step. Driven by both
   *  the rAF loop (smooth 60fps when visible) and the setInterval fallback (when
   *  hidden). dt-from-timestamp + the <=0 guard make overlapping fires harmless. */
  private step(ts: number) {
    if (this.last === null) {
      this.last = ts;
      return;
    }
    const dt = Math.min(ts - this.last, 100) / 1000;
    if (dt <= 0) return;
    this.last = ts;
    this.tickMotion(dt);
  }

  /** One physical motion step of `dt` seconds. Public for unit testing. */
  tickMotion(dt: number) {
    // snapshot all car poses for leader-finding
    const moving: MovingCar[] = [];
    for (const [id, e] of this.entries) moving.push({ id, pose: e.car.pose, speed: e.car.speed });

    let changed = false;
    const remove: string[] = [];
    for (const [id, e] of this.entries) {
      if (e.tracker) {
        // lateral: pure-pursuit steering along the lane route (advances the cursor)
        const look = LOOKAHEAD_MIN + LOOKAHEAD_K * e.car.speed;
        const { steer, remaining } = e.tracker.steer(e.car.pose, look, e.car.params.wheelbase);
        // longitudinal: follow the leader (IDM) ...
        const lead = findLeader({ id, pose: e.car.pose, speed: e.car.speed }, moving);
        const accel = idmAccel(e.car.speed, lead.gap, lead.leaderSpeed);
        let desiredSpeed = Math.max(0, e.car.speed + accel * dt);
        // ... AND ease to a precise stop exactly at the path end (the stall):
        // v = sqrt(2·b·remaining) decelerates to 0 right at remaining = 0.
        desiredSpeed = Math.min(desiredSpeed, Math.sqrt(2 * 7 * Math.max(0, remaining)));
        e.car.step(dt, desiredSpeed, steer);
        changed = true;
        if (e.tracker.atEnd(ARRIVE_EPS) && e.car.speed < 0.5) {
          if (e.vstatus === "departing") {
            remove.push(id);
          } else {
            if (e.stallId) {
              const st = useDepotStore.getState().stalls.find((s) => s.id === e.stallId);
              if (st) { e.car.x = st.position.x; e.car.y = st.position.y; }
            }
            e.car.heading = e.stallHeading;
            e.car.speed = 0;
            e.car.steer = 0;
            e.tracker = null;
          }
        }
      } else if (e.car.speed !== 0) {
        e.car.speed = 0; // parked: hold still
        changed = true;
      }
    }
    for (const id of remove) {
      this.ledger.release(id);
      this.entries.delete(id);
      changed = true;
    }
    if (changed) this.flush();
  }

  private flush() {
    const arr: Vehicle[] = [];
    for (const [id, e] of this.entries) {
      arr.push({
        id, type: "fleet", oem: e.oem, priority: 5,
        batteryCapacity: 100, currentSoC: e.soc, targetSoC: 90,
        status: e.vstatus, assignedStall: e.stallId, serviceQueue: [], currentServiceIndex: 0,
        serviceStartTime: null, serviceDuration: null, arrivalTime: 0,
        position: { x: e.car.x, y: e.car.y }, heading: e.car.heading,
        targetPosition: null, waypoints: [],
      });
    }
    const store = useVehicleStore.getState();
    store.setVehicles(arr);
    store.setQueueDepth(arr.filter((v) => v.status === "queued").length);
  }
}

export const twinMotionDriver = new TwinMotionDriver();
