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
import { KinematicCar, DEFAULT_CAR_PARAMS, wrapAngle } from "./motion/KinematicCar";
import { type Pt } from "./motion/PathTracker";
import { buildRail, pointAt, stepRail, RailLocks, type Rail, type RailBody } from "./motion/RailFlow";
import { findLeader, StallLedger, type MovingCar } from "./motion/traffic";
import { buildDepotLanes } from "./motion/LaneGraph";
import { poseStore } from "./motion/poseStore";
import { useDepotStore, type StallStatus } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import type { Vehicle, VehicleStatus } from "@/engine/types";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { INGRESS, EGRESS, gapLaneX, SOUTH_LANE_Y, REAR_LANE_Y } from "@/lib/sitePlan";

type Lane = "dcfc" | "l2" | "wash" | "service" | "staging";

const NORTH = -Math.PI / 2; // facing north (−y) in the y-down logical frame

// Taxi motion is RAIL-CONSTRAINED (see motion/RailFlow.ts): pose = arc position
// on the route polyline; following/intersections/column-docking are enforced by
// projection + locks. There is no steering heuristic and no deadlock ladder —
// lane discipline and no-overlap are structural.
const REVERSE_HOLD_MAX = 6;   // give up a blocked back-out, go forward instead
// COMMIT-AND-HOLD (physical service dwell): the twin advances on big ticks, so a
// charge often COMPLETES in the backend before the renderer finishes the drive-in
// — the car used to get yanked to staging mid-approach and never visibly dock.
// A car committed to a service stall must ARRIVE + dwell a real-time FLOOR before
// any downstream state flip re-lanes it; then it resyncs to the CURRENT twin state
// (bounded catch-up, never a leg replay). CAP bounds the hold under extreme churn.
const DWELL_FLOOR_MS = 12000; // min visible dock — a charge/wash is always SEEN
const DWELL_CAP_MS = 45000;   // hard ceiling on the hold (Phase-2 also uses this)
const DEPART_TTL = 90;        // a departing car that can't reach egress despawns
const MAX_ACTIVE_DEPARTING = 12; // deploy waves leave in packets, not all at once
const MAX_ACTIVE_ENTERING = 6;   // arrival waves enter in packets too (gate backpressure)
const MAX_ACTIVE_SERVICE_APPROACH = 5; // batch charger/bay reassignments back out
                                       // in packets — else every parked staging
                                       // car reverses at once into mutual gridlock
const SPAWN_CLEARANCE = 6;    // don't materialize a car onto another one

// backend vehicle_state (+ any stall it already holds) → { lane, render status,
// stall status }. The stall matters for ONE case — see 'arrived_at_gate' below.
function mapState(
  state: string,
  stallId?: string | null,
): { lane: Lane | "gate" | null; vstatus: VehicleStatus; sstatus: StallStatus } | null {
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
    // ENTRANCE PILEUP FIX: OTTO-Q's congestion fallback PARKS a gate arrival in a
    // staging stall (sets current_stall_id) but deliberately KEEPS the state
    // 'arrived_at_gate' so decide_tick retries it for a charger every tick.
    // Mapping on state alone drew every one of those already-parked cars stacked
    // on the entrance road — the "massive pile up at the gate". If the car
    // already holds a stall, it is NOT waiting at the gate: render it AT the
    // stall it was parked in.
    case "arrived_at_gate":
      return stallId
        ? { lane: "staging", vstatus: "staging", sstatus: "occupied" }
        : { lane: "gate", vstatus: "staging", sstatus: "occupied" };
    default: return null; // deployed / en_route / offline → off-map (departure)
  }
}

// depot center (LOT {x:6,y:6,w:288,h:200}) — perimeter cars nose OUTWARD from it
const DEPOT_CX = 150;
const DEPOT_CY = 106;

// lanes where a car parks to be SERVICED (must be seen docked before moving on)
const SERVICE_LANES = new Set<Lane>(["dcfc", "l2", "wash", "service"]);
const isServiceLane = (l: Lane | "gate" | null): boolean =>
  l != null && SERVICE_LANES.has(l as Lane);

/** Parked heading for a stall. Chargers/bays face NORTH (toward the bays).
 *  Perimeter staging columns/rows nose OUTWARD (away from the depot center)
 *  along their orientation axis, so the pull-in approach point (9u BEHIND the
 *  nose) always lands on the INTERIOR, drivable side — never off the lot edge.
 *  (The old sitePlan-angle heading pointed the west column INWARD, putting its
 *  approach point past the west edge at x≈7, unreachable → cars detoured to the
 *  far edge and crept.) */
function parkedHeading(lane: Lane, angleDeg: number, sx: number, sy: number): number {
  if (lane === "dcfc" || lane === "l2" || lane === "wash" || lane === "service") return NORTH;
  const vertical = angleDeg === 90 || angleDeg === 270; // east-west oriented column
  if (vertical) return sx < DEPOT_CX ? Math.PI : 0;      // west edge→face W, east→face E
  return sy < DEPOT_CY ? NORTH : Math.PI / 2;            // north edge→face N, south→face S
}

