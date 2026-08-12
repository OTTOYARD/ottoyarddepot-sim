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
import { ArmGate, type ArmStallInput } from "./motion/armGate";
import { poseStore } from "./motion/poseStore";
import { useDepotStore, type StallStatus } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { useSimulationStore } from "@/store/simulationStore";
import type { Vehicle, VehicleStatus } from "@/engine/types";
import type { TwinSnapshot, TwinLeg } from "@/lib/ottoTwin";
import {
  INGRESS, EGRESS, gapLaneX, SOUTH_LANE_Y, REAR_LANE_Y, PARK_RUNS, TEMP_LANE_X,
  WEST_AISLE_X, EAST_AISLE_X, NORTH_LANE_Y, N1_LANE_Y, QUEUE_Y,
} from "@/lib/sitePlan";
import { DISCONNECT_SECONDS, applyArmTimings, type ArmPhase } from "@/lib/ottoChargeArm/armStateMachine";

type Lane = "dcfc" | "l2" | "wash" | "service" | "staging";

const NORTH = -Math.PI / 2; // facing north (−y) in the y-down logical frame

// ── DEPOT WALL CLOCK ────────────────────────────────────────────────────────
// The renderer's clock (useSimulationStore.simTime) is SECONDS SINCE LOCAL
// MIDNIGHT; the twin's sim_clock is an ISO instant. Everything that compares
// the two — the OTTO-CHARGE ARM's `simTime - serviceStartTime`, the tooltip's
// time-remaining — is garbage unless BOTH sides are converted with the same
// offset, so the conversion lives here, once.
const DEPOT_TZ = "America/Chicago";
const DEPOT_TZ_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: DEPOT_TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
/** Depot-local offset from UTC, in ms, at instant `atMs`. Recomputed per
 *  snapshot rather than per frame: Intl formatting 60×/s is real cost and the
 *  offset only moves at a DST boundary. */
