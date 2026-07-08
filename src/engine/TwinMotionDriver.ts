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
import { findLeader, separationSteer, StallLedger, type MovingCar } from "./motion/traffic";
import { buildDepotLanes } from "./motion/LaneGraph";
import { poseStore } from "./motion/poseStore";
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
    // incident triage: a retrieved (towed-in) vehicle docks in its reserved staging stall
    case "emergency_staged": return { lane: "staging", vstatus: "maintenance", sstatus: "occupied" };
    case "arrived_at_gate": return { lane: "gate", vstatus: "staging", sstatus: "occupied" };
    default: return null; // deployed / en_route / offline → off-map (departure)
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
  /** twin stall uuid → renderer stall id (from the depot layout) — lets the
   *  renderer park each car in the twin's EXACT assigned stall, so OTTO-Q's
   *  spatial decisions (nearest-wash, cuOpt picks) are literally what you see. */
  private twinStall = new Map<string, string>();
  /** roster fingerprint (ids+status+stall+soc) — setVehicles only fires when it changes */
  private lastRosterKey = "";
  /** false until the first reconcile after clear(): the initial snapshot places the
   *  existing fleet parked in-place; after that, ANY newly-seen vehicle drives in
   *  from the ingress (kills the mid-run teleport-spawn when a state hop lands
   *  between two polls, e.g. deployed → charging). */
  private primed = false;

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
    poseStore.clear();
    this.lastRosterKey = "";
    this.primed = false;
    // push an empty roster so no ghost fleet lingers after leaving twin mode
    useVehicleStore.getState().setVehicles([]);
  }

  /** Ingest the twin depot layout: map each twin stall uuid to the renderer's
   *  stall id by TYPE + the code's trailing number (e.g. twin 'NASH-L2-STALL-26'
   *  type 'l2' → renderer 'L2-26'). Unmappable stalls (e.g. twin L2-31..35 when
   *  the scene draws 30) simply fall back to zone-based assignment. */
  setTwinStallMap(stalls: { id: string; code: string; type: string }[]) {
    const prefix: Record<string, string> = {
      dcfc: "DCFC", l2: "L2", wash_bay: "WASH", service_bay: "SVC", staging: "STAGE",
    };
    this.twinStall.clear();
    for (const s of stalls) {
      const p = prefix[s.type];
      const m = /(\d+)\s*$/.exec(s.code ?? "");
      if (!p || !m) continue;
      this.twinStall.set(s.id, `${p}-${String(parseInt(m[1], 10)).padStart(2, "0")}`);
    }
  }

  private createEntry(pose: { x: number; y: number; heading: number }, lane: Lane | "gate", vstatus: VehicleStatus, oem: string, soc: number): Entry {
    return {
      car: new KinematicCar(pose, DEFAULT_CAR_PARAMS),
      tracker: null, lane, stallId: null, stallHeading: pose.heading, vstatus, oem, soc,
    };
  }

  /** Route a drivable path from `pose` to a stall along the one-way lanes. Charging
   *  stalls are reached via their northbound gap lane (car ends facing north). */
  private routeToStall(pose: { x: number; y: number }, lane: Lane, stall: { x: number; y: number }, facing: number): Pt[] {
    if (lane === "dcfc" || lane === "l2") {
      const gx = gapLaneX(stall.x);
      const toGap = this.graph.route(pose, { x: gx, y: SOUTH_LANE_Y - 2 });
      return [...toGap, { x: gx, y: stall.y }, { x: stall.x, y: stall.y }];
    }
    // parking / bays: approach a point one car-length BEHIND the parked heading,
    // then pull straight in — each car fans to its own stall and noses in facing
    // `facing`, instead of trailing others into a shared approach spot.
    const ax = stall.x - Math.cos(facing) * 9;
    const ay = stall.y - Math.sin(facing) * 9;
    return [...this.graph.route(pose, { x: ax, y: ay }), { x: stall.x, y: stall.y }];
  }

  /** Reconcile render state + routes against a fresh backend snapshot. */
  reconcile(snap: TwinSnapshot) {
    const depot = useDepotStore.getState();
    const stalls = depot.stalls;
    const byLane: Record<string, typeof stalls> = { dcfc: [], l2: [], wash: [], service: [], staging: [] };
    for (const s of stalls) (byLane[s.type] ??= []).push(s);
    // OTTO-Q spatial policy: charging fills NORTH-first (nearest the wash/service
    // bays), so cars pool toward the top and only spill south as it fills.
    byLane.dcfc?.sort((a, b) => a.position.y - b.position.y);
    byLane.l2?.sort((a, b) => a.position.y - b.position.y);
    // Staging fills nearest the INGRESS first, so an arriving car parks close to
    // the entrance (short taxi, fans across the south rows) instead of trekking to
    // a far corner and bunching in a shared approach.
    const dIn = (s: (typeof stalls)[number]) => Math.hypot(s.position.x - INGRESS.x, s.position.y - INGRESS.y);
    byLane.staging?.sort((a, b) => dIn(a) - dIn(b));

    const present = new Set<string>();
    const desiredStatus = new Map<string, StallStatus>();

    for (const bv of snap.fleet?.vehicles ?? []) {
      // Incident: a tow-requested vehicle CANNOT drive. If it's on-map, freeze it
      // exactly where it is (keeping its stall claim) until the twin retrieves it
      // (emergency_staged) or removes it; if it was never rendered (road incident
      // while deployed), it stays off-map until retrieval.
      if (bv.state === "tow_requested") {
        const te = this.entries.get(bv.id);
        if (te) {
          present.add(bv.id);
          te.tracker = null;
          te.car.speed = 0;
          te.vstatus = "maintenance";
          if (te.stallId) desiredStatus.set(te.stallId, "offline");
          this.entries.set(bv.id, te);
        }
        continue;
      }
      const m = mapState(bv.state);
      if (!m) continue;
      present.add(bv.id);
      let e = this.entries.get(bv.id);
      const oem = bv.platform ?? e?.oem ?? "waymo";
      const soc = bv.soc ?? e?.soc ?? 0;

      // NO QUEUE LINES: a vehicle is ALWAYS in a stall (charging/wash/service/
      // staging) or TAXIING between them. An arriving car ("gate") drives in from
      // the ingress and PARKS in a free staging stall; OTTO-Q then taxis it to its
      // sequenced service stall. So "entering" simply targets a staging stall.
      const entering = m.lane === "gate";
      const lane: Lane = entering ? "staging" : (m.lane as Lane);
      const cands = (byLane[lane] ?? []).map((s) => s.id);
      // EXACT-STALL FIDELITY: if the twin named this vehicle's stall and it maps
      // to a renderer stall in the right zone, claim exactly that one — what you
      // see is literally OTTO-Q's assignment. Zone-based pick is the fallback
      // (unmapped stall, renderer/twin drift, or stale local claim).
      let stallId: string | null = null;
      const exact = bv.stall_id ? this.twinStall.get(bv.stall_id) : undefined;
      if (exact && cands.includes(exact) && this.ledger.claim(bv.id, exact)) stallId = exact;
      if (!stallId) stallId = this.ledger.claimFirstFree(bv.id, cands);
      if (!stallId) {
        // overflow (no free stall in the target lane): hold on the public road
        // shoulder outside the gate, SPREAD by id so cars never stack on one
        // point — and keep the entry's fields fresh (status/soc/oem).
        if (!e) {
          let h = 0;
          for (let i = 0; i < bv.id.length; i++) h = (h * 31 + bv.id.charCodeAt(i)) >>> 0;
          e = this.createEntry({ x: INGRESS.x + ((h % 48) - 24), y: INGRESS.y + 3, heading: NORTH }, lane, m.vstatus, oem, soc);
        }
        e.vstatus = m.vstatus;
        e.oem = oem;
        e.soc = soc;
        this.entries.set(bv.id, e);
        continue;
      }
      const stall = stalls.find((s) => s.id === stallId)!;
      const sp = { x: stall.position.x, y: stall.position.y };
      const sh = parkedHeading(lane, stall.position.angle);
      if (!e) {
        // first seen: entering cars — and, once primed, ANY newly-appearing car
        // (state hop between polls) — start at the ingress and DRIVE to their
        // stall; only the initial snapshot places the fleet parked in-place.
        const driveIn = entering || this.primed;
        const start = driveIn ? { x: INGRESS.x, y: INGRESS.y - 4, heading: NORTH } : { x: sp.x, y: sp.y, heading: sh };
        e = this.createEntry(start, lane, m.vstatus, oem, soc);
        e.stallId = stallId;
        e.stallHeading = sh;
        if (driveIn) e.tracker = new PathTracker(this.routeToStall(start, lane, sp, sh));
      } else if (e.stallId !== stallId) {
        // re-assigned to a new stall → taxi there
        e.tracker = new PathTracker(this.routeToStall(e.car.pose, lane, sp, sh));
        e.stallId = stallId;
        e.stallHeading = sh;
      }
      e.lane = lane;
      e.vstatus = m.vstatus;
      desiredStatus.set(stallId, m.sstatus);
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

    this.primed = true; // initial placement done — newcomers drive in from here on
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
    // snapshot car poses for leader-finding — split MOVERS from PARKED so a docked
    // car just off the driving line (stall offset ≈2.4u) can never become a
    // permanent phantom leader that freezes passing traffic forever.
    const moving: MovingCar[] = [];
    const movers: MovingCar[] = [];
    const parked: MovingCar[] = [];
    for (const [id, e] of this.entries) {
      const mc = { id, pose: e.car.pose, speed: e.car.speed };
      moving.push(mc);
      (e.tracker ? movers : parked).push(mc);
    }

    let changed = false;
    const remove: string[] = [];
    for (const [id, e] of this.entries) {
      if (e.tracker) {
        // lateral: pure-pursuit steering along the lane route (advances the cursor)
        const look = LOOKAHEAD_MIN + LOOKAHEAD_K * e.car.speed;
        const { steer, remaining } = e.tracker.steer(e.car.pose, look, e.car.params.wheelbase);
        // local avoidance: a gentle steer away from any car within touching range
        const sep = separationSteer({ id, pose: e.car.pose, speed: e.car.speed }, moving);
        // longitudinal: follow the LANE leader (narrow cone over MOVERS), yield to
        // close cross-traffic (wider/shorter cone), and only brake for a PARKED
        // car when it genuinely blocks the lane (tighter 2.1u band < stall offset).
        // Most restrictive wins.
        const self = { id, pose: e.car.pose, speed: e.car.speed };
        const lead = findLeader(self, movers, 3.2, 34);
        const cross = findLeader(self, movers, 4.8, 12);
        const block = findLeader(self, parked, 2.1, 20);
        const gap = Math.min(lead.gap, cross.gap, block.gap);
        const leadSpeed = gap === block.gap ? 0 : gap === lead.gap ? lead.leaderSpeed : cross.leaderSpeed;
        const accel = idmAccel(e.car.speed, gap, leadSpeed);
        let desiredSpeed = Math.max(0, e.car.speed + accel * dt);
        // ... AND ease to a precise stop exactly at the path end (the stall):
        // v = sqrt(2·b·remaining) decelerates to 0 right at remaining = 0.
        desiredSpeed = Math.min(desiredSpeed, Math.sqrt(2 * 7 * Math.max(0, remaining)));
        e.car.step(dt, desiredSpeed, steer);
        changed = true;
        if (e.tracker.atEnd(ARRIVE_EPS)) {
          if (e.vstatus === "departing") {
            remove.push(id);
          } else {
            // snap EXACTLY to the target (stall pose, else the path end) so a car
            // never overshoots or oscillates at the end of its route.
            if (e.stallId) {
              const st = useDepotStore.getState().stalls.find((s) => s.id === e.stallId);
              if (st) { e.car.x = st.position.x; e.car.y = st.position.y; }
            } else {
              const ep = e.tracker.endPoint;
              e.car.x = ep.x;
              e.car.y = ep.y;
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
      poseStore.delete(id);
      changed = true;
    }
    if (changed) this.flush();
  }

  private flush() {
    // (1) live poses → the mutable channel EVERY tick (no React, no allocation).
    // The renderers read these imperatively in their own frame loop.
    let key = "";
    for (const [id, e] of this.entries) {
      poseStore.set(id, e.car.x, e.car.y, e.car.heading);
      key += `${id}:${e.vstatus}:${e.stallId ?? ""}:${Math.round(e.soc)};`;
    }
    // (2) the React roster → only when the SET / status / stall / soc changes,
    // so movement never triggers a re-render.
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;
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
