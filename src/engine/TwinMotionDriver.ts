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

// ---- anti-deadlock ladder (seconds stuck behind a STATIONARY blocker) ----
// A yield graph with cycles (A yields to B yields to A) or an overlapped spawn
// can otherwise freeze the whole depot permanently. Legit queues (blocker is
// MOVING) never accumulate stuck-time, so normal car-following is untouched.
const RELAX_AFTER = 8;    // ignore cross-traffic + parked-blocker gates, creep
const REROUTE_AFTER = 18; // rebuild the route from the current pose (path around it)
const ESCAPE_AFTER = 28;  // last resort: ignore MOVING blockers only — a car may
                          // crawl past a mutually-stuck mover, but NEVER through
                          // a parked body (phase-through read as "collisions")
const REVERSE_HOLD_MAX = 6;   // give up a blocked back-out, go forward instead
const DEPART_TTL = 90;        // a departing car that can't reach egress despawns
const MAX_ACTIVE_DEPARTING = 12; // deploy waves leave in packets, not all at once
const MAX_ACTIVE_ENTERING = 6;   // arrival waves enter in packets too (gate backpressure)
const SPAWN_CLEARANCE = 6;    // don't materialize a car onto another one

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
  /** active back-out maneuver: reverse on a fixed arc for `remaining` distance
   *  (with a rear-clearance hold), then hand over to the tracker. */
  reverse: { remaining: number; steer: number } | null;
  lane: Lane | "gate" | null;
  stallId: string | null;
  stallHeading: number;
  vstatus: VehicleStatus;
  oem: string;
  soc: number;
  /** seconds stopped behind a STATIONARY blocker (deadlock-breaker ladder) */
  stuckFor: number;
  /** seconds a reverse maneuver has been held by rear traffic */
  holdFor: number;
  /** seconds spent in 'departing' (TTL-despawned so a cork can never persist) */
  departFor: number;
  /** one reroute per stuck episode — cleared when the car frees up */
  rerouted: boolean;
  /** who blocked me this tick (min-gap body) — deadlock-cycle analysis */
  blockerId: string | null;
  /** raw pinned/mouth/free observations this tick; the post-loop pass turns
   *  them into stuckFor accrual ONLY for true deadlocks (cycle) or wedges
   *  (parked blocker) — a legitimately stopped queue never escalates. */
  pinnedRaw: boolean;
  mouthRaw: boolean;
  freeRaw: boolean;
  /** my mutual-deadlock partner (escape may pass THIS body only) */
  cycleWith: string | null;
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
    // push an empty roster so no ghost fleet lingers after leaving twin mode
    useVehicleStore.getState().setVehicles([]);
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

  private createEntry(pose: { x: number; y: number; heading: number }, lane: Lane | "gate", vstatus: VehicleStatus, oem: string, soc: number): Entry {
    return {
      car: new KinematicCar(pose, DEFAULT_CAR_PARAMS),
      tracker: null, reverse: null, lane, stallId: null, stallHeading: pose.heading, vstatus, oem, soc,
      stuckFor: 0, holdFor: 0, departFor: 0, rerouted: false,
      blockerId: null, pinnedRaw: false, mouthRaw: false, freeRaw: false, cycleWith: null,
    };
  }

  /** A car leaving a stall it nosed INTO must BACK OUT first: if the new route
   *  starts behind the parked heading (>~100°), begin a reverse arc that swings
   *  the nose toward the route side; pure-pursuit takes over after. (In reverse,
   *  heading rotates OPPOSITE the steer sign, hence -sign(angleToRoute).) */
  private maybeStartReverse(e: Entry) {
    if (!e.tracker) return;
    const probe = e.tracker.pointAtArc(Math.min(8, e.tracker.total));
    const ang = wrapAngle(Math.atan2(probe.y - e.car.y, probe.x - e.car.x) - e.car.heading);
    if (Math.abs(ang) > 1.75) {
      e.reverse = { remaining: 11, steer: -Math.sign(ang || 1) * 0.35 };
    }
  }

  /** Launch a departure: release the stall and route to the egress. */
  private startDeparture(id: string, e: Entry) {
    this.ledger.release(id);
    e.stallId = null;
    const wasParked = e.tracker === null;
    e.tracker = new PathTracker(this.graph.route(e.car.pose, { x: EGRESS.x, y: EGRESS.y }));
    if (wasParked) this.maybeStartReverse(e);
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
    // several vehicles can appear in ONE snapshot (twin ticks cover 30 sim-min):
    // stagger their spawn points back along the entrance road so they never
    // materialize stacked on top of each other at the gate.
    let spawnIdx = 0;
    // GATE BACKPRESSURE: cap how many drive-ins may be in the entry pipeline at
    // once (still routed + still in the south gate band). Beyond the cap, new
    // arrivals defer to the next poll instead of flooding the entrance road.
    let enteringActive = 0;
    for (const [, te] of this.entries) {
      if (te.tracker && te.car.y > 195 && te.vstatus !== "departing") enteringActive++;
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
      // STABILITY BIAS: once a car holds a stall in this lane, it KEEPS it.
      // Migrating parked/en-route cars to a "better" stall caused fleet-wide
      // reshuffles (everyone backing out at once). Reassignment happens ONLY on
      // a lane change (a real new service step).
      if (e && e.lane === lane && e.stallId) {
        desiredStatus.set(e.stallId, m.sstatus);
        e.vstatus = m.vstatus;
        e.oem = oem;
        e.soc = soc;
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
            if (off > ARRIVE_EPS || dh > 0.2) {
              e.tracker = new PathTracker(this.routeToStall(e.car.pose, lane,
                { x: st.position.x, y: st.position.y }, e.stallHeading));
              e.departFor = 0;
            }
          }
        }
        this.entries.set(bv.id, e);
        continue;
      }
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
        // overflow (no free stall in the target lane): a NEW car stays off-map
        // until a stall frees. An EXISTING car that just LANE-CHANGED must not
        // keep squatting on its old stall (a twin-washing car parked on a charger
        // visually blocks it forever — the "not moving to its next assignment"
        // defect): pull it out to a staging spot to wait its turn instead.
        if (e) {
          if (e.lane !== lane && lane !== "staging") {
            const stageCands = (byLane.staging ?? []).map((s) => s.id);
            const st2 = this.ledger.claimFirstFree(bv.id, stageCands);
            // GUARD (mirror of the stall-unchanged check below): claimFirstFree
            // returns the car's OWN staging stall on every later poll while the
            // target lane stays full — rebuilding the route each time made the
            // car perpetually back out, loop over the gate road and re-park
            // (diagonal bodies in the staging rows + entrance-road churn).
            // Only route when the claimed stall is genuinely NEW.
            if (st2 && st2 !== e.stallId) {
              const s2 = stalls.find((s) => s.id === st2)!;
              const sh2 = parkedHeading("staging", s2.position.angle);
              const wasParked = e.tracker === null;
              e.tracker = new PathTracker(this.routeToStall(e.car.pose, "staging",
                { x: s2.position.x, y: s2.position.y }, sh2));
              if (wasParked) this.maybeStartReverse(e);
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
      const sh = parkedHeading(lane, stall.position.angle);
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
          // alternate east/west along the entrance road: 0, +9, -9, +18, -18 …
          // ADMISSION CONTROL: only take a spot that's physically CLEAR. Every
          // poll reuses the same offsets, so spawning blind dropped new arrivals
          // ON TOP of still-taxiing ones — an overlapped plug at the ingress that
          // gridlocked the whole depot. No clear spot → defer to the next poll.
          for (let i = spawnIdx; i < 10 && !spawn; i++) {
            const off = Math.ceil(i / 2) * 9 * (i % 2 === 0 ? -1 : 1);
            const p = { x: INGRESS.x + off, y: INGRESS.y - 4 };
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
        e = this.createEntry(start, lane, m.vstatus, oem, soc);
        e.stallId = stallId;
        e.stallHeading = sh;
        if (driveIn) e.tracker = new PathTracker(this.routeToStall(start, lane, sp, sh));
      } else if (e.stallId !== stallId) {
        // re-assigned to a new stall → taxi there (backing out first if it was
        // parked and the route starts behind its nose)
        const wasParked = e.tracker === null;
        e.tracker = new PathTracker(this.routeToStall(e.car.pose, lane, sp, sh));
        if (wasParked) this.maybeStartReverse(e);
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
          this.departQueue.push(id);
        }
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
    const stationary: MovingCar[] = []; // EVERY stopped body: parked OR queued
    for (const [id, e] of this.entries) {
      const mc = { id, pose: e.car.pose, speed: e.car.speed };
      moving.push(mc);
      (e.tracker ? movers : parked).push(mc);
      if (Math.abs(e.car.speed) < 0.1) stationary.push(mc);
    }

    let changed = false;
    const remove: string[] = [];
    for (const [id, e] of this.entries) {
      if (e.tracker && e.reverse) {
        // BACK-OUT maneuver: reverse on a fixed arc (nose swings toward the route)
        // with a rear-clearance hold — never backs into passing traffic. The hold
        // is TIMED: two cars backing toward each other (or a stopped queue behind)
        // would otherwise hold each other forever — after REVERSE_HOLD_MAX the car
        // gives up the back-out and lets pure-pursuit take it forward instead.
        const rearPose = { x: e.car.x, y: e.car.y, heading: wrapAngle(e.car.heading + Math.PI) };
        const rear = findLeader({ id, pose: rearPose, speed: 0 }, moving, 2.6, 12);
        const blocked = rear.gap < 6;
        if (blocked) {
          e.holdFor += dt;
          if (e.holdFor > REVERSE_HOLD_MAX) {
            e.reverse = null;
            e.car.steer = 0;
            e.holdFor = 0;
            changed = true;
            continue;
          }
        } else e.holdFor = 0;
        const vRev = blocked ? 0 : -e.car.params.maxReverseSpeed * 0.8;
        e.car.step(dt, vRev, e.reverse.steer);
        e.reverse.remaining -= Math.abs(e.car.speed) * dt;
        if (e.reverse.remaining <= 0) {
          e.reverse = null; // cusp: stop steering hard, hand over to pure-pursuit
          e.car.steer = 0;
        }
        changed = true;
        continue;
      }
      // a QUEUED departer (waiting parked for a departure slot) still ages out:
      // the backend already dropped it, so it never lingers past the TTL.
      if (!e.tracker && e.vstatus === "departing") {
        e.departFor += dt;
        if (e.departFor > DEPART_TTL) remove.push(id);
        continue;
      }
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
        // parked-blocker band: 3.0 > a car's 2.5 half-width (2.1 let movers CLIP
        // THROUGH parked bodies) yet < the 4.6u offset of docked charger rows, so
        // stall occupants still never phantom-block the driving lanes.
        const block = findLeader(self, parked, 3.0, 20);
        const fullGap = Math.min(lead.gap, cross.gap, block.gap);
        const fullLeadSpeed = fullGap === block.gap ? 0 : fullGap === lead.gap ? lead.leaderSpeed : cross.leaderSpeed;
        // DEADLOCK LADDER: mutual yields (A waits on B, B waits on A) and
        // overlapped bodies have no head to unwind from, so a car pinned behind
        // a STATIONARY blocker escalates: after RELAX_AFTER it stops yielding to
        // cross-traffic/parked bodies and creeps behind its lane leader only;
        // after ESCAPE_AFTER it ignores gaps entirely and crawls free (separation
        // steer still pushes it around bodies). Normal queues (moving leader)
        // never accumulate stuck-time, so realistic following is untouched.
        let gap = fullGap;
        let leadSpeed = fullLeadSpeed;
        if (e.stuckFor >= ESCAPE_AFTER) {
          // escape: pass ONLY my mutual-deadlock partner (cycleWith); every
          // other body — parked row or stopped queue — stays solid. The pair
          // dissolves as both creep past each other (separation steer pushes
          // them apart); nobody ever crawls through legitimate traffic.
          const noCycle = (arr: MovingCar[]) =>
            e.cycleWith ? arr.filter((c) => c.id !== e.cycleWith) : arr;
          const l2 = findLeader(self, noCycle(movers), 3.2, 34);
          const s2 = findLeader(self, noCycle(stationary), 3.0, 20);
          gap = Math.min(l2.gap, s2.gap);
          leadSpeed = gap === s2.gap ? 0 : l2.leaderSpeed;
        } else if (e.stuckFor >= RELAX_AFTER) {
          // relax: drop cross-traffic yields only — keep the lane leader AND a
          // hard gap to every STATIONARY body (the old rung dropped parked
          // bodies from the gap and creeped cars INTO their neighbors).
          const s2 = findLeader(self, stationary, 3.0, 20);
          gap = Math.min(lead.gap, s2.gap);
          leadSpeed = gap === s2.gap ? 0 : lead.leaderSpeed;
        }
        const accel = idmAccel(e.car.speed, gap, leadSpeed);
        let desiredSpeed = Math.max(0, e.car.speed + accel * dt);
        if (e.stuckFor >= ESCAPE_AFTER) desiredSpeed = Math.min(desiredSpeed, 1.2);
        else if (e.stuckFor >= RELAX_AFTER) desiredSpeed = Math.min(desiredSpeed, 2.0);
        // ... AND ease to a precise stop exactly at the path end (the stall):
        // v = sqrt(2·b·remaining) decelerates to 0 right at remaining = 0.
        desiredSpeed = Math.min(desiredSpeed, Math.sqrt(2 * 7 * Math.max(0, remaining)));
        e.car.step(dt, desiredSpeed, steer + sep);
        changed = true;
        // RAW stuck observations off the FULL (unrelaxed) picture. The post-loop
        // deadlock pass (cycle/wedge analysis over blocker ids) decides whether
        // stuckFor actually accrues — a legitimately stopped queue never
        // escalates, so the ladder can't mass-fire at the gate anymore.
        e.blockerId =
          fullGap === block.gap ? block.leaderId :
          fullGap === lead.gap ? lead.leaderId : cross.leaderId;
        e.pinnedRaw = e.car.speed < 0.15 && fullGap < 8 && fullLeadSpeed < 0.1 && remaining > 4;
        // stall-mouth: blocked in the final 4u of a pull-in used to RESET the
        // ladder (a car wedged half-into its stall waited forever) — now it may
        // escalate, but only as far as the REROUTE rung (never creep/escape,
        // so a normal ease-in beside parked neighbors can't clip them).
        e.mouthRaw = e.car.speed < 0.15 && fullGap < 5 && fullLeadSpeed < 0.1 && remaining <= 4;
        e.freeRaw = fullGap > 10 || fullLeadSpeed >= 0.1;
        if (e.stuckFor >= REROUTE_AFTER && !e.rerouted) {
          // last rung: a fresh route from the current pose often resolves a
          // geometric wedge the ladder can't (drop back to RELAX, not zero,
          // so a still-stuck car re-escalates quickly instead of re-freezing).
          if (e.vstatus === "departing") {
            e.tracker = new PathTracker(this.graph.route(e.car.pose, { x: EGRESS.x, y: EGRESS.y }));
          } else if (e.stallId && e.lane && e.lane !== "gate") {
            const st = useDepotStore.getState().stalls.find((s) => s.id === e.stallId);
            if (st) e.tracker = new PathTracker(this.routeToStall(e.car.pose, e.lane as Lane, { x: st.position.x, y: st.position.y }, e.stallHeading));
          }
          e.reverse = null;
          e.rerouted = true; // one reroute per episode; ladder continues to escape if still stuck
        }
        if (e.vstatus === "departing") {
          e.departFor += dt;
          if (e.departFor > DEPART_TTL) {
            remove.push(id); // cork insurance: a departer NEVER outlives its TTL
            continue;
          }
        }
        if (e.tracker.atEnd(ARRIVE_EPS)) {
          if (e.vstatus === "departing" && !this.departQueue.includes(id)) {
            remove.push(id);
          } else if (e.vstatus === "departing" && e.stallId) {
            // a QUEUED departer that was mid-taxi finishes its pull-in and waits
            // PARKED at its stall (the release loop launches it when a slot frees)
            const st = useDepotStore.getState().stalls.find((s) => s.id === e.stallId);
            if (st) { e.car.x = st.position.x; e.car.y = st.position.y; }
            e.car.heading = e.stallHeading;
            e.car.speed = 0;
            e.car.steer = 0;
            e.tracker = null;
            e.reverse = null;
            e.stuckFor = 0;
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
            e.reverse = null;
            e.stuckFor = 0;
          }
        }
      } else if (e.car.speed !== 0) {
        e.car.speed = 0; // parked: hold still
        changed = true;
      }
    }
    // DEADLOCK ANALYSIS: stuckFor accrues ONLY for a true deadlock — my blocker
    // chain CYCLES back to me (mutual yield) — or a WEDGE (a parked, tracker-
    // less body blocks me; reroute is the way around). A car queued behind a
    // stopped-but-routed car is just traffic: it waits, like a real car. This
    // is what stops the whole gate queue from "escaping" through itself.
    for (const [id, e] of this.entries) {
      if (!e.tracker || e.reverse) { e.cycleWith = null; continue; }
      let accrue = false;
      e.cycleWith = null;
      if ((e.pinnedRaw || e.mouthRaw) && e.blockerId) {
        const b = this.entries.get(e.blockerId);
        if (!b || !b.tracker) {
          accrue = true; // wedge: a parked/foreign body blocks me
        } else {
          // walk my blocker chain — accrue only if it comes back to ME
          let cur: string | null = e.blockerId;
          const seen = new Set<string>();
          for (let hop = 0; cur && hop < 8; hop++) {
            if (cur === id) { accrue = true; e.cycleWith = e.blockerId; break; }
            if (seen.has(cur)) break; // a foreign cycle ahead — their ladder resolves it
            seen.add(cur);
            const ce = this.entries.get(cur);
            // reversing/parked links terminate the chain (they resolve themselves)
            cur = ce && ce.tracker && !ce.reverse ? ce.blockerId : null;
          }
        }
      }
      if (accrue) {
        e.stuckFor += dt;
        // mouth-blocked cars escalate to REROUTE only — never creep/escape
        if (e.mouthRaw && !e.pinnedRaw) e.stuckFor = Math.min(e.stuckFor, REROUTE_AFTER + 1);
        // a WEDGE (parked blocker, no cycle) can't creep through — escape
        // respects stationary bodies — so it retries the reroute PERIODICALLY:
        // the depot changes underneath it (the blocker gets dispatched, other
        // stalls free up) and a later attempt finds a way. Cycles keep escaping.
        if (!e.cycleWith && e.stuckFor >= ESCAPE_AFTER + REROUTE_AFTER) {
          e.stuckFor = REROUTE_AFTER;
          e.rerouted = false;
        }
      } else if (e.freeRaw) {
        e.stuckFor = 0;
        e.rerouted = false;
      }
    }
    for (const id of remove) {
      this.ledger.release(id);
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

// dev-only debug handle: HMR can leave module duplicates, so console/tooling
// probes must reach the instance the APP is actually driving.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__twinDriver = twinMotionDriver;
}