function depotOffsetMs(atMs: number): number {
  const p: Record<string, string> = {};
  for (const part of DEPOT_TZ_PARTS.formatToParts(new Date(atMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  if (!Number.isFinite(asUtc)) return 0;
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

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
// GATE QUEUE GEOMETRY. A rendered car body is 10.2 units long (VehicleDot draws
// 4.2 x 10.2), so both of these must clear a full car length or arrivals
// materialize INTERPENETRATING nose-to-tail on the approach road — which is what
// the busy_day fixture replay showed: queue pairs 7.2–8.0u apart, bodies exactly
// parallel (|cos| = 1.00), overlapping by ~2u each. They were 6 and 8.
const SPAWN_CLEARANCE = 11;   // don't materialize a car onto another one
const SPAWN_PITCH = 11;       // one car length + ~0.8u of visible gap
// …AND THE QUEUE MUST STAY INSIDE THE INGRESS GATE'S CATCHMENT.
// LaneGraph.route() takes the NEAREST lane node as a car's origin, and on the
// approach road (y = 213) the ingress stub (200, 210) stops being nearest past
//   (x-200)² + 3² = (275-x)² + 41²   →   x = 247.1
// where the SE ring corner (275, 172) takes over. A car spawned east of that
// routes AROUND the outside of the ring instead of in through the gate; because
// its first route segment then points ~180° behind it, it starts a back-out it
// can never finish while boxed in by the queue, and it sits frozen at the gate
// holding a stall claim for a stall 120u away. Widening the pitch alone pushed
// the tail of the queue to x = 290 and produced exactly that.
const QUEUE_MAX_X = 244;      // last slot: 200 + 6 + 3*11 = 239, comfortably inside
/** run statuses that still own the depot. Must match isLiveRunStatus in
 *  OperatorConsole / useTwinFeed — `paused` is LIVE, so a pause holds the scene
 *  and only a terminal status (completed / aborted) clears it. */
const LIVE_RUN_STATUSES = new Set(["running", "active", "paused"]);

// SMOOTHNESS: a rail car's pose heading is the segment TANGENT. RailFlow's
// roundCorners() now replaces each routed vertex with a real turn arc, so the
// tangent is continuous through a corner — but a re-rail mid-taxi, a spawn, and
// the charger sidestep can still hand the body a large step change.
// Applied straight to the body that reads as a single-frame heading SNAP of up to
// ~110°. Instead we ease the rendered heading toward the tangent at a bounded
// angular rate so a corner sweeps as a quick believable turn. This is PURELY
// cosmetic: the car's x/y still track the rail exactly and following/no-overlap
// are position-based (RailFlow), so lane discipline and the no-gridlock
// guarantees are untouched.
const MAX_TURN_RATE = 3.0; // rad/s — a 90° corner sweeps in ~0.5s
// A CAR ONLY TURNS BECAUSE IT IS MOVING. The rate limiter above was per-SECOND
// only, so a car that had stopped — at an intersection stop bar, in a queue,
// parked on its stall — went on rotating about its own centre at the full
// 3 rad/s (172°/s) until its heading caught the target. Nothing about that is a
// car: it is the body swinging while the wheels stand still, which is exactly
// the founder's "the rear bumper turns or slides diagonally at the intersection".
// Measured on the busy_day fixture, replayed against origin/main @ 22ec3f6 and
// against this tree with the same probe (1,158,074 car-steps either way):
//
//     main @ 22ec3f6   234 spin steps, 211 of them at the full 3.0 rad/s cap
//                      (peak yaw rate exactly 3.0000 rad/s)
//     this tree        0
//
// A "spin step" is one motion step in which a body's heading changed while it
// translated less than 0.001u. The 23 that are not at the cap are the last step
// of each swing, where the ease clamps to the remaining angle instead.
//
// So yaw is budgeted per unit of TRAVEL as well as per second: a stopped car
// gets a budget of exactly zero. YAW_PER_UNIT is a rate limiter, not a bicycle
// model — 2.5 rad/u lets the heading track every corner the rails actually
// contain, while the speed term binds below ~1.2 u/s, where the whip was
// visible.
//
// DRAWN CURVATURE — peak |Δheading| per unit translated, per car-step, same
// busy_day replay, reported at several minimum-displacement floors because the
// statistic is meaningless without one (a near-zero denominator sends the ratio
// anywhere). Floors in units of travel:
//
//                       0u       0.001u    0.01u     0.05u     0.1u
//     main @ 22ec3f6    22.6339  22.6339   13.3333    2.8949   1.4867
//     this tree          2.5000   2.5000    2.5000    2.5000   1.4973
//
// Read the ROW, not one cell. On main the peak collapses 22.63 → 2.89 as the
// floor rises, which is the spin defect showing up as division by an almost
// stationary car — the same 234 steps counted above, not a real corner. After
// the change the cap binds flat at 2.5000 across every floor, so the number is
// a property of the limiter rather than of the sampling. That flatness is the
// evidence; a single headline figure here is not, and an earlier version of
// this comment claimed "was 7.44", which reproduces under no floor tried.
//
// Making it the
// car's true minimum-radius curvature instead (tan(maxSteer)/wheelbase ≈ 0.091)
// was measured and is NOT shippable against these rails: the routed corners are
// far tighter than 11u, so the heading fell behind and crab rose from 1831 to
// 9863 bad steps. That needs tangent-continuous route geometry, not a tighter cap.
const YAW_PER_UNIT = 2.5; // rad of yaw per unit travelled
/** Arc length over which a docking car swings from the rail tangent to the
 *  parked heading. 10u makes a 90° charger dock a 0.157 rad/u swing. */
const DOCK_BLEND = 10;
function easeHeading(current: number, target: number, dt: number, speed: number): number {
  const d = wrapAngle(target - current);
  const maxStep = Math.min(MAX_TURN_RATE, Math.abs(speed) * YAW_PER_UNIT) * dt;
  if (d > maxStep) return wrapAngle(current + maxStep);
  if (d < -maxStep) return wrapAngle(current - maxStep);
  return target;
}

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
    // INTERRUPTED WORKFLOW (parking doctrine case 3): an out-of-service vehicle
    // inside the depot parks VISIBLY with maintenance status — the one case that
    // wants stationary parking. Previously fell through to the off-map default
    // and the car vanished frame-to-frame mid-depot.
    case "out_of_service": return { lane: "staging", vstatus: "maintenance", sstatus: "occupied" };
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
    // WITHDRAWN, BUT STILL HERE. `out_of_service` and `tow_requested` mean the
    // vehicle is physically in the depot and NOT assignable — not that it
    // left. Falling through to the default treated them as a departure: the
    // car drove to the egress and despawned, and any open OTTO-Q command was
    // closed with the false reason "vehicle left the depot before reaching the
    // commanded stall". It never left; it was withdrawn.
    //
    // Freeze it in place holding its stall, which is what an unassignable
    // vehicle actually does to depot capacity.
    case "out_of_service":
    case "tow_requested":
      return { lane: "staging", vstatus: "maintenance", sstatus: "occupied" };
    default: return null; // deployed / en_route / offline → off-map (departure)
  }
}

// depot center (LOT {x:6,y:6,w:288,h:200}) — perimeter cars nose OUTWARD from it
const DEPOT_CX = 150;
const DEPOT_CY = 106;

/** Is this staging stall under a PERIMETER CARPORT (the W/E/S runs)?
 *
 *  Tested against the SAME PARK_RUNS carport rectangles the stalls are generated
 *  from, not an id range: STAGE-01..82 happens to be the carports today and stops
 *  being true the moment the staging count changes. The NE block (N1 row, TW/TE
 *  columns) has no carport rect and is therefore open intake staging. */
function isCarportStall(x: number, y: number): boolean {
  for (const r of PARK_RUNS) {
    const c = r.carport;
    if (!c) continue;
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return true;
  }
  return false;
}

/** Renderer stall TYPE → motion lane.
 *
 *  A Record lookup, never `as Lane`. An unknown stall type must be unable to
 *  reach a cast — this codebase has twice been taken down by an unmapped enum
 *  value sailing through a seam — so it yields undefined and the caller falls
 *  back to intake staging, which is the safe side. */
const STALL_TYPE_LANE: Record<string, Lane | undefined> = {
  dcfc: "dcfc", l2: "l2", wash: "wash", service: "service", staging: "staging",
};

// lanes where a car parks to be SERVICED (must be seen docked before moving on)
const SERVICE_LANES = new Set<Lane>(["dcfc", "l2", "wash", "service"]);
const isServiceLane = (l: Lane | "gate" | null): boolean =>
  l != null && SERVICE_LANES.has(l as Lane);

// The drive corridors a parked car is SERVED from, in render units: north-south
// avenues by x, east-west lanes by y. Imported from sitePlan rather than retyped, so
// moving an aisle moves the parked headings with it.
const AISLE_X = [WEST_AISLE_X, TEMP_LANE_X, EAST_AISLE_X];
const LANE_Y = [REAR_LANE_Y, N1_LANE_Y, NORTH_LANE_Y, SOUTH_LANE_Y, QUEUE_Y];

/** How far BEHIND the parked nose the pull-in approach point sits, in render units
 *  (~one design vehicle). Exported so the geometry test measures the real offset
 *  rather than a copy of it. */
export const APPROACH_BACK_U = 9;

/** The corridor nearest `v`, or null when none is usable — an empty candidate list,
 *  a non-finite coordinate, or a corridor lying exactly ON the stall (no side to be
 *  on). Null means "not established", and the caller falls back rather than guessing
 *  a side from a degenerate number. */
function nearestCorridor(v: number, candidates: number[]): number | null {
  if (!Number.isFinite(v)) return null;
  let best: number | null = null;
  let bd = Infinity;
  for (const c of candidates) {
    if (!Number.isFinite(c)) continue;
    const d = Math.abs(v - c);
    if (d < bd) { bd = d; best = c; }
  }
  return best != null && bd > 1e-6 ? best : null;
}

/** Parked heading for a stall. Chargers/bays face NORTH (toward the bays).
 *  A staging car noses AWAY from the aisle that serves it, so the pull-in approach
 *  point (APPROACH_BACK_U behind the nose, see routeToStall) is staged on the AISLE SIDE of
 *  the stall rather than the wrong side of the column.
 *
 *  MEASURED, and stated exactly rather than rounded up: this fixed the SIDE for every
 *  staging stall — approaches from the wrong side of the serving aisle went 12/113 → 0/113.
 *  It does NOT put every approach point inside a painted lane body: 67 of 113 land inside
 *  one, and all 24 W-column points sit just outside theirs. That is a setback question for
 *  the perimeter carports, not a side question, and it is not what this change claims.
 *
 *  WHY THIS IS DERIVED FROM THE AISLE AND NOT THE DEPOT CENTRE. This used to read
 *  `sx < DEPOT_CX ? PI : 0` — face away from the middle of the lot. That is right for
 *  the four PERIMETER runs, where "away from the centre" and "away from the aisle"
 *  are the same direction, and WRONG for an interior block. Measured on the 158-stall
 *  replan: the TW column sits at x=233.5, east of the lot centre (150), so the centroid
 *  rule pointed it EAST — but TW is the WEST column of the temp block and its aisle is
 *  TEMP_LANE_X=247, on its EAST. All 12 TW stalls were therefore approached from
 *  x=224.5, the back side, 9u FARTHER from their aisle instead of 9u nearer; the other
 *  101 staging stalls measured -9.00u (correct) and TW measured +9.00u.
 *
 *  Deriving the side from the nearest corridor makes the rule local, so a column added
 *  or moved inside the lot is served correctly without anyone re-deriving a centroid.
 *  The centroid test is kept as the FALLBACK for the case where no corridor can be
 *  established, so this stays a total function. */
export function parkedHeading(lane: Lane, angleDeg: number, sx: number, sy: number): number {
  if (lane === "dcfc" || lane === "l2" || lane === "wash" || lane === "service") return NORTH;
  const vertical = angleDeg === 90 || angleDeg === 270; // east-west oriented column
  if (vertical) {
    const aisle = nearestCorridor(sx, AISLE_X);
    if (aisle == null) return sx < DEPOT_CX ? Math.PI : 0; // fallback: lot centre
    return sx < aisle ? Math.PI : 0;                       // aisle east→face W, west→face E
  }
  const row = nearestCorridor(sy, LANE_Y);
  if (row == null) return sy < DEPOT_CY ? NORTH : Math.PI / 2; // fallback: lot centre
  return sy < row ? NORTH : Math.PI / 2;                       // lane south→face N, north→face S
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

/** A dwell leg's service window, parsed once per snapshot.
 *  `stall` is the RENDERER stall id the dwell happens at, or null when the leg
 *  named no stall the layout can resolve (which is not the same as "any stall"
 *  — see serviceWindow()). */
interface DwellWindow {
  startMs: number;
  durationS: number;
  stall: string | null;
  seq: number;
}

/** An OTTO-Q stall assignment the driver has accepted and is now honouring. */
interface CommandedStall {
  command_id: string;
  /** RENDERER stall id (already translated from the twin uuid at accept time) */
  renderStallId: string;
  /** sim instant by which the vehicle should have arrived; null = no deadline */
  notAfterSim: string | null;
  /** wall clock when the command was accepted — the basis for arrival deviation */
  acceptedAtMs: number;
  /** true once the vehicle has physically docked at the commanded stall */
  arrived: boolean;
  /** set when the twin's state put the vehicle in a lane this stall is not in */
  laneMismatch: string | null;
}

/** What the driver reports back up the wire once a command resolves. */
export interface MotionOutcome {
  command_id: string;
  vehicle_id: string;
  status: "completed" | "rejected";
  /** seconds between accepting the command and physically docking */
  transit_s: number;
  reason: string | null;
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
  /** Renderer stall ids whose OTTO-CHARGE ARM is still mated, per the latest snapshot. */
  private twinTethered = new Set<string>();
  /** Seconds of demate still owed per renderer stall id, measured at snapshot time.
   *  Resolved HERE, against the snapshot's own sim clock, so no consumer has to convert
   *  a backend sim timestamp into the renderer's seconds-of-day frame — mixing those two
   *  domains is a bug this codebase has paid for repeatedly. */
  private twinTetherLeftS = new Map<string, number>();
  /** THE DEPART GATE. One arm session per DCFC stall, stepped against the sim
   *  clock in tickMotion; a car may not begin to move out of a stall whose arm
   *  is not in a movement-permitted phase. See motion/armGate.ts. */
  private armGate = new ArmGate();
  /** sim-clock instant (ms) at which the arm sessions were last stepped. The arms
   *  are paced by the SIM clock, not by the motion dt — same choice ChargingArm
   *  makes, and the reason a 3x view multiplier does not run the robot at 3x. */
  private armSimMs: number | null = null;
  /** Renderer stall ids → stall type, refreshed each reconcile. The gate needs the
   *  TYPE (only dcfc carries an arm) every motion tick, and tickMotion must not be
   *  re-scanning the depot store's 158 stalls to find it. */
  private stallTypes = new Map<string, string>();
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
  /** was the last-seen run live? A run that STOPS keeps the same sim_run_id, so
   *  the run-switch check below never fires and the scene kept drawing the last
   *  known car positions forever — which read as "Stop doesn't clear the depot".
   *  The backend does empty the depot on stop; only the renderer lagged.
   *  Tracked as live-vs-terminal, NOT as `=== "running"`: `paused` is a LIVE
   *  status (see isLiveRunStatus / useTwinFeed) and pausing must hold the scene
   *  exactly where it is, never clear it. */
  private lastRunLive: boolean | null = null;
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
  // ── OTTO-Q ORCHESTRATION INBOX ────────────────────────────────────────────
  // OTTO-Q says WHICH STALL and BY WHEN. Everything else — the route, the
  // speed, the spacing, the parked heading — stays here, in the motion stack,
  // exactly as an AV's own autonomy would own it. The orchestrator never
  // touches a pose.
  //
  // The twin's own state machine still decides WHAT SERVICE a vehicle needs
  // (charging vs washing vs staging). A command names a stall INSIDE that
  // decision. If OTTO-Q names a stall in a lane the twin's state does not
  // support, the command is not forced — the mismatch is recorded and the
  // vehicle follows the twin. Fighting the backend would produce exactly the
  // two-systems-one-vehicle problem the single funnel exists to prevent.
  private commanded = new Map<string, CommandedStall>();
  /** arrival reports waiting to be drained by the command bus */
  private motionOutcomes: MotionOutcome[] = [];

  // ── OTTO-Q command subscriber ─────────────────────────────────────────────

  /**
   * Accept (or decline) an `assign_stall` directive.
   *
   * Returns `true` on acceptance, or a REASON STRING on refusal. Refusing is a
   * first-class outcome, not a failure: the motion system is the authority on
   * what it can physically do, and a real fleet API refuses the same way. Every
   * refusal names the thing that is missing so the operator is never left
   * guessing why a car did not move.
   *
   * Deliberately does NOT route the car here. Routing happens in `reconcile`
   * against the next world frame, so a command and a snapshot can never race to
   * assign the same vehicle two different rails.
   */
  acceptStallCommand(input: {
    command_id: string;
    vehicle_id: string;
    /** TWIN stall uuid — translated to a renderer stall id here */
    twin_stall_id: string | null | undefined;
    not_after_sim: string | null;
  }): true | string {
    const { command_id, vehicle_id, twin_stall_id, not_after_sim } = input;

    if (!twin_stall_id) return "command carries no stall id";
    if (!this.entries.has(vehicle_id)) {
      return "vehicle is not present in the rendered scene — nothing to move";
    }
    if (this.twinStall.size === 0) {
      return "depot layout has not loaded — stall ids cannot be resolved yet";
    }
    const renderStallId = this.twinStall.get(twin_stall_id);
    if (!renderStallId) {
      return `stall ${twin_stall_id} does not map to a rendered stall — the scene draws fewer stalls than the twin defines`;
    }

    // The ledger is the one-car-per-stall authority. If another vehicle already
    // holds this stall, accepting would let the renderer park two cars in one
    // place — refuse rather than produce a scene that lies.
    const holder = this.ledger.holderOf(renderStallId);
    if (holder && holder !== vehicle_id) {
      return `stall ${renderStallId} is already held by ${holder}`;
    }

    // Re-issue of a command already being honoured: accept idempotently.
    const existing = this.commanded.get(vehicle_id);
    if (existing && existing.command_id === command_id) return true;

    // A NEW command for a vehicle that already had one supersedes it. The old
    // one is reported so the bus can close its record instead of leaking it.
    if (existing && !existing.arrived) {
      this.motionOutcomes.push({
        command_id: existing.command_id,
        vehicle_id,
        status: "rejected",
        transit_s: (performance.now() - existing.acceptedAtMs) / 1000,
        reason: `superseded by ${command_id} before the vehicle arrived`,
      });
    }

    this.commanded.set(vehicle_id, {
      command_id,
      renderStallId,
      notAfterSim: not_after_sim,
      acceptedAtMs: performance.now(),
      arrived: false,
      laneMismatch: null,
    });
    return true;
  }

  /**
   * Hand back every command that has resolved since the last call, and clear
   * them. The bus turns these into terminal ledger entries.
   */
  drainMotionOutcomes(): MotionOutcome[] {
    const out = this.motionOutcomes;
    this.motionOutcomes = [];
    return out;
  }

  /** Which stall a vehicle currently holds, if any. */
  /**
   * Is the OTTO-CHARGE ARM still mated to whatever is in this stall?
   *
   * This is OTTO-Q's answer, not the renderer's animation clock. The arm component
   * runs its own local cycle off serviceStartTime/serviceDuration; that clock can
   * finish while the backend is still holding the car, and a car shown driving out of
   * a stall the orchestrator has locked is exactly the lie this flag exists to stop.
   * Unknown stall ids answer false — same fail-safe direction as vehicleMayMove.
   */
  isStallTethered(rendererStallId: string): boolean {
    return this.twinTethered.has(rendererStallId);
  }

  /**
   * Seconds of demate still owed on this stall as of the last snapshot, or null when
   * the arm is not mated. Lets the arm animate unlatch → extract → retract against
   * OTTO-Q's real deadline instead of a free-running local clock.
   */
  stallTetherRemainingS(rendererStallId: string): number | null {
    if (!this.twinTethered.has(rendererStallId)) return null;
    return this.twinTetherLeftS.get(rendererStallId) ?? DISCONNECT_SECONDS;
  }

  stallHeldBy(vehicleId: string): string | undefined {
    return this.ledger.stallOf(vehicleId);
  }

  // ── THE DEPART GATE ────────────────────────────────────────────────────────
  //
  // Founder, on the OTTO-CHARGE ARM: "stay connected the entire time until the
  // car is at desired SoC and then the arm gets ready to disconnect and retract
  // back … and THEN the vehicle can move."
  //
  // The last clause is this. `vehicleMayMove` has always been the definition of
  // it and nothing in the motion path called it, so a car could pull out of a
  // DCFC stall with the connector still in its port.
  //
  // THERE ARE FIVE DOORS OUT OF A PARKED STALL, and all five ask armReleases()
  // first. They carry a `DEPART GATE (n of 5)` marker each, numbered in file
  // order: the motion-residue re-rail, a lane re-assignment, the departure
  // launch, the TTL forced launch, and the departure queue's drain.
  //
  // FIVE IS A SWEEP, NOT A TALLY OF THE OBVIOUS ONES — an earlier revision of
  // this comment said "three", and the residue re-rail was in fact ungated
  // behind it: a car with 3.0u of position residue on a stall whose arm was
  // still at phase 'charging' was re-railed and drove away with the connector
  // in (measured at 104.88u from its stall; see the gate-1 site for the probe).
  // The sweep: motion begins ONLY by setting `e.tracker` or `e.reverse` on an
  // entry that has neither, and the only function that does that from rest is
  // assignRail(). Its five call sites are startDeparture() — itself reached
  // only from the departure launch, the TTL forced launch and the queue drain,
  // all gated — plus the residue re-rail (gated here), the overflow staging
  // pull-out, the first-sighting drive-in, and the new-stall re-assignment.
  // Those last three are UNREACHABLE for a docked car with an arm on it: the
  // overflow and re-assignment paths both need `lane !== e.lane`, which door 2
  // refuses before either can run, and the drive-in path only fires for an id
  // with no existing entry, so there is no parked body for it to tear away.
  // The two remaining rebuildRail() sites — the reverse cusp and the 45 s
  // stationary watchdog — both require a tracker or a reverse to already exist,
  // so neither is a door out of rest.
  //
  // Deliberately NOT a hold on the ORCHESTRATOR's decision. OTTO-Q may re-task a
  // car whenever it likes; what is gated is the MOTION. That ordering is what
  // makes the gate terminate: the re-task is published (the roster status flips
  // to the twin's new truth), the flip is what tells the arm the session is over,
  // the arm demates, and only then does the car roll. Withholding the decision
  // instead would keep the arm latched forever waiting for a release that the
  // hold itself was suppressing.

  /**
   * May this car physically begin to move?
   *
   * TOTAL and fail-SAFE-open, in the sense the brief requires: a car that is not
   * in a DCFC stall, a stall no arm serves, a stall the gate has never seen, or a
   * car that is already rolling, is NOT held. Only a car sitting in an
   * arm-served stall whose arm is mid-cycle is. An L2 or staging car is
   * completely unaffected, and no absent signal can freeze anything.
   */
  private armReleases(e: Entry): boolean {
    if (e.lane !== "dcfc" || !e.stallId) return true;
    if (this.armGate.mayMove(e.stallId)) return true;
    this.armRefusals++;
    return false;
  }

  /** Stalls whose arm is currently holding its car — for the operator trace. */
  get armHolds(): string[] {
    return this.armGate.holding();
  }

  /**
   * How many times the depart gate has refused to start a car moving.
   *
   * Kept because it is the ONLY evidence the gate is doing anything at all. A
   * guard that is silently inert looks exactly like a guard that is working, and
   * this codebase has already shipped one of those (a cron reporting success
   * while every decision aborted). A zero here on a run with cars leaving
   * chargers means the gate is not engaging and something upstream — a missing
   * dwell window, an arm that never mated — should be looked at.
   */
  get armHoldRefusals(): number {
    return this.armRefusals;
  }
  private armRefusals = 0;

  /** What the arm on this stall is doing, or null when no arm session covers it.
   *  Null is an ANSWER — "this driver is not tracking an arm here" — and callers
   *  must read it that way rather than as a phase. */
  armPhaseAt(rendererStallId: string): ArmPhase | null {
    return this.armGate.phase(rendererStallId);
  }

  /** How long this stall has been continuously refusing to release its car, in
   *  SIM seconds; 0 when it is not holding. Only the TRANSIENT phases run this
   *  clock — a 'charging' hold reads 0 however long the charge lasts, because
   *  that hold ends on a state and never on a duration (armGate's HOLD_CAP_S).
   *  Distinguishes "the arm finished" from "the cap fired", which look identical
   *  from armHolds alone. */
  armHeldForS(rendererStallId: string): number {
    return this.armGate.heldFor(rendererStallId);
  }

  /**
   * Advance every arm session by the SIM-clock delta since the last motion tick.
   *
   * Paced by simNow(), not by the motion dt: PHASE_SECONDS are real robot seconds
   * and a sim second IS a second of depot world time, so an 18.5 s mate plays in
   * 18.5 sim seconds whatever the view multiplier is doing. This is the same
   * clock ChargingArm reads through simClockTod(), which is what keeps the two
   * evaluations of the cycle in step.
   *
   * Before any snapshot has anchored the clock there is no sim time to step, so
   * every session simply holds — and a session that never advances never claims
   * an arm is engaged, because IDLE_SESSION is 'stowed'.
   */
  private stepArms() {
    const nowMs = this.simNow();
    let simDt = 0;
    if (nowMs) {
      if (this.armSimMs !== null) simDt = (nowMs - this.armSimMs) / 1000;
      this.armSimMs = nowMs;
    }
    // Feed EVERY dcfc stall the driver currently has a car in. A stall whose car
    // has gone (deployed off-map, despawned) drops out of this list, the gate
    // forgets it, and it stops holding anything — the arm has no car to be
    // attached to.
    const inputs: ArmStallInput[] = [];
    for (const [id, e] of this.entries) {
      if (!e.stallId || e.lane !== "dcfc") continue;
      inputs.push({
        stallId: e.stallId,
        stallType: this.stallTypes.get(e.stallId),
        vehicleId: id,
        // EXACTLY what ChargingArm reads off the roster for this car — the roster
        // is the shared fact that starts and ends both evaluations of the cycle.
        chargingState: e.vstatus === "charging",
        parked: this.serviceWindow(e) !== null,
        tetherRemainingS: this.stallTetherRemainingS(e.stallId),
      });
    }
    this.armGate.step(simDt, inputs);
  }

  /** Live view of what OTTO-Q has asked for — for the operator's decision trace. */
  get commandedAssignments(): { vehicle_id: string; stall_id: string; arrived: boolean }[] {
    return [...this.commanded.entries()].map(([vehicle_id, c]) => ({
      vehicle_id, stall_id: c.renderStallId, arrived: c.arrived,
    }));
  }

  /** Drop every outstanding assignment — called when the run changes. */
  private clearCommands() {
    this.commanded.clear();
    this.motionOutcomes = [];
  }

  /** Freeze/unfreeze on-screen motion. Dropping `last` on resume means the first
   *  frame back re-seeds the clock instead of applying one giant catch-up dt —
   *  without it the whole depot would lurch forward by the length of the pause. */
  setPaused(v: boolean) {
    if (this.paused === v) return;
    this.paused = v;
    if (!v) this.last = null;
  }

  /** On-screen speed multiplier, mirrored from the backend playback contract
   *  (snapshot.run.speed_x). 1 = true 1:1 — a car crosses the yard at 8.6 mph, a
   *  charge session takes as long as a charge session. Hard-capped at 3: past that
   *  the depot stops being motion-faithful and OTTO-Q cannot keep up with decisions,
   *  which is what JUMP is for. */
  private viewMult = 1;
  setViewMult(v: number) {
    const next = Math.max(1, Math.min(3, Number.isFinite(v) ? v : 1));
    if (this.viewMult === next) return;
    this.viewMult = next;
    this.last = null; // re-seed so the change never applies one giant catch-up dt
  }

  // ─── T4 RENDER CONTRACT: OTTO-Q's timed legs pace the motion ────────────────
  /** Active TRAVEL legs from the last snapshot, keyed by vehicle id. */
  private legs = new Map<string, TwinLeg>();
  /** DWELL (non-travel) legs from the last snapshot, keyed by vehicle id, with
   *  their windows already parsed to numbers.
   *
   *  A dwell leg is what HAPPENS at a stall — charge, wash, service — and it is
   *  the ONLY place the wire carries a service window. Every one of them used to
   *  be discarded ("if (l.kind !== 'travel') continue"), so flush() had nothing
   *  to publish and hardcoded serviceStartTime/serviceDuration to null. That is
   *  precisely why the OTTO-CHARGE ARMS never moved: ChargingArm's frame loop
   *  requires both fields before it will call phaseAt(), so the phase stayed at
   *  its 'stowed' initialiser for the whole run. The arms were mounted on the
   *  right stalls and matched to the right cars — they simply had no clock. */
  private dwells = new Map<string, DwellWindow[]>();
  /** Depot-local UTC offset for the current snapshot's sim clock. */
  private tzOffsetMs = 0;
  /** Last whole second pushed into the React store — see publishSimClock(). */
  private lastPublishedTod = -1;
  /** Sim clock (ms) carried by the last snapshot, and the performance.now() at
   *  which it arrived. simNow() extrapolates between snapshots off the WALL clock,
   *  so motion keeps running — correctly — when the feed stalls or is unplugged.
   *  That is the whole point: the poll becomes a correction channel, not the driver. */
  private simAnchorClock = 0;
  private simAnchorAt = 0;
  private simSpeedX = 1;

  /** #173 (D) — CONTRACT COVERAGE. Only the renderer knows how many cars are
   *  physically taxiing, so only it can close this ratio. `paced` counts cars whose
   *  motion is actually governed by an OTTO-Q leg; `taxiing` counts every car in
   *  motion. Anything in the gap is the renderer moving a car the contract never
   *  described — the exact thing T3/T4 exist to eliminate. It measured 0/22 when
   *  first surfaced; without this number that was invisible. */
  coverage(): { taxiing: number; paced: number; ratio: number; legs: number } {
    let taxiing = 0, paced = 0;
    for (const e of this.entries.values()) {
      if (!e.tracker) continue;
      taxiing++;
      if (e.tracker.vCap != null || this.legs.has(e.id)) paced++;
    }
    return { taxiing, paced, ratio: taxiing ? paced / taxiing : 1, legs: this.legs.size };
  }

  /** Current sim time in ms, extrapolated from the last snapshot. */
  private simNow(): number {
    if (!this.simAnchorClock) return 0;
    return this.simAnchorClock + (performance.now() - this.simAnchorAt) * this.simSpeedX;
  }

  /**
   * The live depot clock in SECONDS SINCE LOCAL MIDNIGHT, or null when no
   * snapshot has anchored it yet.
   *
   * This is the imperative channel — same pattern as poseStore. Consumers that
   * need per-frame resolution (the OTTO-CHARGE ARM) read it here and get a
   * fresh value every frame with no React work; publishSimClock() separately
   * pushes a 1 Hz copy into the store for the HH:MM readout and the day/night
   * lighting, which do not need 60 updates a second.
   */
  simClockTod(): number | null {
    const ms = this.simNow();
    if (!ms) return null;
    return this.toTod(ms);
  }

  /** epoch ms → seconds since depot-local midnight. */
  private toTod(ms: number): number {
    const day = 86400_000;
    return ((((ms + this.tzOffsetMs) % day) + day) % day) / 1000;
  }

  /**
   * Push the live clock into the React store, at most once per whole second.
   *
   * The clock has to reach the store or the BottomBar readout, the day/night
   * lighting and the tooltip's time-remaining all keep reading the frozen 50400
   * default. It must NOT reach it every frame: DepotScene3D subscribes to
   * simTime, so a 60 Hz write would re-render the whole 3D tree continuously.
   * One write per sim-second is plenty for an HH:MM display, and the arm never
   * reads the store at all (see simClockTod).
   */
  private publishSimClock() {
    const tod = this.simClockTod();
    if (tod === null) return;
    const whole = Math.floor(tod);
    if (whole === this.lastPublishedTod) return;
    this.lastPublishedTod = whole;
    useSimulationStore.getState().setLiveSimTime(whole);
  }

  /** Parse a dwell leg's window once, at snapshot time. Returns null when the
   *  leg carries no usable window — an unstamped or zero-length dwell is an
   *  ABSENCE, and the renderer publishes absence rather than a plausible guess. */
  private parseDwell(l: TwinLeg): DwellWindow | null {
    const startMs = Date.parse(String(l.start_sim ?? ""));
    if (!Number.isFinite(startMs)) return null;
    const endMs = Date.parse(String(l.end_sim ?? ""));
    const fromField = Number(l.duration_s);
    const durationS = Number.isFinite(fromField) && fromField > 0
      ? fromField
      : Number.isFinite(endMs) ? (endMs - startMs) / 1000 : NaN;
    if (!Number.isFinite(durationS) || durationS <= 0) return null;
    // A dwell happens AT a stall; to_stall is where the car ends up, from_stall
    // is the fallback for backends that stamp only the origin. Either way the
    // twin uuid is translated here so no consumer has to know about the mapping.
    const stall =
      (l.to_stall ? this.twinStall.get(l.to_stall) : undefined) ??
      (l.from_stall ? this.twinStall.get(l.from_stall) : undefined) ??
      null;
    return { startMs, durationS, stall, seq: Number(l.seq ?? 0) };
  }

  /**
   * The service window to publish for a DOCKED car, in the renderer's
   * seconds-of-day frame — or null when OTTO-Q sent none.
   *
   * TWO deliberate decisions:
   *
   *  • Only a car that is PHYSICALLY PARKED gets a window. The backend opens a
   *    charge session on its own tick, which can be well before the renderer has
   *    finished driving the car in (commit-and-hold). An arm that mates into an
   *    empty stall is exactly the invented picture this renderer must not draw,
   *    so the cycle is anchored to the dock instant when the backend's start is
   *    already in the past. The DURATION stays OTTO-Q's; only the start is
   *    clamped forward, and "when the car physically arrived" is the one fact
   *    the motion layer owns.
   *
   *  • UNITS. PHASE_SECONDS in armStateMachine are REAL robot seconds, and this
   *    window is in SIM seconds — the same domain, because a sim second IS a
   *    second of depot world time. At 3x an 18.5 s mate plays in ~6 wall
   *    seconds, in step with the car that just parked. Feeding the arm WALL
   *    seconds instead would mate it at playback speed while the depot moved at
   *    sim speed.
   *
   *    The arm is paced against simNow(), which is the same clock contractPace
   *    uses to hold the CARS to their leg deadlines — so above setViewMult's 3x
   *    motion ceiling (the continuous-play ceiling is now 8x, raised in 9449c2c)
   *    the arm and the cars fall behind the clock together, by the same factor.
   *    That divergence belongs to the motion multiplier, not to the arm, and
   *    giving the arm its own private rate would only hide it.
   */
  private serviceWindow(e: Entry): { start: number; duration: number } | null {
    if (!e.stallId || e.playback !== "docked" || e.dwellStartMs == null) return null;
    const list = this.dwells.get(e.id);
    if (!list?.length || this.simAnchorClock === 0) return null;
    const now = this.simNow();
    let best: DwellWindow | null = null;
    let bestRank = -1;
    for (const w of list) {
      // A leg that names a DIFFERENT stall is a different service step in the
      // visit, not this dock — never borrow its clock.
      if (w.stall && w.stall !== e.stallId) continue;
      // A window that actually contains the sim clock beats one that merely
      // names the right stall, which beats an unstalled leg.
      const rank = (now >= w.startMs && now < w.startMs + w.durationS * 1000 ? 4 : 0) +
                   (w.stall ? 2 : 0);
      if (rank > bestRank || (rank === bestRank && best !== null && w.seq > best.seq)) {
        best = w;
        bestRank = rank;
      }
    }
    if (!best) return null;
    // Anchor to the later of OTTO-Q's start and the moment the car actually
    // docked, both expressed as sim instants so the comparison is in one domain.
    const dockedAtSim = this.simAnchorClock + (e.dwellStartMs - this.simAnchorAt) * this.simSpeedX;
    return {
      start: this.toTod(Math.max(best.startMs, dockedAtSim)),
      duration: best.durationS,
    };
  }

  /** Speed ceiling (u/s) that lands this car at its leg's planned_end_sim.
   *  Returns undefined when there is no contract to honour, when the leg is already
   *  due (let it run flat out to catch up), or when the numbers are not finite —
   *  in every one of those cases the car falls back to pre-T4 behaviour. */
  private contractPace(id: string, rail: Rail): number | undefined {
    const leg = this.legs.get(id);
    if (!leg || this.simAnchorClock === 0) return undefined;
    const endMs = Date.parse(leg.end_sim);
    if (!Number.isFinite(endMs)) return undefined;
    const remainingSec = (endMs - this.simNow()) / 1000;
    if (!(remainingSec > 0.5)) return undefined;      // due or overdue → uncapped
    const remainingArc = Math.max(0, rail.total - rail.s);
    if (remainingArc <= 0.5) return undefined;
    const v = remainingArc / remainingSec;
    return Number.isFinite(v) && v > 0 ? v : undefined;
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
    this.clearCommands();
    poseStore.clear();
    this.lastRosterKey = "";
    this.primed = false;
    // Drop the twin→renderer stall mapping too. The bridge re-fetches the
    // layout on every re-entry (expectLayout → setTwinStallMap), so keeping the
    // old map only creates the chance of resolving a stall id against a layout
    // that is no longer on screen.
    this.twinStall.clear();
    this.layoutSettled = true;
    this.pendingSnap = null;
    this.runId = null;
    this.departQueue = [];
    this.locks = new RailLocks();
    this.legs.clear();
    this.dwells.clear();
    this.simAnchorClock = 0;
    this.lastPublishedTod = -1;
    // arms belong to the scene, not to the process: leaving twin mode must not
    // leave a stall holding a car that no longer exists.
    this.armGate.clear();
    this.armSimMs = null;
    this.armRefusals = 0;
    this.stallTypes.clear();
    // hand the depot clock back to manual control — leaving twin mode means no
    // backend owns it any more, and a slider left disabled would be a dead UI.
    useSimulationStore.getState().releaseLiveSimTime();
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
    this.clearCommands();
    poseStore.clear();
    this.lastRosterKey = "";
    this.primed = false;
    this.departQueue = [];
    this.locks = new RailLocks();
    // HAND THE CLOCK BACK. clear() already does this; resetScene did not, so a run that
    // ENDED left simClockLive true and simTime still advancing over a wiped depot
    // (measured: 43200 -> 43500 after a 'completed' snapshot). A clock running on an
    // empty scene is the same class of lie as a car drawn where none is — and it left
    // the manual scrub slider disabled while the depot kept getting later with nothing
    // in it. Re-anchoring below only happens for a LIVE run, so this is safe to do first.
    useSimulationStore.getState().releaseLiveSimTime();
    // T4: a run switch invalidates the contract — stale legs would otherwise pace
    // the NEW fleet against the OLD run's clock (ids never match, so a car would
    // be held to a deadline from a different world).
    this.legs.clear();
    this.dwells.clear();
    this.simAnchorClock = 0;
    this.lastPublishedTod = -1;
    // a run switch invalidates every arm session too — the stall ids survive but
    // the cars they were mated to do not.
    this.armGate.clear();
    this.armSimMs = null;
    // clearing driver state is not enough on its own: the painted fleet and the
    // stall colors live in the stores, and an EMPTY roster produces the same
    // fingerprint as the reset lastRosterKey, so the push below would be skipped
    // and last run's cars would stay on screen. Empty both explicitly.
    useVehicleStore.getState().setVehicles([]);
    const depot = useDepotStore.getState();
    for (const s of depot.stalls) if (s.status !== "available") depot.setStallStatus(s.id, "available");
  }

  /** Ingest the twin depot layout: map each twin stall uuid to the renderer's
   *  stall id by TYPE + the code's trailing number (e.g. twin 'NASH-L2-STALL-26'
   *  type 'l2' → renderer 'L2-26').
   *
   *  ⚠️ KNOWN DEFECT, pinned by a test and NOT fixed here. This block used to claim
   *  unmappable stalls "simply fall back to zone-based assignment". THEY DO NOT.
   *  The single-group branch preserves the trailing number across the retired 21..25
   *  gap, so twin L2-31..35 map to renderer ids L2-31..L2-35 that the scene never
   *  draws — and because the map holds a truthy string, the not-mapped refusal never
   *  fires. Five charging cars resolve to stalls that do not exist on screen.
   *  Left unfixed deliberately: the repair changes WHICH stall those five cars are
   *  drawn in, which moves ratcheted motion samples in another stream's work. It is
   *  pinned so it cannot be forgotten, not excused.
   *
   *  STALL-NAME COLLAPSE (fixed here). The old mapping kept ONLY the trailing
   *  digits — /(\d+)\s*$/ — which is fine for a type whose codes are one flat
   *  run, and catastrophic for one that is not. The twin's staging stalls are
   *  named per GROUP: NASH-STG-{B,E,I,N,S,W}001..019, six groups of nineteen.
   *  All six collapsed onto renderer STAGE-01..19 — a single 19-slot column in
   *  the WEST PERIMETER CARPORT — so ~100 distinct twin staging stalls resolved
   *  to 19 renderer stalls, and every staging vehicle in the run was aimed at
   *  the perimeter. The group letter is part of the stall's identity and has to
   *  survive the mapping. */
  setTwinStallMap(stalls: { id: string; code: string; type: string }[]) {
    const prefix: Record<string, string> = {
      dcfc: "DCFC", l2: "L2", wash_bay: "WASH", service_bay: "SVC", staging: "STAGE",
    };
    this.twinStall.clear();
    // split each code into its GROUP (everything up to the trailing number) and
    // its index, and bucket by renderer prefix
    const byPrefix = new Map<string, { id: string; group: string; n: number }[]>();
    for (const s of stalls) {
      const p = prefix[s.type];
      const m = /^(.*?)(\d+)\s*$/.exec(s.code ?? "");
      if (!p || !m) continue;
      const row = { id: s.id, group: m[1], n: parseInt(m[2], 10) };
      const list = byPrefix.get(p);
      if (list) list.push(row);
      else byPrefix.set(p, [row]);
    }
    for (const [p, list] of byPrefix) {
      const groups = new Set(list.map((r) => r.group));
      if (groups.size <= 1) {
        // ONE flat run (DCFC, L2, the bays, and any staging layout that does not
        // use group codes): keep the number-preserving map, so twin
        // 'NASH-DCFC-STALL-07' stays renderer 'DCFC-07' and a gap in the twin's
        // numbering does not silently renumber every stall after it.
        for (const r of list) this.twinStall.set(r.id, `${p}-${this.pad(r.n)}`);
        continue;
      }
      // MULTIPLE GROUPS: pack them into disjoint blocks — group order, then
      // index. The result is a stable RENAMING (a twin staging code carries no
      // renderer geometry, so there is nothing to preserve beyond identity) and
      // it is collision-free by construction, which is the one guarantee the
      // trailing-digits regex broke.
      const sorted = [...list].sort((a, b) =>
        a.group < b.group ? -1 : a.group > b.group ? 1 : a.n - b.n);
      let slot = 0;
      for (const r of sorted) this.twinStall.set(r.id, `${p}-${this.pad(++slot)}`);
    }
    this.settleLayout();
  }

  /** Renderer stall ids are zero-padded to two digits and run past 99 unpadded
   *  (STAGE-09 … STAGE-113) — mirrors sitePlan's own id generation. */
  private pad(n: number): string {
    return String(n).padStart(2, "0");
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
  private railTo(from: { x: number; y: number }, lane: Lane, stall: { x: number; y: number }, facing: number, lead: Pt[] = []): Rail {
    const pts = [...lead, ...this.routeToStall(from, lane, stall, facing)];
    // A TEMP-AISLE MOUTH LOCK WAS TRIED HERE AND IS DELIBERATELY ABSENT. TW and TE
    // face each other across a 15.5 u aisle while the design vehicle is 10.2 u long, so
    // a car squaring up to pull in necessarily lies across both lane bodies. Giving the
    // two columns a shared mouth key — the mechanism the charger columns use — changed
    // the fixture by NOTHING (116 pair-samples before and after), because the conflict
    // is not two cars staging at once: it is a staging car against THROUGH traffic
    // running up TEMP_LANE_X to the N1 row, which is not bound for a temp stall and so
    // would never hold the key. Shortening the approach does not help either (measured
    // at 9/8/7/6.5/6 u: 116/116/117/118/119). Closing it needs aisle occupancy, not a
    // terminal-stretch lock; that is named in the fixture's ratchet comment as the
    // remaining work rather than papered over with a constraint that measures zero.
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

  /** Rebuild the rail toward the entry's current destination. Normally routes
   *  from the car's ACTUAL pose; pass `lead` to prepend a short FORWARD stub and
   *  move the routing origin to its last point (the reverse-course fix: the car
   *  eases forward along the stub, then the graph route picks up ahead of it). */
  private rebuildRail(e: Entry, lead?: Pt[]): Rail | null {
    if (!e.dest) return null;
    const hasLead = !!lead && lead.length > 0;
    const origin = hasLead ? lead![lead!.length - 1] : e.car.pose;
    const pre = hasLead ? lead! : [];
    if (e.dest.kind === "egress") {
      const be = this.bayExit(origin);
      const route = this.graph.route(be?.start ?? origin, { x: EGRESS.x, y: EGRESS.y });
      const tail = be ? [...be.lead, ...route] : route;
      return buildRail([...pre, ...tail], this.graph.nodes.values(), null);
    }
    return this.railTo(origin, e.dest.lane, e.dest, e.dest.heading, pre);
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
    let rail = this.rebuildRail(e);
    if (!rail) return;
    // angle between the car's heading and the new route's first ~8u
    const probe = pointAt(rail.pts, rail.cum, Math.min(8, rail.total));
    const ang = wrapAngle(Math.atan2(probe.y - e.car.y, probe.x - e.car.x) - e.car.heading);
    if (wasParked) {
      // PARKED nose-in car: back out on a fixed arc before pulling away (unchanged).
      if (Math.abs(ang) > 1.75) {
        e.reverse = { remaining: 11, steer: -Math.sign(ang || 1) * 0.35 };
        e.tracker = null;
        return;
      }
    } else if (Math.abs(ang) > 1.75) {
      // MOVING re-rail (a mid-taxi reassignment): the new route's first segment
      // points >100° behind the car — following it verbatim drives the car
      // BACKWARD toward a graph node behind it (the reverse-course-mid-taxi bug).
      // Rebuild from a point one car-length AHEAD and PREPEND the car's real pose,
      // so the rail's first segment goes FORWARD; easeHeading then sweeps the turn.
      // Position starts exactly at the car (no teleport) and the car never reverses.
      const fwd = { x: e.car.x + Math.cos(e.car.heading) * 9, y: e.car.y + Math.sin(e.car.heading) * 9 };
      const forward = this.rebuildRail(e, [{ x: e.car.x, y: e.car.y }, fwd]);
      if (forward) rail = forward;
    }
    // seed the new rail's speed from the car's current speed so a MOVING car
    // re-railed mid-taxi (a lane change) eases on instead of braking to 0 and
    // re-accelerating (a visible stop-start). stepRail clamps it next tick.
    rail.v = Math.max(0, e.car.speed);
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
    // `facing` comes from parkedHeading, which points the car AWAY from its serving
    // aisle, so "behind the nose" is on the AISLE SIDE. (Not necessarily inside the painted
    // lane body — 67 of 113 are; see the block comment above for the measured split.)
    const ax = stall.x - Math.cos(facing) * APPROACH_BACK_U;
    const ay = stall.y - Math.sin(facing) * APPROACH_BACK_U;
    return [...lead, ...this.graph.route(start, { x: ax, y: ay }), { x: stall.x, y: stall.y }];
  }

  /** Reconcile render state + routes against a fresh backend snapshot. */
  reconcile(snap: TwinSnapshot) {
    // THE ARM SEAM. Adopt the backend's arm timings before anything reads them.
    // `public.ottoq_arm_timings` in otto-q-core is the one home for the robot's
    // motion budget; armStateMachine.ts used to define a second copy of it, which
    // is how the renderer and the orchestrator came to disagree about how long a
    // car stays mated. Applied FIRST and ahead of the layout guard, because the
    // demate window is read further down this same method (twinTetherLeftS) and a
    // held snapshot is replayed through here anyway. Idempotent and total.
    applyArmTimings(snap.arm?.timings);

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

    // run STOP: same sim_run_id, but the run has gone terminal. The backend
    // empties the depot (ottoq_sim_stop_and_reset unplaces every vehicle and
    // clears every stall), so holding the last positions here is stale fiction.
    // Reset once on the live -> terminal edge, not on every poll thereafter.
    // `paused` counts as LIVE, so Pause holds the scene instead of clearing it.
    const status = snap.run?.status ?? null;
    // Hoisted: the clock re-anchor below must not run for a TERMINAL run. A run with no
    // status at all is treated as live, which is the pre-existing behaviour for feeds
    // that omit it — absence must not silently stop the world.
    let runIsLive = true;
    if (status) {
      const live = LIVE_RUN_STATUSES.has(status.toLowerCase());
      if (this.lastRunLive === true && !live) this.resetScene();
      this.lastRunLive = live;
      runIsLive = live;
    }

    // ─── T4: re-anchor the sim clock and refresh the leg contract ─────────────
    // Between snapshots simNow() runs off the WALL clock, so motion continues
    // (and stays correctly paced) if the feed stalls. This is the correction.
    const clockMs = Date.parse(snap.run?.sim_clock ?? "");
    // `runIsLive` gate: resetScene() just handed the clock back, and re-anchoring from a
    // TERMINATED run's sim_clock took it straight back again — the depot kept getting
    // later over a wiped scene and the scrub slider stayed disabled.
    if (runIsLive && Number.isFinite(clockMs)) {
      this.simAnchorClock = clockMs;
      this.simAnchorAt = performance.now();
      this.simSpeedX = Math.max(0.1, Number(snap.run?.speed_x ?? 1) || 1);
      this.tzOffsetMs = depotOffsetMs(clockMs);
    }
    // TRAVEL legs steer motion; DWELL legs describe what happens once parked —
    // and carry the only service windows on the wire, which is the arm's clock.
    // Newest wins per vehicle, so a re-planned move supersedes the one it replaced.
    this.legs.clear();
    this.dwells.clear();
    for (const l of snap.legs ?? []) {
      if (!l?.vehicle_id) continue;
      if (l.kind === "travel") {
        const prev = this.legs.get(l.vehicle_id);
        if (!prev || (l.seq ?? 0) >= (prev.seq ?? 0)) this.legs.set(l.vehicle_id, l);
        continue;
      }
      const w = this.parseDwell(l);
      if (!w) continue; // no usable window — publish nothing rather than invent one
      const list = this.dwells.get(l.vehicle_id);
      if (list) list.push(w);
      else this.dwells.set(l.vehicle_id, [w]);
    }
    const depot = useDepotStore.getState();
    const stalls = depot.stalls;
    const byLane: Record<string, typeof stalls> = { dcfc: [], l2: [], wash: [], service: [], staging: [] };
    const stallType = new Map<string, string>();
    for (const s of stalls) {
      (byLane[s.type] ??= []).push(s);
      stallType.set(s.id, s.type);
    }
    // the depart gate reads stall TYPE every motion tick — keep it off the store
    this.stallTypes = stallType;
    // OTTO-Q spatial policy: charging fills NORTH-first (nearest the wash/service
    // bays), so cars pool toward the top and only spill south as it fills.
    byLane.dcfc?.sort((a, b) => a.position.y - b.position.y);
    byLane.l2?.sort((a, b) => a.position.y - b.position.y);
    // Staging fills nearest the INGRESS first, so an arriving car parks close to
    // the entrance (short taxi, fans across the south rows) instead of trekking to
    // a far corner and bunching in a shared approach.
    const dIn = (s: (typeof stalls)[number]) => Math.hypot(s.position.x - INGRESS.x, s.position.y - INGRESS.y);
    byLane.staging?.sort((a, b) => dIn(a) - dIn(b));
    // PARKING DOCTRINE (MOTION-3): a car may PARK only for overnight staging, a
    // temporary hold, or an interrupted workflow. The renderer expresses that by
    // WHERE each NEW staging claim lands: DAYTIME holds fill the NE temp/overflow
    // block first (TW/TE columns + N1 row — reads as short-term congestion
    // staging, not overnight parking); deploy-ready cars pool toward the EGRESS
    // (west) so departures stage by the exit; OVERNIGHT (22:00–04:59 depot time)
    // everything may fill the perimeter carports — the real overnight park.
    // STABILITY BIAS is untouched: existing stall claims are never reshuffled;
    // ordering applies to NEW claims / lane changes only.
    //
    // STAGING IS NOT ONE UNDIFFERENTIATED LIST. The renderer draws 113 staging
    // stalls in two physically different places, and the ordering below is the
    // only thing that decides which a car gets:
    //   • CARPORT — the W/E/S perimeter runs under carports, 82 of the 113.
    //     This is the OVERNIGHT park. Daytime parking here is a failure state.
    //   • INTAKE  — the open NE block (N1 row + the TW/TE columns off the
    //     central aisle), 31 stalls. Short-hold pit-stop staging: temp holds,
    //     congestion waits, a car whose bay is not free yet.
    // Three orderings are built from those two zones, one per PURPOSE. Each is a
    // full PERMUTATION of the staging list, never a subset: a stall OTTO-Q named
    // by name must stay claimable, and the carports are a real overflow this
    // depot runs into whenever the 31-stall intake block fills — which, at the
    // 94-car staging peak the busy_day replay reaches, is most of the day.
    const hourFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" });
    const simHour = snap.run?.sim_clock ? Number(hourFmt.format(new Date(snap.run.sim_clock))) % 24 : 12;
    const overnight = simHour >= 22 || simHour < 5;
    const dOut = (s: (typeof stalls)[number]) => Math.hypot(s.position.x - EGRESS.x, s.position.y - EGRESS.y);
    /** INTAKE / temp hold — congestion holds and cars waiting for a bay. A car
     *  parked on the perimeter in daylight because it could not get what it
     *  needed is the failure state; it belongs in TEMP staging. Open NE block
     *  first, nearest the INGRESS within a zone; overnight the preference flips,
     *  because the perimeter carports ARE the overnight park. */
    /** The southernmost stall of each temp column sits IN the throat of the
     *  block's single aisle. Filling the throat first constricts entry to the
     *  whole block: measured on the busy_day replay, promoting just those two
     *  stalls ahead of the rest moved body-overlap 4090 -> 4538 samples (+11%)
     *  and wedged-car time 1977 -> 2137. Fill them last. */
    const atAisleMouth = (s: (typeof stalls)[number]) =>
      s.position.x > 222 && s.position.x < 272 && s.position.y > 165;
    const stagingIntake = [...(byLane.staging ?? [])].sort((a, b) => {
      const ca = Number(isCarportStall(a.position.x, a.position.y));
      const cb = Number(isCarportStall(b.position.x, b.position.y));
      if (ca !== cb) return overnight ? cb - ca : ca - cb;
      const ma = Number(atAisleMouth(a)), mb = Number(atAisleMouth(b));
      if (ma !== mb) return ma - mb;
      return dIn(a) - dIn(b);
    });
    /** ARRIVAL FALLBACK — an arrival OTTO-Q reserved nothing for. Ingress-first:
     *  the shortest taxi from the gate. Deliberately NOT the intake pool — the
     *  measurement is in the pool selector below. */
    const stagingIngressFirst = [...(byLane.staging ?? [])].sort((a, b) => dIn(a) - dIn(b));
    /** DEPLOY-READY — a car about to leave stages by the EXIT, and the
     *  nearest-to-egress stalls happen to be the west/south carports. That is a
     *  different thing from a car stranded on the perimeter and it is left
     *  alone: deliberately NO carport penalty here, so deploy-ready cars stop
     *  consuming the 33-stall intake block. Measured on the busy_day replay:
     *  penalising this pool too did not move deploy-ready cars off the perimeter
     *  — there is nowhere else for ~90 of them to be — it only pushed them into
     *  the intake block, and arrivals still landed 9/13 on the perimeter. */
    const stagingDeparture = [...(byLane.staging ?? [])].sort((a, b) => dOut(a) - dOut(b));

    const present = new Set<string>();
    const desiredStatus = new Map<string, StallStatus>();
    // TWIN STALL TRUTH (gaps G2/G7): stalls_status is the twin's authoritative
    // stall feed — the ONLY source for conditions no on-map vehicle explains
    // (faulted/offline chargers, reservations for inbound cars). Faulted stalls
    // recolor, WIN over vehicle-derived colors, and leave the assignment pool
    // so no car is ever routed onto a dead charger.
    const twinFaulted = new Set<string>();
    // ROBOTIC TETHER: the charge session has ended but the arm has not finished
    // demating, so OTTO-Q is refusing to move this car. Rebuilt from scratch every
    // snapshot — a tether is a ~11.5 s window, so a stale entry would show a cable on
    // a car that has already driven off. Absence means NOT tethered, never unknown.
    const tethered = new Set<string>();
    const tetherLeft = new Map<string, number>();
    const snapClockMs = Date.parse(String(snap.run?.sim_clock ?? ""));
    for (const ss of snap.stalls_status ?? []) {
      const rsid = this.twinStall.get(ss.id);
      if (!rsid) continue;
      const st = String(ss.status ?? "").toLowerCase();
      if (st === "faulted" || st === "offline") twinFaulted.add(rsid);
      else if (st === "reserved") desiredStatus.set(rsid, "reserved");
      if (ss.tethered === true) {
        tethered.add(rsid);
        const untilMs = Date.parse(String(ss.tether_until ?? ""));
        // Both timestamps come from the SAME backend sim clock, so this subtraction
        // stays inside one domain. An unparseable or missing deadline falls back to a
        // full demate rather than zero: showing the cable a moment too long is a far
        // smaller lie than releasing a car the orchestrator still has locked.
        tetherLeft.set(
          rsid,
          Number.isFinite(untilMs) && Number.isFinite(snapClockMs)
            ? Math.max(0, (untilMs - snapClockMs) / 1000)
            : DISCONNECT_SECONDS,
        );
      }
    }
    this.twinTethered = tethered;
    this.twinTetherLeftS = tetherLeft;
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
      // the ingress; "entering" therefore means "spawn at the gate and drive".
      const entering = m.lane === "gate";
      // WHAT THE ARRIVAL ACTUALLY NEEDS — not an invented park.
      //
      // 'arrived_at_gate' is a vehicle_state WORD. It says nothing about the work
      // the car came in for, so mapState (which can only see the word) reports
      // gate/staging. OTTO-Q's real answer is the STALL it reserved, and the lane
      // was hardcoded to "staging" here, throwing that away: a car with a
      // charger held for it was given a parking space instead. The depot is a
      // PIT STOP — ~90% of returns are a quick DCFC turnaround — so this sent a
      // stream of arrivals to park rather than to the work they came in for.
      //
      // The stall's TYPE is the lane. Only when OTTO-Q reserved nothing does the
      // car fall back to staging, and then to INTAKE staging, never the perimeter.
      //
      // WHERE THE RESERVATION ACTUALLY COMES FROM. OTTO-Q's assignment reaches this
      // file on the COMMAND BUS — acceptStallCommand, fed by ottoq/executors on
      // 'assign_stall' — and is held in `commanded`. It is NOT in the snapshot:
      // ottoq_twin_snapshot publishes `stall_id` as `v.current_stall_id`, which is
      // where the car IS, not what was held for it. This first read `bv.stall_id`
      // alone and called it "what OTTO-Q reserved". For a car at the gate that field
      // is normally null, so the reservation almost never resolved and the arrival
      // fell through to staging anyway — the exact defect this block exists to fix,
      // still present behind a comment claiming otherwise. Its tests passed because
      // they set the field the code read.
      //
      // The command wins. current_stall_id is kept only as a SECOND source and only
      // for what it honestly is: a car that already physically holds a stall should
      // be driven to that stall. Absent both, no reservation is invented.
      const commandedStall = this.commanded.get(bv.id)?.renderStallId;
      const reservedStall = commandedStall
        ?? (bv.stall_id ? this.twinStall.get(bv.stall_id) : undefined);
      const reservedLane = reservedStall
        ? STALL_TYPE_LANE[stallType.get(reservedStall) ?? ""] ?? null
        : null;
      let lane: Lane;
      if (bv.state === "arrived_at_gate") {
        lane = reservedLane ?? "staging";
      } else if (m.lane === "gate") {
        // no other state maps to "gate" today; a TOTAL fallback, not a cast
        lane = "staging";
      } else {
        lane = m.lane;
      }
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
            // POSITION residue only. The heading disjunct that used to sit here
            // (`|| dh > 0.2`) fired on cars that had just docked PERFECTLY.
            // A charger pull-in used to end with the nose still swinging: the
            // car arrived heading west along the column and settled to the
            // stall's north heading via the parked branch in tickMotion, which
            // eased it to within 1e-3 every tick. (That settle is gone — the
            // dock blend now takes the swing while the car is still moving and
            // the arrival sets the heading exactly.) Reconcile polls far faster
            // than that ease converged, so it caught freshly-docked cars mid-turn
            // (measured: off=0.00, dh=0.221) and re-railed them — and because
            // such a car is parked nose-in, assignRail answered with an 11u
            // REVERSE back-out plus a ~140u loop back to the stall it was
            // already sitting in. In a saturated charger column the parked
            // neighbours block that loop, so the car wedged ~2.4u OUTSIDE its
            // own stall permanently, with the 45s watchdog rebuilding a route
            // it could never drive. Heading self-heals; position does not.
            //
            // ── DEPART GATE (1 of 5): THE RESIDUE RE-RAIL ────────────────────
            // This is a door out of a DCFC stall like any other, and it was open.
            // The lane-change gate below cannot cover it — that one requires
            // `lane !== e.lane` and this branch only runs when they are EQUAL —
            // so a car docked on a charger with the arm mid-cycle, handed enough
            // position residue, was re-railed and drove off WITH THE CONNECTOR
            // IN ITS PORT.
            //
            // MEASURED, this tree, gate deleted, by the harness in
            // TwinMotionDriver.residuegate.test.ts: a car on DCFC-01 with its arm
            // at phase 'charging' and 3.0u of position residue was handed a
            // 330.38u rail and had travelled 25.02u of it four polls later;
            // after 24 polls, 185.02u of arc. Straight-line, measured from the
            // STALL (not from the displaced start pose, which sits 3.0u off it):
            // 22.74u and 104.88u. armHoldRefusals stayed 0 the whole way —
            // the gate reported nothing while the connector was being dragged.
            // Repairing a car's pose is not more urgent than not tearing an arm
            // off it: refuse, and the next poll retries. The refusal is bounded
            // by armGate's HOLD_CAP_S, so the residue is repaired late rather
            // than not at all.
            if (off > 1.8 && this.armReleases(e)) {
              this.assignRail(e, { kind: "stall", lane: lane as Lane, x: st.position.x, y: st.position.y, heading: e.stallHeading });
              e.departFor = 0;
            }
          }
        }
        this.entries.set(bv.id, e);
        continue;
      }
      // ── DEPART GATE (2 of 5): A LANE CHANGE OFF A CHARGER ────────────────
      // The twin has re-tasked this car — charge → wash, charge → staging, the
      // ordinary end of a pit stop — and it is sitting PARKED in a DCFC stall
      // with the OTTO-CHARGE ARM still on it. Hold the MOTION here, before any
      // stall is claimed, so the car keeps its charger and nothing is routed
      // onto the space its body is occupying.
      //
      // The twin's new status IS published, and that is not a leak in the gate,
      // it is the mechanism: the roster flip away from 'charging' is exactly what
      // tells both this driver's arm session and ChargingArm's that the charge
      // session is over and the demate may begin. Suppress it and the arm stays
      // latched forever, waiting on a release the hold is itself preventing.
      // The stall stays painted 'charging' because it truthfully still is —
      // there is a car on it with a connector in its port.
      if (e && lane !== e.lane && e.lane === "dcfc" && e.stallId
          && !e.tracker && !e.reverse && !this.armReleases(e)) {
        e.vstatus = m.vstatus;
        e.oem = oem;
        e.soc = soc;
        if (bv.av_id) e.avId = bv.av_id;
        if (bv.make) e.make = bv.make;
        desiredStatus.set(e.stallId, "charging");
        this.entries.set(bv.id, e);
        continue; // retry next poll; the demate is bounded (armGate HOLD_CAP_S)
      }
      // THREE POOLS, NOT ONE LIST. Previously this named only two states and let
      // EVERYTHING else fall through to the raw ingress-sorted list, whose
      // nearest-to-INGRESS entries are the SOUTH PERIMETER CARPORT rows. Every
      // unnamed staging state — arrivals, emergency-staged, out-of-service —
      // therefore got a perimeter park by default.
      //
      // The unreserved arrival deliberately keeps the ingress-first ordering, and
      // this is the honest part: routing it to the NE intake block MEASURES WORSE.
      // Replaying the captured busy_day run (116 vehicles, 94 simultaneous
      // staging claims against 33 non-carport staging stalls) with arrivals sent
      // to intake: wedged-car time 1977 -> 2383 samples (+21%), because the block
      // is reached up the EAST AVENUE — the 14.31u corridor between the TE and E
      // columns that the fixture's own ratchet comment names as an unclosed
      // clearance conflict — and it is already full of day holds. An arrival
      // queued in the depot's narrowest corridor is worse for it and for
      // everyone behind it than a short taxi to the carport row beside the gate.
      // The structural fix is depot capacity (33 short-hold stalls cannot serve a
      // 94-car staging peak), not a different sort order here.
      //
      // What DOES move the arrival off the perimeter is the lane fix above: an
      // arrival OTTO-Q reserved a charger or bay for now drives to it and never
      // asks this pool at all.
      const stagingPool = lane !== "staging" ? null
        : bv.state === "staged_for_departure" ? stagingDeparture
        : bv.state === "arrived_at_gate" ? stagingIngressFirst
        : stagingIntake;
      const cands = (stagingPool ?? byLane[lane] ?? []).map((s) => s.id).filter((sid) => !twinFaulted.has(sid));
      // EXACT-STALL FIDELITY: if the twin named this vehicle's stall and it maps
      // to a renderer stall in the right zone, claim exactly that one — what you
      // see is literally OTTO-Q's assignment. Zone-based pick is the fallback
      // (unmapped stall, renderer/twin drift, or stale local claim).
      let stallId: string | null = null;
      // OTTO-Q FIRST. An accepted orchestration command outranks the twin's own
      // stall pick, so what you see on screen is literally the decision the
      // funnel emitted. `cands` is already filtered to the lane the twin's state
      // implies, so a commanded stall in the WRONG lane simply is not a
      // candidate — the car follows the twin and the mismatch is recorded
      // rather than fought.
      const order = this.commanded.get(bv.id);
      if (order) {
        if (cands.includes(order.renderStallId) && this.ledger.claim(bv.id, order.renderStallId)) {
          stallId = order.renderStallId;
          order.laneMismatch = null;
        } else if (!order.arrived) {
          order.laneMismatch =
            `commanded stall ${order.renderStallId} is not available in the ${lane} lane the twin put this vehicle in`;
        }
      }
      const exact = bv.stall_id ? this.twinStall.get(bv.stall_id) : undefined;
      if (!stallId && exact && cands.includes(exact) && this.ledger.claim(bv.id, exact)) stallId = exact;
      if (!stallId) stallId = this.ledger.claimFirstFree(bv.id, cands);
      if (!stallId) {
        // overflow (no free stall in the target lane): a NEW car stays off-map
        // until a stall frees. An EXISTING car that just LANE-CHANGED must not
        // keep squatting on its old stall (a twin-washing car parked on a charger
        // visually blocks it forever — the "not moving to its next assignment"
        // defect): pull it out to a staging spot to wait its turn instead.
        if (e) {
          if (e.lane !== lane && lane !== "staging") {
            // temporary congestion hold (doctrine case 2): wait in the NE temp
            // block, not the overnight carports
            const stageCands = stagingIntake.map((s) => s.id).filter((sid) => !twinFaulted.has(sid));
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
          // HONEST HOLD: while overflow-waiting in a staging spot, show 'staging'
          // — never draw a car as charging/washing while it sits in a carport.
          e.vstatus = e.lane === "staging" && isServiceLane(lane) ? "staging" : m.vstatus;
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
            const p = { x: INGRESS.x + 6 + i * SPAWN_PITCH, y: INGRESS.y - 2 };
            if (p.x > QUEUE_MAX_X) break; // past the gate's catchment — defer instead
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
        // ── DEPART GATE (3 of 5): THE DEPARTURE LAUNCH ─────────────────────
        // Flip the status FIRST — that is what ends the charge session and starts
        // the demate on both evaluations of the arm cycle — then refuse to launch
        // while the arm is still on the car. A held departer takes the same path
        // as one waiting for a departure slot: parked, stall claim kept, queued.
        e.vstatus = "departing";
        e.departFor = 0;
        if (activeDeparting < MAX_ACTIVE_DEPARTING && this.armReleases(e)) {
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

    // VIEW MULTIPLIER (founder spec 2026-07-25: 1x is true 1:1, 2-3x for a livelier
    // demo, hard cap 3x because OTTO-Q cannot decide faster than that — beyond it you
    // JUMP, you don't speed up).
    //
    // Applied as N FIXED SUB-STEPS rather than one big dt. RailFlow samples the lane at
    // SAMPLE=2 units; at MAX_SPEED=8 u/s a single 3x dt can advance a car far enough to
    // step THROUGH a body before the leader scan sees it. Sub-stepping preserves the
    // car-following and turn-radius maths for free.
    const mult = this.viewMult;
    if (mult <= 1.0001) { this.tickMotion(dt); return; }
    const steps = Math.min(6, Math.ceil(mult));
    const sub = (dt * mult) / steps;
    for (let i = 0; i < steps; i++) this.tickMotion(sub);
  }

  /** One physical motion step of `dt` seconds. Public for unit testing. */
  tickMotion(dt: number) {
    // Single chokepoint for ALL motion: guarding here (not just in step) means
    // no caller — loop, interval, or test — can advance a held depot.
    if (this.paused) return;
    // The depot clock advances HERE, not in reconcile: tickMotion runs every
    // frame whether or not a car moved, so a fully parked depot still has a
    // running clock (an arm mid-mate on a stationary car must not freeze), and
    // a PAUSED depot freezes the clock with everything else via the guard above.
    this.publishSimClock();
    // …and so do the OTTO-CHARGE ARMS, for the same reason: an arm mid-demate on
    // a stationary car must keep retracting, and the depart gate below is only as
    // current as the sessions behind it. Stepped BEFORE any car is moved, so no
    // car can be released against a stale phase.
    this.stepArms();
    // every physical body on the lot, one entry each — rail cars project these
    // onto their own forward windows (RailFlow); `moving` is kept only for the
    // reverse maneuver's rear-clearance check.
    const bodies: RailBody[] = [];
    const moving: MovingCar[] = [];
    for (const [id, e] of this.entries) {
      // heading + moving flag let a rail car ignore ONCOMING/crossing traffic as
      // a leader (real crossings are serialized by node locks) — kills the
      // pass-freeze + ingress pileup. A tracker means the car is taxiing.
      bodies.push({ id, x: e.car.x, y: e.car.y, heading: e.car.heading, moving: !!e.tracker });
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
        // ── DEPART GATE (4 of 5): THE TTL FORCED LAUNCH ──────────────────────
        // TOTALITY. This door is only reachable after DEPART_TTL (90 s) of
        // waiting parked, and armGate's own HOLD_CAP_S (60 sim-seconds) frees a
        // car before then, so it should never be the binding constraint — but a
        // gate enforced on four doors out of five is not a gate.
        if (e.departFor > DEPART_TTL && this.armReleases(e)) {
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
        // T4: pace this car so it ARRIVES when OTTO-Q's leg says it should. A
        // ceiling only — traffic, node locks and the mouth lock still clamp below.
        e.tracker.vCap = this.contractPace(id, e.tracker);
        const pose = stepRail(id, e.tracker, dt, bodies, this.locks);
        changed = true;
        if (pose) {
          e.car.x = pose.x;
          e.car.y = pose.y;
          // rate-limit the heading toward the rail tangent so a sharp corner
          // vertex reads as a turn, not a one-frame snap (position is exact).
          //
          // DOCK BLEND: the last leg into a CHARGER stall is a 16u SIDESTEP off
          // the flanking gap lane (routeToStall: gap lane x=80/126.5 → stall
          // x=96/110), so the rail's final tangent points east/west while the
          // parked heading is NORTH. That 90° was previously left to the parked
          // branch below and taken at a dead stop — the body spinning about its
          // own centre on the stall, which is the founder's "back bumper slides"
          // at the charger. The rails cannot be re-cut to arrive nose-north:
          // the L2 west column is pitched 10.3u and a car is 10.2u long, so a
          // nose-in approach lane between two stalls would run 2.05u THROUGH the
          // body parked below. So the turn is taken while the car is still
          // MOVING instead: over the final DOCK_BLEND units the aim rotates from
          // the rail tangent to the stall heading, which for a 90° dock is
          // 0.157 rad/u — a real swing into the bay, and well inside the
          // speed-scaled yaw budget above.
          let aim = pose.heading;
          const dock = e.dest?.kind === "stall" ? e.dest.heading : null;
          if (dock != null) {
            const rem = e.tracker.total - e.tracker.s;
            if (rem < DOCK_BLEND) {
              const t = Math.min(1, Math.max(0, 1 - rem / DOCK_BLEND));
              aim = wrapAngle(pose.heading + wrapAngle(dock - pose.heading) * t);
            }
          }
          e.car.heading = easeHeading(e.car.heading, aim, dt, e.tracker.v);
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
            // The dock blend above already swung the body to the stall heading
            // WHILE IT WAS MOVING, so what is left here is at most a couple of
            // degrees. Settle it exactly: the OTTO-CHARGE ARM aims at a flank
            // plane derived from this heading, so a parked car has to be exactly
            // on it — and it must not be finished by rotating a stopped car.
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
            // OTTO-Q ARRIVAL REPORT. The command asked for a stall by a
            // deadline; the car has now physically reached one. Report the
            // truth either way — arriving at a DIFFERENT stall than commanded
            // is a completed drive but a failed instruction, and the ledger
            // must show which.
            const order = this.commanded.get(id);
            if (order && !order.arrived) {
              const onTarget = e.stallId === order.renderStallId;
              const transit_s = (performance.now() - order.acceptedAtMs) / 1000;
              order.arrived = true;
              this.motionOutcomes.push({
                command_id: order.command_id,
                vehicle_id: id,
                status: onTarget ? "completed" : "rejected",
                transit_s: Math.round(transit_s * 10) / 10,
                reason: onTarget
                  ? null
                  : order.laneMismatch ??
                    `vehicle docked at ${e.stallId} instead of the commanded ${order.renderStallId}`,
              });
              // ALWAYS drop the order once it has resolved, on-target or not.
              //
              // It used to be deleted only on success, so a command already
              // closed as `rejected` in the L0 ledger stayed in this map and
              // went on overriding the twin's own stall pick — past its own
              // window, with no further report, because `arrived` was already
              // true. On the mainline gate-assignment flow that fired routinely:
              // the advisor targets vehicles at the gate, whose lane never
              // contains the commanded charger stall, so the first arrival
              // always mismatched and the dead order then steered the car.
              //
              // A resolved command is finished. It does not get to keep driving.
              this.commanded.delete(id);
            }
          }
        }
      } else {
        // PARKED: hold position AND hold heading. A stopped car has no yaw
        // budget — this branch used to keep easing the heading toward the stall
        // at up to 3 rad/s with the wheels stationary, which was 234 of the
        // fixture's motion steps spent rotating a body that had translated less
        // than 0.001u (measured on origin/main @ 22ec3f6; 0 in this tree — see
        // MAX_TURN_RATE at the top of this file for the full probe). The
        // rotation now happens on the dock blend above, while the car is still
        // moving, and the arrival settles it exactly.
        if (e.car.speed !== 0) { e.car.speed = 0; changed = true; }
      }
    }
    for (const id of remove) {
      // A despawn with a live order must not leave that command dangling in the
      // bus ledger forever — close it with the reason it can no longer be met.
      const order = this.commanded.get(id);
      if (order && !order.arrived) {
        this.motionOutcomes.push({
          command_id: order.command_id,
          vehicle_id: id,
          status: "rejected",
          transit_s: Math.round(((performance.now() - order.acceptedAtMs) / 1000) * 10) / 10,
          reason: "vehicle left the depot before reaching the commanded stall",
        });
      }
      this.commanded.delete(id);
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
        // ── DEPART GATE (5 of 5): THE QUEUE DRAIN ────────────────────────
        // The queue is drained here, not in reconcile, so this is a door out of
        // a stall in its own right and it needs the same lock. Stays queued —
        // it does not lose its place — until its arm reports clear.
        if (!this.armReleases(e)) { stillDriving.push(id); continue; }
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
    // The service window is part of the ROSTER, so it must also be part of the
    // fingerprint. Without it, a car that was already in the roster (unchanged
    // status/stall/SoC) acquires its window silently and the early-return below
    // drops the whole push — the arm would go on waiting for a clock that had
    // already been computed. Resolved once here and reused for the roster.
    const windows = new Map<string, { start: number; duration: number } | null>();
    for (const [id, e] of this.entries) {
      poseStore.set(id, e.car.x, e.car.y, e.car.heading);
      const w = this.serviceWindow(e);
      windows.set(id, w);
      // SoC at FULL resolution. This used to bucket to 5% (Math.round(e.soc / 5)) to
      // avoid invalidating the roster on per-percent churn — but the roster gate is what
      // decides whether React ever SEES a new SoC, so bucketing here froze the number the
      // operator reads. FOUNDER-OBSERVED: "the state of charge never increases"; measured
      // on run 7d8da1ca a charging car gained 6.2 points in 3.7 real minutes, which is at
      // most ONE visible step, and often none. The 3D badge memo downstream had a matching
      // 5-point comparator, so fixing that alone changed nothing — this gate binds first.
      //
      // The churn it guarded against cannot actually be large: vehicles.current_soc is an
      // INTEGER column in otto-q-core, so a car can move the key by at most one step per
      // whole percentage point — roughly one roster push per car per several ticks, not
      // per poll. Movement still never re-renders: position comes from poseStore, which is
      // written above and deliberately not part of this key.
      key += `${id}:${e.vstatus}:${e.stallId ?? ""}:${Math.round(e.soc)}`;
      key += `:${w ? `${Math.round(w.start)}/${Math.round(w.duration)}` : ""};`;
    }
    // (2) the React roster → only when the SET / status / stall / soc changes,
    // so movement never triggers a re-render.
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;
    const arr: Vehicle[] = [];
    for (const [id, e] of this.entries) {
      const w = windows.get(id) ?? null;
      arr.push({
        id, label: e.avId ? (e.make ? `${e.avId} · ${e.make}` : e.avId) : undefined,
        type: "fleet", oem: e.oem, priority: 5,
        batteryCapacity: 100, currentSoC: e.soc, targetSoC: 90,
        status: e.vstatus, assignedStall: e.stallId, serviceQueue: [], currentServiceIndex: 0,
        // OTTO-Q's dwell window, in the same seconds-of-day frame as the store's
        // simTime. Null when the wire carried no window for this dock — the arm
        // then stays home instead of animating against a fabricated clock.
        serviceStartTime: w ? w.start : null,
        serviceDuration: w ? w.duration : null,
        arrivalTime: 0,
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
