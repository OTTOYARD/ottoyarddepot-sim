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
