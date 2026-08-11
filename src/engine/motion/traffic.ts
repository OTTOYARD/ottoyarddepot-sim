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

/**
 * THE BODY. Plan units, at 0.4785 m/unit → 4.88 m x 2.01 m, a real robotaxi
 * footprint. This is the ONE definition of how much room a car takes up, and
 * every following-gap budget in this engine is derived from it.
 *
 * It exists because the gap budget and the drawn body had drifted apart. The
 * cockpit draws 4.2 x 10.2 (VehicleDot.tsx) and the fixture's body-overlap
 * metric measures those same dimensions, while RailFlow budgeted a following
 * gap of `CAR_LENGTH * 0.55` = 4.125 u. Add IDM's s0 jam gap of 5 u and a
 * stopped queue settled at 9.125 u centre-to-centre — 1.075 u INSIDE a 10.2 u
 * body. Queued cars therefore overlapped permanently while perfectly straight
 * and perfectly stopped; the busy_day fixture measured 4063 overlap
 * pair-samples, 3560 of them between two MOVING cars.
 *
 * Keep this equal to what the cockpit draws. RailFlow.test.ts pins it to the
 * dimensions the overlap metric measures so the two literals cannot drift
 * apart again silently — that duplication, not the number, was the bug.
 */
export const CAR_BODY_LENGTH = 10.2;
/** Stated so the footprint has ONE home and the drift pin can check both axes.
 *  Nothing budgets FOLLOWING GAPS laterally off it: RailFlow's LANE_HALF is a
 *  lane-discipline band, not a body half-width, and widening it to 2.1/2.6/3.2
 *  was measured on the busy_day fixture and made overlap WORSE (1223 → 1366 /
 *  1398 / 1684 pair-samples) because more braking parks more cars in the
 *  corridor. It IS the drawn width, in both the 2D cockpit and the 3D mesh, and
 *  therefore the flank plane the OTTO-CHARGE ARM reaches for — see CAR_WIDTH. */
export const CAR_BODY_WIDTH = 4.2;

/**
 * ONE ROBOTAXI, ONE SIZE. These are ALIASES, not a second opinion.
 *
 * They used to be a separate, smaller car: CAR_LENGTH = 7.5 and
 * CAR_WIDTH = 2.2 * (7.5 / 4.9) = 3.3673, i.e. 3.59 m x 1.61 m. That was the
 * "3D mesh scale seed", and it meant the three.js body was drawn 26% shorter
 * and 20% narrower than the body this traffic model reserves and the cockpit
 * paints. A gap that looked correct in 2D looked wrong in 3D and vice versa,
 * and the 3D car was the only one of the three that was not a real vehicle.
 *
 * The mesh now builds to the footprint above. The names survive only because
 * the OTTO-CHARGE ARM package and ChargingArm.tsx import CAR_WIDTH to find the
 * flank plane it aims its standoff at; pointing them at the same constant is
 * the whole point of the unification, so they must NOT be given a value of
 * their own again.
 *
 * MEASURED before shipping this, because widening the body moves that flank
 * plane 0.199 m closer to the DCFC pedestal (near-flank standoff 1.3476 m ->
 * 1.1484 m at the fixed 4.5 pu pedestal offset):
 *   - service window, full sweep at the new standoff: 4949 samples, 0
 *     unreachable — same as before, the arm reaches everything it did.
 *   - far-flank exclusion (the orchestration constraint chargePort.ts rests
 *     on) gets STRONGER: the ARM_SCALE ceiling rises 1.6141 -> 1.7487 because
 *     the far flank moved away.
 *   - stowed clearance to the flank plane drops 0.2344 m -> 0.0352 m. Still
 *     positive, still passes, but it is now the tightest number in the arm
 *     package — see the note in vehicleBody.ts.
 * kinematics.test.ts and depotIntegration.test.ts derive their own geometry
 * from CAR_WIDTH, so both track this automatically; all 26 arm tests pass.
 *
 * ⚠ DO NOT WIDEN THE CAR AGAIN WITHOUT READING THIS. kinematics.test.ts'
 * far-flank test ends with `expect(headroom).toBeLessThan(1.75)` — a sanity
 * bound on the arithmetic, written when headroom was 1.6141. It is 1.748729
 * now, 0.001271 from red. The next increase to CAR_BODY_WIDTH, to ARM_SCALE,
 * or to the pedestal offset turns that into a CI failure whose message talks
 * about the arm reaching across the vehicle, which is NOT what will have gone
 * wrong. That bound needs re-deriving in the arm package (not owned here).
 */
export const CAR_LENGTH = CAR_BODY_LENGTH;
export const CAR_WIDTH = CAR_BODY_WIDTH;

export interface Leader {
  gap: number;        // bumper-to-bumper distance (>=0), Infinity if none
  leaderSpeed: number;
  leaderId: string | null; // who the blocker is (deadlock-cycle detection)
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
  let leaderId: string | null = null;
  for (const o of others) {
    if (o.id === me.id) continue;
    const dx = o.pose.x - me.pose.x;
    const dy = o.pose.y - me.pose.y;
    const fwd = dx * fx + dy * fy;        // projection ahead
    if (fwd <= 0 || fwd > range) continue;
    const lat = Math.abs(dx * -fy + dy * fx); // |perpendicular| component
    if (lat > laneHalf) continue;
    // `fwd` is centre-to-centre along my heading; subtracting one whole body
    // (my front half + the leader's rear half, equal bodies) makes it
    // bumper-to-bumper, which is the units idmAccel() documents for `gap`.
    const gap = fwd - CAR_BODY_LENGTH;
    if (gap < bestGap) {
      bestGap = gap;
      leaderSpeed = o.speed;
      leaderId = o.id;
    }
  }
  return { gap: Math.max(bestGap, 0), leaderSpeed: bestGap === Infinity ? 0 : leaderSpeed, leaderId };
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
  /** Which car holds `stallId`, if any. Lets a refusal name the blocker
   *  ("already held by AV-12") instead of just saying no. */
  holderOf(stallId: string): string | undefined {
    return this.byStall.get(stallId);
  }
  clear() {
    this.byStall.clear();
    this.byCar.clear();
  }
}
