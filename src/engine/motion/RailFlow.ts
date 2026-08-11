// ============================================================================
// RailFlow — lane-constrained ("rails") taxi motion.
//
// A taxiing car's state is (route polyline, arc-distance s, speed v). Its pose
// IS the point/tangent at s — cars cannot leave their lane, so lane discipline
// and no-overlap are structural guarantees, not steering behaviors:
//   • same-path following: IDM against the nearest body projected onto MY
//     forward window (other rail cars, parked bodies, docking cars alike)
//   • intersections: every LaneGraph node is a LOCK — one car crosses at a
//     time; waiters treat the node as a stop bar (no mutual-yield deadlocks)
//   • charger columns: a MOUTH lock per column — one car docks/undocks at a
//     time; followers hold at the column entrance in a visible, orderly queue
// Docking (Dubins pull-in past the rail end) and reverse back-outs stay
// scripted kinematic maneuvers owned by TwinMotionDriver.
// ============================================================================
import type { Pt } from "./PathTracker";
import { CAR_BODY_LENGTH } from "./traffic";
import { idmAccel } from "./idm";

export interface RailBody {
  id: string; x: number; y: number;
  /** travel heading (rad) + whether it is a moving/taxiing car. A MOVING car
   *  heading against my path is ONCOMING (a pass on the divided road) or CROSSING
   *  at a node — it must NOT count as a leader to brake for (real crossings are
   *  serialized by the node LOCKS). A parked body always blocks. */
  heading?: number; moving?: boolean;
}

export interface Rail {
  pts: Pt[];
  cum: number[];          // cumulative arc length at each vertex
  total: number;
  nodes: { id: string; s: number }[]; // graph intersections along this route
  s: number;              // arc position
  v: number;              // speed (u/s)
  mouthKey: string | null; // charger-column mouth this route ends in (if any)
  stationaryFor: number;  // watchdog: seconds since the car last made real
                          // ARC PROGRESS (not just "since v≈0") — a car creeping
                          // at ~1 u/s behind a stale lock never fully stops, so
                          // a velocity-only watchdog would miss it
  progressS: number;      // arc position at the last progress checkpoint
  /** T4 CONTRACT PACING (optional). Speed ceiling in u/s derived from OTTO-Q's
   *  timed leg: remaining arc / remaining sim-seconds until planned_end_sim. It is
   *  a CEILING ONLY — it can slow a car so it arrives when the contract says, but
   *  it can never make one exceed MAX_SPEED, and it never overrides IDM braking,
   *  node locks or the mouth lock (those clamp v downward and still win). Undefined
   *  = uncapped, i.e. exactly the pre-T4 behaviour. */
  vCap?: number;
}

const LANE_HALF = 1.7;    // half-width that counts as "in my path"
const LOOK = 26;          // forward window (u)
const SAMPLE = 2;         // projection sampling step (u)
const NODE_CLAIM = 12;    // start trying to hold a node this far out
const NODE_STOP = 4;      // stop bar distance before an unheld node
const NODE_RELEASE = 10;  // release once this far past
const MOUTH_ZONE = 18;    // column mouth = final stretch of the route
const MAX_SPEED = 8;
const HEADING_LA = 6;     // look-ahead (u) for the rendered heading — aims a few
                         // units down the rail so a corner rounds off smoothly
                         // instead of snapping the body 90° at each vertex
const ONCOMING_DOT = 0.15; // cos of the path/​body heading angle below which a
                          // MOVING body is oncoming/crossing (ignored as a leader)

export function buildRail(
  pts: Pt[],
  nodePositions: Iterable<{ id: string; x: number; y: number }>,
  mouthKey: string | null,
): Rail {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1] ?? 0;
  // annotate graph nodes that lie ON this route (within 3u of it)
  const nodes: { id: string; s: number }[] = [];
  for (const n of nodePositions) {
    let best = Infinity, bestS = 0;
    for (let s = 0; s <= total; s += SAMPLE) {
      const p = pointAt(pts, cum, s);
      const d = (p.x - n.x) ** 2 + (p.y - n.y) ** 2;
      if (d < best) { best = d; bestS = s; }
    }
    if (best <= 9) nodes.push({ id: n.id, s: bestS });
  }
  nodes.sort((a, b) => a.s - b.s);
  return { pts, cum, total, nodes, s: 0, v: 0, mouthKey, stationaryFor: 0, progressS: 0 };
}

const PROGRESS_STEP = 4; // advancing this far resets the no-progress watchdog

