// ============================================================================
// traffic.ts — local traffic control: leader-finding, merge yielding, stall ledger.
//
// IDM needs to know each car's LEADER (the nearest car ahead in its own lane).
// We find it by a forward cone: a candidate is a leader if it sits ahead of the
// subject (positive projection on the heading) and within a narrow lateral band
// (≈ lane width) — so cars in adjacent lanes / oncoming offset lanes are ignored
// and only the car genuinely in front counts. This keeps same-lane queues tight
// AND makes a car about to merge see the boulevard car ahead of it.
//
// Merge yielding reuses the SAME collision-free idea: a car approaching a merge
// node that another (priority) car is occupying treats the node as a virtual
// stop line, so it eases to a halt and yields (gap acceptance) instead of T-boning.
// ============================================================================
import type { Pose } from "./KinematicCar";

export interface MovingCar {
  id: string;
  pose: Pose;
  speed: number;
}

/** Logical car length (bumper-to-bumper bookkeeping for the IDM gap). */
export const CAR_LENGTH = 9;

export interface Leader {
  gap: number;        // bumper-to-bumper distance (>=0), Infinity if none
  leaderSpeed: number;
}

/**
 * Nearest car directly ahead of `me` within a forward cone.
 * @param laneHalf  lateral half-width that counts as "same lane" (~lane width/2)
 * @param range     how far ahead to look
 */
export function findLeader(
  me: MovingCar,
  others: Iterable<MovingCar>,
  laneHalf = 3.2,
  range = 34,
): Leader {
  const fx = Math.cos(me.pose.heading);
  const fy = Math.sin(me.pose.heading);
  let bestGap = Infinity;
  let leaderSpeed = 0;
  for (const o of others) {
    if (o.id === me.id) continue;
    const dx = o.pose.x - me.pose.x;
    const dy = o.pose.y - me.pose.y;
    const fwd = dx * fx + dy * fy;        // projection ahead
    if (fwd <= 0 || fwd > range) continue;
    const lat = Math.abs(dx * -fy + dy * fx); // |perpendicular| component
    if (lat > laneHalf) continue;
    const gap = fwd - CAR_LENGTH;
    if (gap < bestGap) {
      bestGap = gap;
      leaderSpeed = o.speed;
    }
  }
  return { gap: Math.max(bestGap, 0), leaderSpeed: bestGap === Infinity ? 0 : leaderSpeed };
}

/**
 * Local avoidance — a GENTLE steering nudge away from any car that gets within
 * `radius`, on top of the lane pure-pursuit. This is the thin local-avoidance
 * layer (Reynolds separation, mapped to steering so it respects the car
 * kinematics) that keeps converging / side-by-side cars from touching WITHOUT
 * shoving them off their lane — the weight is small and it only bites up close.
 * Returns a steering-angle delta (radians) to ADD to the pursuit steer.
 */
export function separationSteer(
  me: MovingCar,
  others: Iterable<MovingCar>,
  radius = 5.5,
  weight = 0.5,
): number {
  let ax = 0;
  let ay = 0;
  let n = 0;
  for (const o of others) {
    if (o.id === me.id) continue;
    const dx = me.pose.x - o.pose.x;
    const dy = me.pose.y - o.pose.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3 || d > radius) continue;
    const w = (radius - d) / radius; // 0 at the edge, 1 when touching
    ax += (dx / d) * w; // sum of away-vectors, weighted by closeness
    ay += (dy / d) * w;
    n++;
  }
  if (!n) return 0;
  // steer from the current heading toward the "away" direction, gently, and only
  // for the sideways component (the leader/IDM handles straight-ahead slowing).
  const away = Math.atan2(ay, ax);
  let diff = (away - me.pose.heading) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  else if (diff <= -Math.PI) diff += Math.PI * 2;
  const clamped = diff < -0.6 ? -0.6 : diff > 0.6 ? 0.6 : diff;
  return clamped * weight;
}

/**
 * Stall ledger — guarantees at most ONE vehicle per stall (no double-booking),
 * the spatial half of the no-stacking guarantee.
 */
export class StallLedger {
  private byStall = new Map<string, string>(); // stallId -> carId
  private byCar = new Map<string, string>();    // carId  -> stallId

  /** Claim `stallId` for `carId` if free (or already theirs). Returns success. */
  claim(carId: string, stallId: string): boolean {
    const holder = this.byStall.get(stallId);
    if (holder && holder !== carId) return false;
    const prev = this.byCar.get(carId);
    if (prev && prev !== stallId) this.byStall.delete(prev);
    this.byStall.set(stallId, carId);
    this.byCar.set(carId, stallId);
    return true;
  }
  /** First free stall from `candidates` (in order), claimed for the car. */
  claimFirstFree(carId: string, candidates: string[]): string | null {
    const mine = this.byCar.get(carId);
    if (mine && candidates.includes(mine)) return mine;
    for (const s of candidates) {
      if (!this.byStall.has(s)) {
        this.claim(carId, s);
        return s;
      }
    }
    return null;
  }
  release(carId: string) {
    const s = this.byCar.get(carId);
    if (s) this.byStall.delete(s);
    this.byCar.delete(carId);
  }
  stallOf(carId: string): string | undefined {
    return this.byCar.get(carId);
  }
  isHeld(stallId: string): boolean {
    return this.byStall.has(stallId);
  }
  clear() {
    this.byStall.clear();
    this.byCar.clear();
  }
}