interface Entry {
  id: string; // stable vehicle id (also the map key) — lets any rail-swap
              // release this car's node/mouth locks without threading the id
  car: KinematicCar;
  tracker: Rail | null; // the RAIL the car is riding; null = parked
  /** active back-out maneuver: reverse on a fixed arc for `remaining` distance
   *  (with a rear-clearance hold); the rail is rebuilt at the cusp. */
  reverse: { remaining: number; steer: number } | null;
  /** where this car is headed — rails are rebuilt toward this after reverses
   *  and watchdog re-routes */
  dest: { kind: "stall"; lane: Lane; x: number; y: number; heading: number } | { kind: "egress" } | null;
  lane: Lane | "gate" | null;
  stallId: string | null;
  stallHeading: number;
  vstatus: VehicleStatus;
  oem: string;
  soc: number;
  /** human fleet id + make from the twin (av_id 'twin-sim-026', 'Waymo') —
   *  the tooltip shows THESE, never the raw uuid */
  avId: string;
  make: string;
  /** seconds a reverse maneuver has been held by rear traffic */
  holdFor: number;
  /** seconds spent in 'departing' (TTL-despawned so a cork can never persist) */
  departFor: number;
  /** commit-and-hold service dwell: "enroute" = driving to a service stall,
   *  "docked" = arrived + dwelling, "released" = floor met, truth flows again */
  playback: "enroute" | "docked" | "released";
  /** performance.now() when the car docked at its service stall (null until) */
  dwellStartMs: number | null;
}

class TwinMotionDriver {
  private rafId: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private last: number | null = null;
  private graph = buildDepotLanes();
  private ledger = new StallLedger();
  /** intersection-node + charger-column-mouth locks (rails traffic control) */
  private locks = new RailLocks();
  private entries = new Map<string, Entry>();
  /** twin stall uuid → renderer stall id (from the depot layout) — lets the
   *  renderer park each car in the twin's EXACT assigned stall, so OTTO-Q's
   *  spatial decisions (nearest-wash, cuOpt picks) are literally what you see. */
  private twinStall = new Map<string, string>();
  /** Layout gate: when a run activates, the bridge calls expectLayout() and
   *  snapshots BUFFER until the layout fetch settles — otherwise the first
   *  snapshot places the fleet on zone stalls and the layout's arrival triggers
   *  a fleet-wide reshuffle (everyone backing out at once). Defaults true so
   *  tests / standalone use need no ceremony. */
  private layoutSettled = true;
  private pendingSnap: TwinSnapshot | null = null;
  /** roster fingerprint (ids+status+stall+soc) — setVehicles only fires when it changes */
  private lastRosterKey = "";
  /** run the current entries belong to — a snapshot from a DIFFERENT run resets
   *  the scene instead of flooding 100+ stale cars toward the egress at once */
  private runId: string | null = null;
  /** deploy-wave stagger: departures beyond MAX_ACTIVE_DEPARTING wait parked
   *  here and are released as active departers reach the egress */
  private departQueue: string[] = [];
  /** false until the first reconcile after clear(): the initial snapshot places the
   *  existing fleet parked in-place; after that, ANY newly-seen vehicle drives in
   *  from the ingress (kills the mid-run teleport-spawn when a state hop lands
   *  between two polls, e.g. deployed → charging). */
  private primed = false;
  /** operator hold. Motion is frozen in place (poses HOLD exactly where they are,
   *  mid-lane) while true; snapshot reconcile still runs, so a car whose backend
   *  state changed while paused simply resumes toward its new target instead of
   *  teleporting. */
  private paused = false;

