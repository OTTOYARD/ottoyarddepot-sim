// ============================================================================
// RailFlow — lane-constrained ("rails") taxi motion.
//
// A taxiing car's state is (route polyline, arc-distance s, speed v). Its pose
// IS the point/tangent at s — cars cannot leave their lane, so lane discipline
// and no-overlap are structural guarantees, not steering behaviors:
//   • same-path following: IDM against the nearest body projected onto MY
//     forward window (other rail cars, parked bodies, docking cars alike)
//   • junctions: every LaneGraph node admits any set of cars whose MOVEMENTS
//     through it are compatible (see RailLocks); a car whose movement conflicts
//     with one already inside, or that could not clear the box, waits at a stop
//     bar outside it
//   • charger columns: a MOUTH lock per column — one car docks/undocks at a
//     time; followers hold at the column entrance in a visible, orderly queue
// Docking (Dubins pull-in past the rail end) and reverse back-outs stay
// scripted kinematic maneuvers owned by TwinMotionDriver.
// ============================================================================
import type { Pt } from "./PathTracker";
import { CAR_BODY_LENGTH, CAR_BODY_WIDTH } from "./traffic";
import { idmAccel } from "./idm";

export interface RailBody {
  id: string; x: number; y: number;
  /** travel heading (rad) + whether it is a moving/taxiing car. A MOVING car
   *  heading against my path is ONCOMING (a pass on the divided road) or CROSSING
   *  at a node — it must NOT count as a leader to brake for (real crossings are
   *  serialized by the junction control, RailLocks). A parked body always blocks. */
  heading?: number; moving?: boolean;
  /** current speed (u/s). A junction is not entered while a STOPPED body sits
   *  just past it on my path (don't block the box); a parked body has no speed. */
  speed?: number;
  /** backing out of a stall — a car joining traffic at that spot waits for it */
  reversing?: boolean;
  /** what a STOPPED rail car is waiting on (RailFlow's limiterId), if anything —
   *  lets a junction see that its holder is waiting on the very car it refuses */
  waitsOn?: string | null;
}

export interface Rail {
  pts: Pt[];
  cum: number[];          // cumulative arc length at each vertex
  total: number;
  nodes: { id: string; s: number; sweep?: Sweep }[]; // graph junctions along this route
                          // (`sweep` is this car's movement through it, built on first need)
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
   *  junctions or the mouth lock (those clamp v downward and still win). Undefined
   *  = uncapped, i.e. exactly the pre-T4 behaviour. */
  vCap?: number;
  /** Which constraint set this step's gap: a body in my path, a junction I could
   *  not enter, a charger-column mouth held by another car, traffic I am waiting to
   *  merge into, or nothing (free road / easing into the route end). The flow
   *  replay attributes stopped time with it. */
  limiter?: "body" | "node" | "mouth" | "merge" | null;
  /** The car behind `limiter`, when there is one. The driver publishes it as
   *  RailBody.waitsOn for a stopped car, which is how a junction recognises a
   *  holder that is waiting on the very car it is refusing (the deadlock breaker
   *  in stepRail). */
  limiterId?: string | null;
  /** A rail that starts OFF the road and joins it — a charger sidestep, a staging
   *  back-out, a bay pull-through: where it joins, and which way that lane flows.
   *  The car does not start until the lane behind the join is clear (see stepRail);
   *  once it has started, it is committed and the lane's traffic sees it as a
   *  body in the ordinary way. */
  merge?: { x: number; y: number; hx: number; hy: number; committed?: boolean };
}