// ── CO-SPAWN DEADLOCK BREAKER ───────────────────────────────────────────────
// Reserving the drawn 10.2u body (instead of 4.125u) means a car needs ~17u of
// clear road to pull away rather than ~11u, and that surfaced a latent driver
// bug: TwinMotionDriver can admit two cars onto two different rails at the SAME
// ingress point (measured 0.26u apart in the docking probe's interleaved fill).
// Each then reads the other as a leader ~2u ahead, each brakes to a standstill
// for the other, and BOTH sit at s=0 forever — 5 of 40 cars never reached their
// charger. Mutual braking cannot separate bodies that already overlap.
//
// The escape is deliberately as narrow as it can be made, so ordinary queueing
// and ordinary congestion are untouched (measured: the busy_day fixture reports
// identical geometry with it armed and disarmed — it never fires there):
//   1. the car must be WEDGED (no arc progress for DEADLOCK_S), not merely
//      stopped in a queue;
//   2. it must still be AT ITS ROUTE START — a wedge mid-route is a different
//      animal and freezing is the right answer for it;
//   3. the blocker must be MOVING (a parked car is a static obstacle that will
//      never clear, so pushing into it is strictly worse) and be ON TOP of it,
//      not in front of it;
//   4. exactly ONE of the pair yields — the id comparison is an arbitrary but
//      DETERMINISTIC tiebreak, and without it both cars creep and the pair
//      travels welded together.
// The car that goes is then held to CREEP_SPEED, so unsticking is a crawl out
// of the other body rather than a launch through it.
const DEADLOCK_S = 8;
const CREEP_SPEED = 1.5;
/**
 * How far along a route still counts as "at the start" for rule 2 above.
 *
 * A ROUTE DISTANCE, deliberately NOT derived from CAR_BODY_LENGTH. It was
 * `CAR_BODY_LENGTH / 2`, which re-created exactly the coupling the body constant
 * exists to remove: RailFlow.test.ts pins CAR_BODY_LENGTH to the body the cockpit
 * draws, so drawing a longer car would silently widen this breaker's arming window
 * too. Two unrelated quantities, one literal.
 *
 * CAVEAT, worth knowing before tuning it: `r.s` is arc position on the CURRENT rail,
 * and rails are rebuilt from s=0 (TwinMotionDriver rebuilds any car stationary past
 * its threshold), so a car wedged MID-route can re-enter this window after a rebuild.
 * Rule 2's comment claims that cannot happen. It can. Left as-is because the breaker
 * still requires a MOVING blocker on top of the car, and firing there unsticks a real
 * wedge rather than creating one — but the comment should not be trusted as an invariant.
 */
const DEADLOCK_START_ZONE = 5;

export function pointAt(pts: Pt[], cum: number[], s: number): Pt & { heading: number } {
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, heading: 0 };
  const total = cum[cum.length - 1];
  const t = Math.max(0, Math.min(s, total));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const seg = Math.max(cum[i] - cum[i - 1], 1e-6);
  const f = (t - cum[i - 1]) / seg;
  const a = pts[i - 1], b = pts[i];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    heading: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Shared lock boards (one per driver instance). */
export class RailLocks {
  nodes = new Map<string, string>();  // nodeId → carId
  mouths = new Map<string, string>(); // mouthKey → carId

  /** try to hold (or confirm holding) a lock; returns true if held */
  acquire(board: Map<string, string>, key: string, carId: string): boolean {
    const cur = board.get(key);
    if (cur === undefined) { board.set(key, carId); return true; }
    return cur === carId;
  }
  releaseAll(carId: string) {
    for (const [k, v] of this.nodes) if (v === carId) this.nodes.delete(k);
    for (const [k, v] of this.mouths) if (v === carId) this.mouths.delete(k);
  }
}

/**
 * Advance one rail car by dt. `bodies` = every OTHER physical body on the lot
 * (rail cars at their rail pose, parked cars, docking cars). Returns the new
 * pose, or null when the route end is reached (caller starts the dock/snap).
 */