  /** Freeze/unfreeze on-screen motion. Dropping `last` on resume means the first
   *  frame back re-seeds the clock instead of applying one giant catch-up dt —
   *  without it the whole depot would lurch forward by the length of the pause. */
  setPaused(v: boolean) {
    if (this.paused === v) return;
    this.paused = v;
    if (!v) this.last = null;
  }

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
    this.layoutSettled = true;
    this.pendingSnap = null;
    this.runId = null;
    this.departQueue = [];
    this.locks = new RailLocks();
    // push an empty roster so no ghost fleet lingers after leaving twin mode
    useVehicleStore.getState().setVehicles([]);
    // ...and no stale stall paint on an empty depot (gap G6): an emptied scene
    // must not keep last run's charging/occupied colors
    const depot = useDepotStore.getState();
    for (const s of depot.stalls) if (s.status !== "available") depot.setStallStatus(s.id, "available");
  }

  /** Reset the SCENE but keep the loop running — used when the snapshot stream
   *  switches to a different sim run: the old fleet must vanish, not become a
   *  100-car ghost wave all routing to the egress at once. */
  private resetScene() {
    this.entries.clear();
    this.ledger.clear();
    poseStore.clear();
    this.lastRosterKey = "";
    this.primed = false;
    this.departQueue = [];
    this.locks = new RailLocks();
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
    this.settleLayout();
  }

  /** Bridge calls this when a run activates: buffer snapshots until the layout
   *  fetch settles (setTwinStallMap on success, layoutFailed on error). */
  expectLayout() {
    this.layoutSettled = false;
  }
  layoutFailed() {
    this.settleLayout(); // zone-based fallback still works
  }
  private settleLayout() {
    this.layoutSettled = true;
    if (this.pendingSnap) {
      const s = this.pendingSnap;
      this.pendingSnap = null;
      this.reconcile(s);
    }
  }

  private createEntry(id: string, pose: { x: number; y: number; heading: number }, lane: Lane | "gate", vstatus: VehicleStatus, oem: string, soc: number): Entry {
    return {
      id,
      car: new KinematicCar(pose, DEFAULT_CAR_PARAMS),
      tracker: null, reverse: null, dest: null,
      lane, stallId: null, stallHeading: pose.heading, vstatus, oem, soc,
      avId: "", make: "",
      holdFor: 0, departFor: 0,
      playback: "released", dwellStartMs: null,
    };
  }

  /** the visible-dwell floor has elapsed since this car docked */
  private floorMet(e: Entry): boolean {
    return e.dwellStartMs != null && performance.now() - e.dwellStartMs >= DWELL_FLOOR_MS;
  }
  /** the hard cap has elapsed (release even if the twin never moved it) */
  private dwellCapped(e: Entry): boolean {
    return e.dwellStartMs != null && performance.now() - e.dwellStartMs >= DWELL_CAP_MS;
  }

  /** Build a rail to a stall (charger columns get a MOUTH key so only one car
   *  docks/undocks in a column throat at a time). */
  private railTo(from: { x: number; y: number }, lane: Lane, stall: { x: number; y: number }, facing: number): Rail {
    const pts = this.routeToStall(from, lane, stall, facing);
    const mouth = lane === "dcfc" || lane === "l2" ? `${lane}:${Math.round(stall.x)}` : null;
    return buildRail(pts, this.graph.nodes.values(), mouth);
  }

  /** If `pose` sits inside a pull-through wash/service bay, return the FORWARD
   *  pull-out-the-rear lead segment + the rear-apron point to route onward from.
   *  A serviced car thus leaves out the REAR (north) and rides the one-way apron
   *  EAST — it never reverses south out the bay front, and never heads west
   *  toward the fenced BESS yard. Returns null when the car isn't in a bay. */
  private bayExit(pose: { x: number; y: number }): { lead: Pt[]; start: { x: number; y: number } } | null {
    const inBay = pose.y > 30 && pose.y < 54 && pose.x > 108 && pose.x < 216;
    if (!inBay) return null;
    const start = { x: pose.x, y: REAR_LANE_Y };
    return { lead: [{ x: pose.x, y: pose.y }, start], start };
  }

  /** Rebuild the rail toward the entry's current destination from its ACTUAL pose. */
  private rebuildRail(e: Entry): Rail | null {
    if (!e.dest) return null;
    if (e.dest.kind === "egress") {
      const be = this.bayExit(e.car.pose);
      const route = this.graph.route(be?.start ?? e.car.pose, { x: EGRESS.x, y: EGRESS.y });
      const pts = be ? [...be.lead, ...route] : route;
      return buildRail(pts, this.graph.nodes.values(), null);
    }
    return this.railTo(e.car.pose, e.dest.lane, e.dest, e.dest.heading);
  }

  /** Point a car at a new destination: sets dest, BACKS OUT first if it is
   *  parked nose-in (>~100° from the route direction), and builds the rail —
   *  immediately, or at the reverse cusp (the rail must start from the true
   *  post-maneuver pose or the car would teleport back). */
  private assignRail(e: Entry, dest: NonNullable<Entry["dest"]>) {
    // CRITICAL: the old route is abandoned, so drop any node/mouth locks this
    // car held on it. Without this, a lock on a node the NEW route doesn't
    // traverse is never released (stepRail only releases nodes it revisits) —
    // a stale lock that stops every car routed through it, seizing the depot.
    this.locks.releaseAll(e.id);
    e.dest = dest;
    const wasParked = e.tracker === null && !e.reverse;
    const rail = this.rebuildRail(e);
    if (!rail) return;
    if (wasParked) {
      const probe = pointAt(rail.pts, rail.cum, Math.min(8, rail.total));
      const ang = wrapAngle(Math.atan2(probe.y - e.car.y, probe.x - e.car.x) - e.car.heading);
      if (Math.abs(ang) > 1.75) {
        e.reverse = { remaining: 11, steer: -Math.sign(ang || 1) * 0.35 };
        e.tracker = null;
        return;
      }
    }
    e.tracker = rail;
  }

  /** Launch a departure: release the stall and route to the egress. */
  private startDeparture(id: string, e: Entry) {
    this.ledger.release(id);
    this.locks.releaseAll(id);
    e.stallId = null;
    // clear any commit-and-hold service state — a departer is no longer docked
    // to / driving toward a service stall (else it keeps a stale service lane +
    // playback and the dwell guard misfires on it).
    e.playback = "released";
    e.dwellStartMs = null;
    this.assignRail(e, { kind: "egress" });
  }

  /** Route a drivable path from `pose` to a stall along the one-way lanes. Charging
   *  stalls are reached via their northbound gap lane (car ends facing north). */
  private routeToStall(pose: { x: number; y: number }, lane: Lane, stall: { x: number; y: number }, facing: number): Pt[] {
    // leaving a bay? pull FORWARD out the rear first, then route from the apron.
    const be = this.bayExit(pose);
    const lead = be?.lead ?? [];
    const start = be?.start ?? pose;
    if (lane === "dcfc" || lane === "l2") {
      const gx = gapLaneX(stall.x);
      const toGap = this.graph.route(start, { x: gx, y: SOUTH_LANE_Y - 2 });
      return [...lead, ...toGap, { x: gx, y: stall.y }, { x: stall.x, y: stall.y }];
    }
    // parking / bays: approach a point one car-length BEHIND the parked heading,
    // then pull straight in — each car fans to its own stall and noses in facing
    // `facing`, instead of trailing others into a shared approach spot.
    const ax = stall.x - Math.cos(facing) * 9;
    const ay = stall.y - Math.sin(facing) * 9;
    return [...lead, ...this.graph.route(start, { x: ax, y: ay }), { x: stall.x, y: stall.y }];
  }

  /** Reconcile render state + routes against a fresh backend snapshot. */
  reconcile(snap: TwinSnapshot) {
    if (!this.layoutSettled) {
      this.pendingSnap = snap; // hold until the exact-stall map settles
      return;
    }
    // run switch: this snapshot belongs to a DIFFERENT sim run than the scene —
    // the old fleet's ids will never match again, so reset instead of letting
    // every old car flood the egress simultaneously (instant gridlock).
    const rid = snap.run?.sim_run_id ?? null;
    if (rid && this.runId && rid !== this.runId) this.resetScene();
    if (rid) this.runId = rid;
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
    // TWIN STALL TRUTH (gaps G2/G7): stalls_status is the twin's authoritative
    // stall feed — the ONLY source for conditions no on-map vehicle explains
    // (faulted/offline chargers, reservations for inbound cars). Faulted stalls
    // recolor, WIN over vehicle-derived colors, and leave the assignment pool
    // so no car is ever routed onto a dead charger.
    const twinFaulted = new Set<string>();
    for (const ss of snap.stalls_status ?? []) {
      const rsid = this.twinStall.get(ss.id);
      if (!rsid) continue;
      const st = String(ss.status ?? "").toLowerCase();
      if (st === "faulted" || st === "offline") twinFaulted.add(rsid);
      else if (st === "reserved") desiredStatus.set(rsid, "reserved");
    }
    // several vehicles can appear in ONE snapshot (twin ticks cover 30 sim-min):
    // stagger their spawn points back along the entrance road so they never
    // materialize stacked on top of each other at the gate.
    let spawnIdx = 0;
    // GATE BACKPRESSURE: cap how many drive-ins may be in the entry pipeline at
    // once (still routed + still in the south gate band). Beyond the cap, new
    // arrivals defer to the next poll instead of flooding the entrance road.
    let enteringActive = 0;
    // cars currently backing out of / driving to a SERVICE stall — a batch
    // charger reassignment must NOT release them all at once (mutual-reverse
    // gridlock in the staging rows), so approaches are metered like the gate.
    let serviceApproaching = 0;
    for (const [, te] of this.entries) {
      if (te.tracker && te.car.y > 195 && te.vstatus !== "departing") enteringActive++;
      if (isServiceLane(te.lane) && te.playback === "enroute" && te.vstatus !== "departing") serviceApproaching++;
    }

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
      const m = mapState(bv.state, bv.stall_id);
      if (!m) continue;
      present.add(bv.id);
      let e = this.entries.get(bv.id);
      const oem = bv.platform ?? e?.oem ?? "waymo";
      const soc = bv.soc ?? e?.soc ?? 0;

      // COMMIT-AND-HOLD: a car driving to / dwelling at a SERVICE stall must be
      // SEEN docked (the charge/wash) before a downstream twin flip re-lanes it.
      // While committed and inside the dwell floor, suppress the lane change:
      // keep the car on its service rail, keep its service paint/dot, just
      // refresh identity + SoC. Once the floor elapses we flip to "released" and
      // the normal reconcile below resyncs to the CURRENT twin state (a bounded
      // catch-up — never a leg replay), taking the car to staging or its next
      // service leg per live truth.
      if (e && isServiceLane(e.lane) && e.playback !== "released") {
        const newLane: Lane | "gate" | null = m.lane === "gate" ? "staging" : m.lane;
        const stillSameDock = newLane === e.lane;
        if (!stillSameDock && !this.floorMet(e)) {
          e.soc = soc;
          e.oem = oem;
          if (bv.av_id) e.avId = bv.av_id;
          if (bv.make) e.make = bv.make;
          if (e.stallId) {
            desiredStatus.set(e.stallId, e.lane === "dcfc" || e.lane === "l2" ? "charging" : "servicing");
          }
          this.entries.set(bv.id, e);
          continue;
        }
        if (this.floorMet(e)) e.playback = "released";
      }

      // NO QUEUE LINES: a vehicle is ALWAYS in a stall (charging/wash/service/
      // staging) or TAXIING between them. An arriving car ("gate") drives in from
      // the ingress and PARKS in a free staging stall; OTTO-Q then taxis it to its
      // sequenced service stall. So "entering" simply targets a staging stall.
      const entering = m.lane === "gate";
      const lane: Lane = entering ? "staging" : (m.lane as Lane);
      // STABILITY BIAS: once a car holds a stall in this lane, it KEEPS it.
      // Migrating parked/en-route cars to a "better" stall caused fleet-wide
      // reshuffles (everyone backing out at once). Reassignment happens ONLY on
      // a lane change (a real new service step).
      if (e && e.lane === lane && e.stallId) {
        desiredStatus.set(e.stallId, m.sstatus);
        e.vstatus = m.vstatus;
        e.oem = oem;
        e.soc = soc;
        if (bv.av_id) e.avId = bv.av_id;
        if (bv.make) e.make = bv.make;
        // MOTION-RESIDUE REPAIR: a car can be tracker-nulled AWAY from its stall
        // (departure-stagger wait, tow freeze) and then re-adopted by the backend
        // into the same lane. This branch used to keep it frozen mid-lane at a
        // mid-turn heading forever — the "diagonal car between stalls" defect.
        // If it has no route and isn't physically at its stall pose, re-route it.
        if (!e.tracker && !e.reverse) {
          const st = stalls.find((s) => s.id === e.stallId);
          if (st) {
            const off = Math.hypot(e.car.x - st.position.x, e.car.y - st.position.y);
            let dh = Math.abs(e.car.heading - e.stallHeading) % (2 * Math.PI);
            if (dh > Math.PI) dh = 2 * Math.PI - dh;
            if (off > 1.8 || dh > 0.2) {
              this.assignRail(e, { kind: "stall", lane: lane as Lane, x: st.position.x, y: st.position.y, heading: e.stallHeading });
              e.departFor = 0;
            }
          }
        }
        this.entries.set(bv.id, e);
        continue;
      }
      const cands = (byLane[lane] ?? []).map((s) => s.id).filter((sid) => !twinFaulted.has(sid));
      // EXACT-STALL FIDELITY: if the twin named this vehicle's stall and it maps
      // to a renderer stall in the right zone, claim exactly that one — what you
      // see is literally OTTO-Q's assignment. Zone-based pick is the fallback
      // (unmapped stall, renderer/twin drift, or stale local claim).
      let stallId: string | null = null;
      const exact = bv.stall_id ? this.twinStall.get(bv.stall_id) : undefined;
      if (exact && cands.includes(exact) && this.ledger.claim(bv.id, exact)) stallId = exact;
      if (!stallId) stallId = this.ledger.claimFirstFree(bv.id, cands);
      if (!stallId) {
        // overflow (no free stall in the target lane): a NEW car stays off-map
        // until a stall frees. An EXISTING car that just LANE-CHANGED must not
        // keep squatting on its old stall (a twin-washing car parked on a charger
        // visually blocks it forever — the "not moving to its next assignment"
        // defect): pull it out to a staging spot to wait its turn instead.
        if (e) {
          if (e.lane !== lane && lane !== "staging") {
            const stageCands = (byLane.staging ?? []).map((s) => s.id).filter((sid) => !twinFaulted.has(sid));
            const st2 = this.ledger.claimFirstFree(bv.id, stageCands);
            // GUARD (mirror of the stall-unchanged check below): claimFirstFree
            // returns the car's OWN staging stall on every later poll while the
            // target lane stays full — rebuilding the route each time made the
            // car perpetually back out, loop over the gate road and re-park
            // (diagonal bodies in the staging rows + entrance-road churn).
            // Only route when the claimed stall is genuinely NEW.
            if (st2 && st2 !== e.stallId) {
              const s2 = stalls.find((s) => s.id === st2)!;
              const sh2 = parkedHeading("staging", s2.position.angle, s2.position.x, s2.position.y);
              this.assignRail(e, { kind: "stall", lane: "staging", x: s2.position.x, y: s2.position.y, heading: sh2 });
              e.stallId = st2;
              e.stallHeading = sh2;
              e.lane = "staging";
              desiredStatus.set(st2, "occupied");
            } else if (st2) {
              // already waiting in this very stall — just keep it held
              e.lane = "staging";
              desiredStatus.set(st2, "occupied");
            }
          }
          e.vstatus = m.vstatus;
          e.oem = oem;
          e.soc = soc;
          this.entries.set(bv.id, e);
        }
        continue;
      }
      const stall = stalls.find((s) => s.id === stallId)!;
      const sp = { x: stall.position.x, y: stall.position.y };
      const sh = parkedHeading(lane, stall.position.angle, stall.position.x, stall.position.y);
      if (!e) {
        // first seen: entering cars — and, once primed, ANY newly-appearing car
        // (state hop between polls) — start at the ingress and DRIVE to their
        // stall; only the initial snapshot places the fleet parked in-place.
        const driveIn = entering || this.primed;
        let spawn: { x: number; y: number } | null = null;
        if (driveIn) {
          if (enteringActive >= MAX_ACTIVE_ENTERING) {
            // gate pipeline full — defer this arrival to the next snapshot
            this.ledger.release(bv.id);
            continue;
          }
          // ORDERLY GATE QUEUE: line arrivals up SINGLE-FILE receding EAST along
          // the approach road (arrivals enter east, depart west — so the queue
          // never mixes with the egress stream). The old placement alternated
          // ±9 east/west, which parked cars ABREAST across the entrance — a row
          // shoulder-to-shoulder at the gate reads as a pile-up; a line receding
          // back up the approach reads as a queue, which is what a real depot
          // does. Clamped to stay on-map.
          // ADMISSION CONTROL: only take a spot that's physically CLEAR. Every
          // poll reuses the same offsets, so spawning blind dropped new arrivals
          // ON TOP of still-taxiing ones — an overlapped plug at the ingress that
          // gridlocked the whole depot. No clear spot → defer to the next poll.
          for (let i = spawnIdx; i < 10 && !spawn; i++) {
            const p = { x: Math.min(292, INGRESS.x + 6 + i * 8), y: INGRESS.y - 2 };
            let clear = true;
            for (const [, other] of this.entries) {
              if (Math.hypot(other.car.x - p.x, other.car.y - p.y) < SPAWN_CLEARANCE) { clear = false; break; }
            }
            if (clear) { spawn = p; spawnIdx = i + 1; }
          }
          if (!spawn) {
            // spawn row full/blocked this poll — defer this arrival to the next
            // snapshot rather than materializing off-map or on another car.
            this.ledger.release(bv.id);
            continue;
          }
          enteringActive++;
        }
        // off-gate spawns face ALONG the road toward the gate (a car facing
        // NORTH into the fence 5u away can't make the turn — min radius ~11u
        // swept it across the fence line); only the on-axis spot faces north.
        const spawnHeading = !spawn ? NORTH
          : spawn.x - INGRESS.x > 4 ? Math.PI
          : spawn.x - INGRESS.x < -4 ? 0
          : NORTH;
        const start = driveIn && spawn
          ? { x: spawn.x, y: spawn.y, heading: spawnHeading }
          : { x: sp.x, y: sp.y, heading: sh };
        e = this.createEntry(bv.id, start, lane, m.vstatus, oem, soc);
        e.avId = bv.av_id ?? "";
        e.make = bv.make ?? "";
        e.stallId = stallId;
        e.stallHeading = sh;
        if (driveIn) {
          this.assignRail(e, { kind: "stall", lane, x: sp.x, y: sp.y, heading: sh });
          if (isServiceLane(lane)) serviceApproaching++;
        }
      } else if (e.stallId !== stallId) {
        // SERVICE-APPROACH STAGGER: a parked car reassigned to a charger/bay
        // waits its turn — releasing a whole batch at once makes them all back
        // out simultaneously into a mutual-reverse gridlock in the staging rows.
        const parked = e.tracker === null && !e.reverse;
        if (isServiceLane(lane) && parked && serviceApproaching >= MAX_ACTIVE_SERVICE_APPROACH) {
          e.soc = soc;
          e.oem = oem;
          if (bv.av_id) e.avId = bv.av_id;
          if (bv.make) e.make = bv.make;
          if (e.stallId) desiredStatus.set(e.stallId, "occupied"); // holds its staging spot
          this.entries.set(bv.id, e);
          continue; // retry next poll when a slot frees
        }
        // re-assigned to a new stall → taxi there (backing out first if it was
        // parked and the route starts behind its nose)
        this.assignRail(e, { kind: "stall", lane, x: sp.x, y: sp.y, heading: sh });
        e.stallId = stallId;
        e.stallHeading = sh;
        if (isServiceLane(lane)) serviceApproaching++;
      }
      e.lane = lane;
      e.vstatus = m.vstatus;
      desiredStatus.set(stallId, m.sstatus);
      e.oem = oem;
      e.soc = soc;
      // COMMIT-AND-HOLD state (this path only runs on a NEW/RE-assignment; the
      // stability branch above already `continue`d): a car assigned to a SERVICE
      // stall is "enroute" while it drives there, or "docked" if it was placed
      // parked in-place at it (initial snapshot of a mid-charge car). Any
      // non-service assignment releases the hold.
      if (isServiceLane(lane)) {
        if (e.tracker || e.reverse) {
          e.playback = "enroute";
          e.dwellStartMs = null;
        } else {
          e.playback = "docked";
          e.dwellStartMs = performance.now();
        }
      } else {
        e.playback = "released";
        e.dwellStartMs = null;
      }
      this.entries.set(bv.id, e);
    }

    // departures: rendered but no longer held by the backend → drive to egress.
    // STAGGERED: a deploy wave can release 50+ vehicles in one snapshot; routing
    // them all simultaneously saturates the perimeter road and gridlocks the
    // depot. Only MAX_ACTIVE_DEPARTING drive at once — the rest wait parked
    // (keeping their stall so nobody is routed into an occupied spot) and are
    // released from the queue as active departers reach the egress.
    let activeDeparting = 0;
    for (const [, e] of this.entries) {
      if (e.vstatus === "departing" && e.tracker) activeDeparting++;
    }
    for (const [id, e] of this.entries) {
      if (present.has(id)) continue;
      // COMMIT-AND-HOLD: a car mid-service-dwell that vanishes from the snapshot
      // (twin already deployed it) must still be SEEN docked for the floor before
      // it departs — hold one more poll, keep its stall painted, don't launch.
      if (e.playback === "docked" && !this.floorMet(e) && !this.dwellCapped(e)) {
        if (e.stallId) desiredStatus.set(e.stallId, e.lane === "dcfc" || e.lane === "l2" ? "charging" : "servicing");
        continue;
      }
      if (e.vstatus !== "departing") {
        e.vstatus = "departing";
        e.departFor = 0;
        if (activeDeparting < MAX_ACTIVE_DEPARTING) {
          activeDeparting++;
          this.startDeparture(id, e);
        } else {
          // wait for a slot. A PARKED car waits in place (stall claim kept).
          // A MID-TAXI car must NOT be frozen at its mid-turn pose (that made
          // diagonal statues between stalls) — it keeps its route, finishes
          // the pull-in, parks, and departs when the queue releases it.
          if (!e.tracker) {
            e.reverse = null;
            e.car.speed = 0;
          }
          // a waiting departer still SITS on its stall — keep it painted
          // occupied (was: green "available" under a parked car, gap G6)
          if (e.stallId) desiredStatus.set(e.stallId, "occupied");
          this.departQueue.push(id);
        }
      }
    }

    // stall statuses — queued departers still SIT on their stalls (repaint every
    // poll, gap G6); twin-faulted stalls WIN over everything (gap G2).
    for (const qid of this.departQueue) {
      const qe = this.entries.get(qid);
      if (qe && !qe.tracker && qe.stallId) desiredStatus.set(qe.stallId, "occupied");
    }
    for (const s of stalls) {
      const want: StallStatus = twinFaulted.has(s.id) ? "offline" : (desiredStatus.get(s.id) ?? "available");
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
    // Operator hold: keep the clock rolling forward but integrate nothing, so
    // every car stops dead the frame Pause is pressed and no dt accumulates.
    if (this.paused) {
      this.last = ts;
      return;
    }
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
    // Single chokepoint for ALL motion: guarding here (not just in step) means
    // no caller — loop, interval, or test — can advance a held depot.
    if (this.paused) return;
    // every physical body on the lot, one entry each — rail cars project these
    // onto their own forward windows (RailFlow); `moving` is kept only for the
    // reverse maneuver's rear-clearance check.
    const bodies: RailBody[] = [];
    const moving: MovingCar[] = [];
    for (const [id, e] of this.entries) {
      bodies.push({ id, x: e.car.x, y: e.car.y });
      moving.push({ id, pose: e.car.pose, speed: e.car.speed });
    }

    let changed = false;
    const remove: string[] = [];
    for (const [id, e] of this.entries) {
      if (e.reverse) {
        // BACK-OUT maneuver: reverse on a fixed arc (nose swings toward the route)
        // with a rear-clearance hold — never backs into passing traffic. The hold
        // is TIMED: two cars backing toward each other (or a stopped queue behind)
        // would otherwise hold each other forever — after REVERSE_HOLD_MAX the car
        // gives up the back-out and drives forward from wherever it is instead.
        const rearPose = { x: e.car.x, y: e.car.y, heading: wrapAngle(e.car.heading + Math.PI) };
        const rear = findLeader({ id, pose: rearPose, speed: 0 }, moving, 2.6, 12);
        const blocked = rear.gap < 6;
        let done = false;
        if (blocked) {
          e.holdFor += dt;
          if (e.holdFor > REVERSE_HOLD_MAX) done = true;
        } else e.holdFor = 0;
        if (!done) {
          const vRev = blocked ? 0 : -e.car.params.maxReverseSpeed * 0.8;
          e.car.step(dt, vRev, e.reverse.steer);
          e.reverse.remaining -= Math.abs(e.car.speed) * dt;
          if (e.reverse.remaining <= 0) done = true;
        }
        if (done) {
          // cusp: the rail must start from the ACTUAL post-maneuver pose —
          // rebuild it now (building it earlier would teleport the car back).
          e.reverse = null;
          e.car.steer = 0;
          e.holdFor = 0;
          const next = this.rebuildRail(e);
          if (next) e.tracker = next;
        }
        changed = true;
        continue;
      }
      // a QUEUED departer (waiting parked for a departure slot) still ages out:
      // the backend already dropped it, so it never lingers past the TTL.
      if (!e.tracker && e.vstatus === "departing") {
        e.departFor += dt;
        if (e.departFor > DEPART_TTL) {
          // TTL while queued: DRIVE OUT (cap-exempt) instead of vanishing in
          // place on a stall (gap G6). Bounded second life: the tracked-departer
          // TTL below still despawns it if the egress stays jammed.
          this.startDeparture(id, e);
          e.departFor = DEPART_TTL * 0.5;
          changed = true;
        }
        continue;
      }
      if (e.tracker) {
        // RAILS: the car IS at its route's arc position — pose comes from the
        // polyline (tangent heading), speed from IDM against every body
        // projected onto MY forward window, plus intersection-node locks and
        // charger-column mouth locks (see RailFlow). Lane discipline and
        // no-overlap are STRUCTURAL: a rail car cannot leave its lane or pass
        // through a body. No steering heuristics, no deadlock ladder.
        if (e.vstatus === "departing") {
          e.departFor += dt;
          if (e.departFor > DEPART_TTL) {
            remove.push(id); // cork insurance: a departer NEVER outlives its TTL
            continue;
          }
        }
        const pose = stepRail(id, e.tracker, dt, bodies, this.locks);
        changed = true;
        if (pose) {
          e.car.x = pose.x;
          e.car.y = pose.y;
          e.car.heading = pose.heading;
          e.car.speed = e.tracker.v;
          // watchdog: stationary far too long (a dead body ON the lane, a stale
          // lock) → drop my locks and re-route from the current pose. Bounded
          // self-heal; never creeps, never phases through anything.
          if (e.tracker.stationaryFor > 45) {
            this.locks.releaseAll(id);
            const next = this.rebuildRail(e);
            if (next) e.tracker = next;
            e.tracker.stationaryFor = 0;
          }
        } else {
          // ARRIVED at the rail end
          this.locks.releaseAll(id);
          if (e.vstatus === "departing" && !this.departQueue.includes(id)) {
            remove.push(id);
          } else {
            // snap EXACTLY to the stall pose — a car never overshoots; queued
            // departers wait PARKED at their stall for a launch slot.
            if (e.stallId) {
              const st = useDepotStore.getState().stalls.find((s) => s.id === e.stallId);
              if (st) { e.car.x = st.position.x; e.car.y = st.position.y; }
            }
            e.car.heading = e.stallHeading;
            e.car.speed = 0;
            e.car.steer = 0;
            e.tracker = null;
            e.reverse = null;
            // COMMIT-AND-HOLD: a car that just docked at a SERVICE stall starts
            // its visible dwell clock now — the charge/wash is SEEN before any
            // downstream flip can move it (guarded in reconcile).
            if (isServiceLane(e.lane) && e.playback === "enroute") {
              e.playback = "docked";
              e.dwellStartMs = performance.now();
            }
          }
        }
      } else if (e.car.speed !== 0) {
        e.car.speed = 0; // parked: hold still
        changed = true;
      }
    }
    for (const id of remove) {
      this.ledger.release(id);
      this.locks.releaseAll(id);
      this.entries.delete(id);
      poseStore.delete(id);
      changed = true;
    }
    // top up the departure packet: as active departers reach the egress (or age
    // out), release the next queued ones so a deploy wave drains continuously
    // without ever saturating the perimeter road.
    if (this.departQueue.length) {
      let active = 0;
      for (const [, e] of this.entries) {
        if (e.vstatus === "departing" && e.tracker) active++;
      }
      const stillDriving: string[] = [];
      while (active < MAX_ACTIVE_DEPARTING && this.departQueue.length) {
        const id = this.departQueue.shift()!;
        const e = this.entries.get(id);
        // skip ids that despawned or were re-adopted by the backend since queuing
        if (!e || e.vstatus !== "departing") continue;
        // a queued car still finishing its pull-in stays queued until parked
        if (e.tracker) { stillDriving.push(id); continue; }
        this.startDeparture(id, e);
        active++;
        changed = true;
      }
      this.departQueue.push(...stillDriving);
    }
    if (changed) this.flush();
  }

  private flush() {
    // (1) live poses → the mutable channel EVERY tick (no React, no allocation).
    // The renderers read these imperatively in their own frame loop.
    let key = "";
    for (const [id, e] of this.entries) {
      poseStore.set(id, e.car.x, e.car.y, e.car.heading);
      // SoC bucketed to 5% — per-percent churn used to invalidate the roster on
      // nearly every poll and re-render the whole SVG tree + every 3D car.
      key += `${id}:${e.vstatus}:${e.stallId ?? ""}:${Math.round(e.soc / 5)};`;
    }
    // (2) the React roster → only when the SET / status / stall / soc changes,
    // so movement never triggers a re-render.
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;
    const arr: Vehicle[] = [];
    for (const [id, e] of this.entries) {
      arr.push({
        id, label: e.avId ? (e.make ? `${e.avId} · ${e.make}` : e.avId) : undefined,
        type: "fleet", oem: e.oem, priority: 5,
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

// dev-only debug handle: HMR can leave module duplicates, so console/tooling
// probes must reach the instance the APP is actually driving.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__twinDriver = twinMotionDriver;
}