const LANE_HALF = 1.7;    // half-width that counts as "in my path"
const LOOK = 26;          // forward window (u)
const SAMPLE = 2;         // projection sampling step (u)
// How close the rail must pass a LaneGraph node to count as traversing it — the
// gate on whether that intersection gets locked at all.
//
// It was 3u, and a rail NEVER passes within 3u of a node it traverses: route()
// shifts every interior road vertex drive-on-the-right by LaneGraph.rightOffset,
// which is 3.2u. So the test could only ever match by accident, on corners where
// a chord happened to cut nearer than either endpoint. Measured on the fixture:
// a staging→egress route crossing S_in, Sg2, Sg1 and Sg0 locked NONE of them
// (only S_eg and egress, both next to un-offset route endpoints), so those
// intersections were not serialized and crossing cars drove through each other.
// 5u cleared rightOffset plus the corner rounding cut below. It stopped clearing
// it once LaneGraph.offsetRight took proper MITER joins: the inside of a 90° turn
// now runs rightOffset·√2 = 4.53u from the node, and the rounding cuts it ~1u
// further in, so a car turning RIGHT through a junction passed ~5.7u from it and
// never asked for it. Measured on busy_day: every right-turner into the egress
// spur skipped S_eg, and met the left-turners merging into the same spur (the
// crossing contacts there went 4 -> 12). 7u covers it; the nearest node a route
// does NOT traverse is still >20u away, so it cannot false-positive.
const NODE_MATCH = 7;
const NODE_CLAIM = 12;    // commit to (enter) a junction this far out
// Where a car waits for a junction, as the IDM "stationary leader" distance. IDM
// settles s0 = 5u behind it, so the car's CENTRE stops NODE_STOP + 5 = 11u short
// of the node and its nose 11 - 5.1 = 5.9u short. The near crossing lane's body
// reaches 3.2 + 2.1 = 5.3u from the node, so a waiting car now stays out of it.
// At the old 4 its nose stood 1.2u INSIDE that lane, and crossing traffic — which
// a waiting car deliberately does not brake for — passed through it.
const NODE_STOP = 6;
const NODE_SEE = 26;      // a junction held against me is visible (a stop bar) this far out
const NODE_RELEASE = 11;  // out of the box once the centre is this far past (≥ BOX)
// Don't block the box: a stopped body closer than this past the node (its centre,
// on my path) means I would have to stop with my body still inside the junction.
// My centre must reach NODE_RELEASE to be clear; IDM holds it s0 + one body behind
// the stopped car, so 11 + 5 + 10.2.
const BOX_EXIT = NODE_RELEASE + 5 + CAR_BODY_LENGTH;
// Merge gap acceptance: a car in the lane within MERGE_LAT of its line and up to
// MERGE_BACK behind the join point (≈3 s at cruise) makes a joining car wait.
const MERGE_LAT = 3.5;
const MERGE_BACK = 26;
const MOUTH_ZONE = 18;    // column mouth = final stretch of the route
const MAX_SPEED = 8;
// Look-ahead (u) for the rendered heading. It used to be 6, to hide the 90°
// tangent snap at a sharp vertex — but aiming 6u down the rail makes the body
// point into a turn it has not started, which is the OTHER half of "they move
// diagonally". roundCorners() below now removes the snap at its source, so the
// look-ahead only has to smooth the arc's own 1.2u sampling. Measured on the
// busy_day fixture: railing motion steps whose drawn heading was more than 20°
// off the direction the body actually moved fell from 3665 (LA=6) to 1831
// (LA=2), for +79 body-overlap pair-samples out of ~2100.
const HEADING_LA = 2;
const ONCOMING_DOT = 0.15; // cos of the path/​body heading angle below which a
                          // MOVING body is oncoming/crossing (ignored as a leader)

// ── CORNER ROUNDING ─────────────────────────────────────────────────────────
// A routed rail is a polyline with SHARP vertices: the tangent flips up to 90°
// (a boulevard corner) or ~180° across a single point. Nothing physical can
// follow that, so the body was left to fake it — the pose position turned
// instantly while the drawn heading eased behind it, which IS the founder's
// "they move diagonally / the back bumper slides at the intersection".
//
// Measured on the busy_day fixture with sharp vertices: the drawn heading
// disagreed with the direction the body actually moved by a MEAN of 23.25°
// (max 180°), and 6652 motion steps drew a curvature tighter than a real car's
// minimum turn radius allows.
//
// So the PATH itself is rounded here, once, at build time. Each interior vertex
// becomes a circular arc tangent to both legs — the same arc a steered car
// traces. Position then curves through the corner and the tangent heading is
// continuous, so the heading no longer has to catch up to anything.
//
// The radius is bounded three ways, and takes the smallest:
//   • CORNER_R   — the car's own minimum turn radius, wheelbase/tan(maxSteer)
//                  = 6/tan(0.5) ≈ 11u (KinematicCar.DEFAULT_CAR_PARAMS). The
//                  outer bound; on this depot's corners CORNER_MAX_CUT binds
//                  first.
//   • CORNER_MAX_CUT — how far the arc may deviate from the vertex it replaces.
//                  A corner arc cuts to the INSIDE, and the lane it cuts into is
//                  only 6.4u wide (2 x LaneGraph.rightOffset): the body has just
//                  1.1u of slack toward the centre stripe, so the cut is held to
//                  1.2u and the body stays inside its own lane.
//   • 0.45 of either adjacent leg — so two neighbouring fillets can never
//                  overlap and eat a segment.
//
// THE CUT IS THE WHOLE TRADE, and it was swept, not guessed. A physically ideal
// 90° corner wants R = 11u, which is a 4.56u cut; measured on the fixture that
// swung the body far enough out of its lane to take body-overlap pair-samples
// from 2043 to 2983 while only improving crab from 2244 to 1380 bad steps. At
// 1.2u the cut buys 2244 → 1831 for +63 overlap. Going further needs wider
// intersection boxes in the site plan, not a bigger number here.
const CORNER_R = 11;
const CORNER_MAX_CUT = 1.2;
const CORNER_STEP = 1.2;  // arc sampling pitch (u)