export function stepRail(
  id: string,
  r: Rail,
  dt: number,
  bodies: RailBody[],
  locks: RailLocks,
): (Pt & { heading: number }) | null {
  // 1) nearest body in my forward window (projected onto MY path)
  let gap = Infinity;
  // wedged AT THE ROUTE START — the only place the co-spawn deadlock happens.
  const wedged = r.stationaryFor > DEADLOCK_S && r.s < DEADLOCK_START_ZONE;
  let creeping = false; // set only by the deadlock breaker; clamps v to a crawl
  const maxAhead = Math.min(LOOK, r.total - r.s);
  for (let d = SAMPLE; d <= maxAhead; d += SAMPLE) {
    const p = pointAt(r.pts, r.cum, r.s + d);
    for (const b of bodies) {
      if (b.id === id) continue;
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy > LANE_HALF * LANE_HALF) continue;
      // a MOVING body heading AGAINST my path here is oncoming (a pass on the
      // divided road) or crossing at a node — real crossings are serialized by
      // the node LOCK (below), so braking for it here was the pass-freeze /
      // ingress pileup. A parked (non-moving) body always blocks.
      if (b.moving && b.heading !== undefined &&
          Math.cos(b.heading - p.heading) < ONCOMING_DOT) continue;
      // CO-SPAWN DEADLOCK BREAKER (see DEADLOCK_S above for the full argument
      // and the four conditions). `d <= SAMPLE` is "on top of me, not in front
      // of me": the first scan sample can only report a body whose centre lies
      // within LANE_HALF of a point SAMPLE ahead, i.e. 0.3u..3.7u from my own
      // centre — well inside my 5.1u front half. Braking is futile there.
      if (b.moving && wedged && d <= SAMPLE && id < b.id) { creeping = true; continue; }
      // `d` is arc distance to a sample point that b's CENTRE sits within
      // LANE_HALF of, so d is centre-to-centre. One whole body length converts
      // it to bumper-to-bumper. The old `CAR_LENGTH * 0.55` (4.125 u) budgeted
      // 40% of the body the cockpit draws, so a queue that IDM had settled
      // perfectly at its jam gap was still 1.075 u inside the car in front.
      gap = Math.min(gap, d - CAR_BODY_LENGTH);
    }
    if (gap < Infinity) break; // nearest sample wins; no need to look further
  }

  // 2) intersections: hold the next node's lock or stop at its bar
  for (const n of r.nodes) {
    const dist = n.s - r.s;
    if (dist < -NODE_RELEASE) {
      if (locks.nodes.get(n.id) === id) locks.nodes.delete(n.id); // passed → free it
      continue;
    }
    if (dist > NODE_CLAIM) break;
    if (!locks.acquire(locks.nodes, n.id, id)) {
      gap = Math.min(gap, Math.max(0, dist - NODE_STOP));
      break; // can't pass this node; nothing beyond matters
    }
  }

  // 3) charger-column mouth: one car in the final stretch at a time
  if (r.mouthKey && r.total - r.s < MOUTH_ZONE + LOOK) {
    const intoMouth = r.total - r.s - MOUTH_ZONE; // distance until the zone starts
    if (!locks.acquire(locks.mouths, r.mouthKey, id)) {
      gap = Math.min(gap, Math.max(0, intoMouth));
    }
  }

  // 4) IDM speed + advance along the rail
  const accel = idmAccel(r.v, Math.max(0, gap), 0);
  // T4: the contract's pace is a CEILING layered on top of the physics ceiling.
  // Traffic (IDM gap), node locks and the mouth lock all clamp v downward below
  // and still win — so honouring OTTO-Q's timing can never push a car through a
  // car in front of it or through a held intersection.
  // CREEP_SPEED is a third ceiling of the same kind: a car unsticking itself
  // from a co-spawn deadlock crawls out, it does not launch.
  const vMax = Math.min(MAX_SPEED, r.vCap ?? MAX_SPEED, creeping ? CREEP_SPEED : Infinity);
  r.v = Math.max(0, Math.min(vMax, r.v + accel * dt));
  // ease to a stop exactly at the route end
  r.v = Math.min(r.v, Math.sqrt(2 * 7 * Math.max(0, r.total - r.s)));
  r.s += r.v * dt;
  // no-PROGRESS watchdog: reset only when the car has actually advanced
  // PROGRESS_STEP along the route; creeping in place still accrues stuck-time.
  if (r.s - r.progressS >= PROGRESS_STEP) { r.progressS = r.s; r.stationaryFor = 0; }
  else r.stationaryFor += dt;

  if (r.s >= r.total - 0.3) return null; // arrived — caller docks/snaps
  const here = pointAt(r.pts, r.cum, r.s);
  // SMOOTH HEADING: aim toward a point HEADING_LA ahead on the rail instead of
  // the raw segment tangent (which snapped 90° at each vertex → the diagonal
  // crab-slide). The look-ahead makes the body ROUND each corner, anticipating
  // the turn so heading stays aligned with motion; TwinMotionDriver still
  // rate-limits toward it via easeHeading.
  const la = Math.min(r.total - r.s, HEADING_LA);
  if (la > 0.75) {
    const ahead = pointAt(r.pts, r.cum, r.s + la);
    const hx = ahead.x - here.x, hy = ahead.y - here.y;
    if (hx * hx + hy * hy > 1e-3) here.heading = Math.atan2(hy, hx);
  }
  return here;
}
