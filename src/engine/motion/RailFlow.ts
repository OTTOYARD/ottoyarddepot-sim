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
import { CAR_LENGTH } from "./traffic";
import { idmAccel } from "./idm";

export interface RailBody { id: string; x: number; y: number; }

export interface Rail {
  pts: Pt[];
  cum: number[];          // cumulative arc length at each vertex
  total: number;
  nodes: { id: string; s: number }[]; // graph intersections along this route
  s: number;              // arc position
  v: number;              // speed (u/s)
  mouthKey: string | null; // charger-column mouth this route ends in (if any)
  stationaryFor: number;  // watchdog: seconds at ~zero speed
}

const LANE_HALF = 1.7;    // half-width that counts as "in my path"
const LOOK = 26;          // forward window (u)
const SAMPLE = 2;         // projection sampling step (u)
const NODE_CLAIM = 12;    // start trying to hold a node this far out
const NODE_STOP = 4;      // stop bar distance before an unheld node
const NODE_RELEASE = 10;  // release once this far past
const MOUTH_ZONE = 18;    // column mouth = final stretch of the route
const MAX_SPEED = 8;

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
  return { pts, cum, total, nodes, s: 0, v: 0, mouthKey, stationaryFor: 0 };
}

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
  const maxAhead = Math.min(LOOK, r.total - r.s);
  for (let d = SAMPLE; d <= maxAhead; d += SAMPLE) {
    const p = pointAt(r.pts, r.cum, r.s + d);
    for (const b of bodies) {
      if (b.id === id) continue;
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy <= LANE_HALF * LANE_HALF) {
        gap = Math.min(gap, d - CAR_LENGTH * 0.55);
      }
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
  r.v = Math.max(0, Math.min(MAX_SPEED, r.v + accel * dt));
  // ease to a stop exactly at the route end
  r.v = Math.min(r.v, Math.sqrt(2 * 7 * Math.max(0, r.total - r.s)));
  r.s += r.v * dt;
  r.stationaryFor = r.v < 0.05 ? r.stationaryFor + dt : 0;

  if (r.s >= r.total - 0.3) return null; // arrived — caller docks/snaps
  return pointAt(r.pts, r.cum, r.s);
}