/** Replace each INTERIOR vertex with a tangent circular arc. The first and last
 *  points are physical positions (where the car is, and the exact spot it must
 *  reach) and are never moved. Degenerate corners fall through unchanged. */
export function roundCorners(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length - 1; i++) {
    const P = pts[i - 1], V = pts[i], N = pts[i + 1];
    const ux = V.x - P.x, uy = V.y - P.y, ul = Math.hypot(ux, uy);
    const wx = N.x - V.x, wy = N.y - V.y, wl = Math.hypot(wx, wy);
    if (ul < 1e-6 || wl < 1e-6) { out.push({ x: V.x, y: V.y }); continue; }
    const u = { x: ux / ul, y: uy / ul }, w = { x: wx / wl, y: wy / wl };
    const dot = Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y));
    const phi = Math.acos(dot);                     // deflection at the vertex
    if (phi < 0.05) { out.push({ x: V.x, y: V.y }); continue; } // effectively straight
    const half = phi / 2;
    const tanH = Math.tan(half), secH = 1 / Math.cos(half);
    // tangent length, bounded by radius, by the permitted cut, and by the legs
    let t = CORNER_R * tanH;
    if (secH > 1.0001) t = Math.min(t, (CORNER_MAX_CUT * tanH) / (secH - 1));
    t = Math.min(t, 0.45 * ul, 0.45 * wl);
    const R = t / tanH;
    const cross = u.x * w.y - u.y * w.x;
    if (!Number.isFinite(t) || !Number.isFinite(R) || t < 0.2 || Math.abs(cross) < 1e-9) {
      out.push({ x: V.x, y: V.y });                 // straight or unusable — keep the vertex
      continue;
    }
    const sgn = Math.sign(cross);
    const A = { x: V.x - u.x * t, y: V.y - u.y * t };
    const B = { x: V.x + w.x * t, y: V.y + w.y * t };
    // arc centre: perpendicular to the entry tangent at A, on the turn side
    const C = { x: A.x - u.y * R * sgn, y: A.y + u.x * R * sgn };
    const a0 = Math.atan2(A.y - C.y, A.x - C.x);
    const a1 = Math.atan2(B.y - C.y, B.x - C.x);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) * R) / CORNER_STEP));
    out.push(A);
    for (let k = 1; k < steps; k++) {
      const ang = a0 + (sweep * k) / steps;
      out.push({ x: C.x + Math.cos(ang) * R, y: C.y + Math.sin(ang) * R });
    }
    out.push(B);
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  // drop points the rounding collapsed onto each other
  const clean: Pt[] = [];
  for (const p of out) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-3) clean.push(p);
  }
  return clean.length >= 2 ? clean : pts.map((p) => ({ x: p.x, y: p.y }));
}

export function buildRail(
  raw: Pt[],
  nodePositions: Iterable<{ id: string; x: number; y: number }>,
  mouthKey: string | null,
): Rail {
  const pts = roundCorners(raw);
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
    if (best <= NODE_MATCH * NODE_MATCH) nodes.push({ id: n.id, s: bestS });
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

// ── JUNCTIONS: WHO MAY BE IN THE BOX TOGETHER ──────────────────────────────
// Every LaneGraph node used to be an EXCLUSIVE lock: one car in it at a time,
// whatever each car was doing there. On a divided road that serialises traffic
// that cannot touch — the eastbound and westbound streams run 2 x rightOffset =
// 6.4u apart through every junction on the south and north collectors, and the
// inner and outer paths round a ring corner never meet — and it makes every
// follower wait for its leader to clear NODE_RELEASE before it may enter behind
// it. That is the founder's "hesitating and stopping when they meet one another
// at intersections and in passing" (2026-09-22), and on the busy_day replay it
// is the SW corner queueing a departure wave one car at a time.
//
// A junction now admits any set of cars whose MOVEMENTS through it are
// compatible. A movement is the car's own rail swept across the box. Two that
// share an APPROACH are a queue, which IDM spaces. Two from different approaches
// into one exit are a merge and take turns. Any other pair — the opposing stream
// of a divided road, the inner and outer paths round a corner, a turn that stays
// clear of a through lane — conflicts only if the drawn bodies swept along both
// paths would touch somewhere.
const BOX = 10.5;        // half-length of the swept window (u): lane offset 3.2 +
                         // half-width 2.1 + half-length 5.1, so a body entirely
                         // outside it cannot be touching anything in the box
const SWEEP_STEP = 1;    // sampling pitch of a sweep (u)
const BODY_MARGIN = 0.3; // clearance kept between two bodies sharing a box (u)
const SAME_TOL = 1.5;    // a sweep's end lies ON another's path within this
const SAME_DIR = 0.9;    // …and points the same way (cos 25°)

/** One car's path through one junction: its rail sampled across the box. */
export interface Sweep { x: number[]; y: number[]; hx: number[]; hy: number[] }

function sweepOf(r: Rail, nodeS: number): Sweep {
  const sw: Sweep = { x: [], y: [], hx: [], hy: [] };
  const s0 = Math.max(0, nodeS - BOX), s1 = Math.min(r.total, nodeS + BOX);
  for (let s = s0; s <= s1 + 1e-9; s += SWEEP_STEP) {
    const p = pointAt(r.pts, r.cum, s);
    sw.x.push(p.x); sw.y.push(p.y); sw.hx.push(Math.cos(p.heading)); sw.hy.push(Math.sin(p.heading));
  }
  return sw;
}

/** Does sample i of A lie on B's path, pointing the same way? */
function onPath(A: Sweep, i: number, B: Sweep): boolean {
  for (let j = 0; j < B.x.length; j++) {
    const dx = A.x[i] - B.x[j], dy = A.y[i] - B.y[j];
    if (dx * dx + dy * dy < SAME_TOL * SAME_TOL && A.hx[i] * B.hx[j] + A.hy[i] * B.hy[j] > SAME_DIR) return true;
  }
  return false;
}

/** May two movements be in the same junction at once? */
export function movementsConflict(A: Sweep, B: Sweep): boolean {
  if (!A.x.length || !B.x.length) return false;
  const a1 = A.x.length - 1, b1 = B.x.length - 1;
  // same approach: a queue through the junction (or one of them turning off it).
  // Serialising the diverge case too was measured and is WORSE (busy_day overlap
  // 95 -> 103, the live burst's wedged samples 1 -> 49): the follower waits at
  // the bar with the queue backing up behind it.
  if (onPath(A, 0, B) || onPath(B, 0, A)) return false;
  // different approaches, same exit: a merge
  if (onPath(A, a1, B) || onPath(B, b1, A)) return true;
  // otherwise they conflict only where their BODIES would actually touch: the
  // drawn 10.2 x 4.2 body at every sampled pose of one against every sampled pose
  // of the other. Centre distance alone is the wrong test here for the same reason
  // replay.ts gives: two bodies meeting at an angle touch with their centres well
  // over a body-width apart (measured: +8 crossing contacts with a 5u centre test).
  const R2 = (CAR_BODY_LENGTH + 2 * BODY_MARGIN) ** 2;
  for (let i = 0; i <= a1; i++) {
    for (let j = 0; j <= b1; j++) {
      const dx = A.x[i] - B.x[j], dy = A.y[i] - B.y[j];
      if (dx * dx + dy * dy > R2) continue; // too far apart for any orientation to touch
      if (bodiesTouch(A.x[i], A.y[i], A.hx[i], A.hy[i], B.x[j], B.y[j], B.hx[j], B.hy[j])) return true;
    }
  }
  return false;
}

/** Separating-axis test on two drawn bodies (CAR_BODY_LENGTH x CAR_BODY_WIDTH),
 *  each grown by BODY_MARGIN on every side. (hx, hy) is the unit heading. */
function bodiesTouch(ax: number, ay: number, ahx: number, ahy: number,
                     bx: number, by: number, bhx: number, bhy: number): boolean {
  const hl = CAR_BODY_LENGTH / 2 + BODY_MARGIN, hw = CAR_BODY_WIDTH / 2 + BODY_MARGIN;
  const dx = bx - ax, dy = by - ay;
  const axes = [[ahx, ahy], [-ahy, ahx], [bhx, bhy], [-bhy, bhx]];
  for (const [ux, uy] of axes) {
    const ra = Math.abs(ahx * ux + ahy * uy) * hl + Math.abs(-ahy * ux + ahx * uy) * hw;
    const rb = Math.abs(bhx * ux + bhy * uy) * hl + Math.abs(-bhy * ux + bhx * uy) * hw;
    if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
  }
  return true;
}

/** Shared lock boards (one per driver instance). */
export class RailLocks {
  /** junction id → the cars inside (or committed to) it, each with its movement */
  junctions = new Map<string, Map<string, Sweep>>();
  mouths = new Map<string, string>(); // mouthKey → carId

  /** The first car in `node` whose movement conflicts with `sweep`, or null. */
  conflictAt(node: string, carId: string, sweep: Sweep): string | null {
    const inside = this.junctions.get(node);
    if (!inside) return null;
    for (const [other, sw] of inside) {
      if (other !== carId && movementsConflict(sweep, sw)) return other;
    }
    return null;
  }
  /** Enter (or confirm being in) a junction; false when a conflicting car is in it.
   *  `force` admits regardless — for a car whose body is already inside. */
  enter(node: string, carId: string, sweep: Sweep, force = false): boolean {
    const inside = this.junctions.get(node);
    if (inside?.has(carId)) return true;
    if (!force && this.conflictAt(node, carId, sweep)) return false;
    if (inside) inside.set(carId, sweep);
    else this.junctions.set(node, new Map([[carId, sweep]]));
    return true;
  }
  holds(node: string, carId: string): boolean {
    return !!this.junctions.get(node)?.has(carId);
  }
  leave(node: string, carId: string) {
    const inside = this.junctions.get(node);
    if (!inside) return;
    inside.delete(carId);
    if (!inside.size) this.junctions.delete(node);
  }

  /** try to hold (or confirm holding) a single-occupancy lock; true if held */
  acquire(board: Map<string, string>, key: string, carId: string): boolean {
    const cur = board.get(key);
    if (cur === undefined) { board.set(key, carId); return true; }
    return cur === carId;
  }
  releaseAll(carId: string) {
    for (const [k, inside] of this.junctions) {
      if (inside.delete(carId) && !inside.size) this.junctions.delete(k);
    }
    for (const [k, v] of this.mouths) if (v === carId) this.mouths.delete(k);
  }
}

/** The id of a STOPPED body on my path within BOX_EXIT past the node at `nodeS`, or
 *  null. Parked bodies count; a moving body counts only while below walking pace,
 *  and one heading against my path never does (it is passing, not queued). */
function stoppedBodyPast(id: string, r: Rail, nodeS: number, bodies: RailBody[]): string | null {
  const end = Math.min(r.total, nodeS + BOX_EXIT);
  for (let s = Math.max(r.s + SAMPLE, nodeS); s <= end; s += SAMPLE) {
    const p = pointAt(r.pts, r.cum, s);
    for (const b of bodies) {
      if (b.id === id) continue;
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy > LANE_HALF * LANE_HALF) continue;
      if (b.moving) {
        if (b.heading !== undefined && Math.cos(b.heading - p.heading) < ONCOMING_DOT) continue;
        if ((b.speed ?? 0) >= 0.5) continue;
      }
      return b.id;
    }
  }
  return null;
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
  let limiterId: string | null = null;
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
      // the junction control (below), so braking for it here was the pass-freeze
      // / ingress pileup. A parked (non-moving) body always blocks.
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
      if (d - CAR_BODY_LENGTH < gap) { gap = d - CAR_BODY_LENGTH; limiterId = b.id; }
    }
    if (gap < Infinity) break; // nearest sample wins; no need to look further
  }
  let limiter: Rail["limiter"] = gap < Infinity ? "body" : null;

  // 1b) GAP ACCEPTANCE for a car joining traffic from off the road. A stall exit
  // joins a live lane mid-segment, where no junction serialises anything, and the
  // lane's own traffic cannot see the joining car until it is already inside the
  // 1.7u band — so without this the two merged side by side (measured: +14
  // same-direction body contacts on busy_day once exits joined lanes directly).
  // The joining car yields to any car in that lane which is at, or bearing down
  // on, the join point.
  if (r.merge && !r.merge.committed) {
    const m = r.merge;
    let busy: string | null = null;
    for (const b of bodies) {
      if (b.id === id || b.heading === undefined) continue;
      const along = (b.x - m.x) * m.hx + (b.y - m.y) * m.hy;
      const lat = Math.abs((b.x - m.x) * -m.hy + (b.y - m.y) * m.hx);
      if (lat >= MERGE_LAT) continue;
      if (b.reversing) {
        // a car backing into the very spot I am joining at
        if (Math.abs(along) < CAR_BODY_LENGTH) { busy = b.id; break; }
        continue;
      }
      if (!b.moving) continue;
      if (Math.cos(b.heading) * m.hx + Math.sin(b.heading) * m.hy < 0.7) continue; // not in this lane's flow
      if ((b.speed ?? 0) >= 0.5) {
        if (along > -MERGE_BACK && along < CAR_BODY_LENGTH) { busy = b.id; break; }
      } else if (Math.abs(along) < CAR_BODY_LENGTH && id > b.id) {
        // another car starting at the same spot (two exits side by side): the
        // lower id goes first — a deterministic order, or both wait for ever
        busy = b.id; break;
      }
    }
    if (busy) {
      if (0 < gap) { gap = 0; limiter = "merge"; limiterId = busy; }
    } else m.committed = true;
  }

  // 2) junctions: be admitted to the next one, or wait at its stop bar
  for (const n of r.nodes) {
    const dist = n.s - r.s;
    if (dist < -NODE_RELEASE) {
      locks.leave(n.id, id); // passed → out of the box
      continue;
    }
    if (dist > NODE_SEE) break;
    if (locks.holds(n.id, id)) continue; // already admitted; look at the next one
    const sweep = (n.sweep ??= sweepOf(r, n.s));
    // ALREADY IN THE BOX: a car past its own stop point cannot wait outside a
    // junction it is standing in — refusing it only deadlocks it against whoever
    // was admitted around it (measured: a car re-routed mid-junction on the live
    // recording waited on a car that was itself waiting on its body, for good).
    // Admit it, so every other car sees it and yields to it instead.
    if (dist < NODE_STOP + 4) { locks.enter(n.id, id, sweep, true); continue; }
    // Seen from NODE_SEE out, a junction held against me is a stop bar, so the car
    // eases down to it instead of finding out at NODE_CLAIM and stopping in a metre.
    const blocker = locks.conflictAt(n.id, id, sweep);
    // A holder that is itself stopped waiting on ME — my body in its path, or a
    // junction I hold — will never clear the box while I wait for it: that is a
    // deadlock, not a queue. Measured on the live burst: a car finished a back-out
    // in the path of a car already admitted to SE and the two waited on each other
    // for the rest of the run; and on the live recording two cars each held one of
    // S_in / Sg3 (20u apart) and waited for the other. Go; it follows me out.
    // (Admitting junctions that close together as a pair was tried first and
    // measured worse — it holds the second box from 30u out.)
    if (blocker && bodies.some((b) => b.id === blocker && b.waitsOn === id)) {
      locks.enter(n.id, id, sweep, true);
      continue;
    }
    const stopped = blocker ? null : stoppedBodyPast(id, r, n.s, bodies);
    if (blocker || stopped) {
      const g = Math.max(0, dist - NODE_STOP);
      if (g < gap) { gap = g; limiter = "node"; limiterId = blocker ?? stopped; }
      break; // can't pass this node; nothing beyond matters
    }
    if (dist > NODE_CLAIM) break; // clear so far, but not close enough to commit yet
    locks.enter(n.id, id, sweep);
  }

  // 3) charger-column mouth: one car in the final stretch at a time
  if (r.mouthKey && r.total - r.s < MOUTH_ZONE + LOOK) {
    const intoMouth = r.total - r.s - MOUTH_ZONE; // distance until the zone starts
    if (!locks.acquire(locks.mouths, r.mouthKey, id)) {
      const g = Math.max(0, intoMouth);
      if (g < gap) { gap = g; limiter = "mouth"; limiterId = locks.mouths.get(r.mouthKey) ?? null; }
    }
  }
  r.limiter = limiter;
  r.limiterId = limiterId;

  // 4) IDM speed + advance along the rail
  const accel = idmAccel(r.v, Math.max(0, gap), 0);
  // T4: the contract's pace is a CEILING layered on top of the physics ceiling.
  // Traffic (IDM gap), junctions and the mouth lock all clamp v downward below
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
