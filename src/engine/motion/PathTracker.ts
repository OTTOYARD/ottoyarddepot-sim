// ============================================================================
// PathTracker — pure-pursuit lateral control over a lane polyline.
//
// Given a car pose and a path (the lane waypoints from the LaneGraph/sitePlan),
// it returns the STEERING ANGLE that steers the car along the path, plus how far
// is left. Feed that steering into KinematicCar.step() and the car follows the
// lane on real arcs — it never teleport-rotates and never slides.
//
// Pure pursuit: aim at a look-ahead point Ld ahead on the path and steer onto the
// arc that reaches it:  δ = atan2( 2·L·sin(α), Ld ),  where α is the angle from
// the car's heading to the look-ahead point and L is the wheelbase. Ld grows with
// speed (k·v + Ld_min) so it's stable at speed and tight when crawling.
//
// A monotonic arc-length cursor (`s`) makes it robust on the depot's looping,
// self-approaching routes: we only ever project the car FORWARD within a small
// window, so a lane that doubles back near itself can't snap the cursor backward.
//
// Ref: Coulter, "Implementation of the Pure Pursuit Path Tracking Algorithm"
// (CMU 1992); Ding, "Three Methods of Vehicle Lateral Control".
// ============================================================================
import type { Pose } from "./KinematicCar";
import { wrapAngle } from "./KinematicCar";

export interface Pt {
  x: number;
  y: number;
}

export interface SteerResult {
  /** Steering angle command δ (rad) for KinematicCar.step. */
  steer: number;
  /** The look-ahead point aimed at (for debug/render). */
  target: Pt;
  /** Arc-length distance from the car's projection to the end of the path. */
  remaining: number;
  /** Cross-track error (signed lateral distance to the path) — for diagnostics. */
  crossTrack: number;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class PathTracker {
  readonly path: Pt[];
  /** cumulative arc length at each vertex; cum[i] = length from path[0]..path[i]. */
  private cum: number[] = [];
  readonly total: number;
  /** monotonic progress cursor (arc length) — only advances. */
  private s = 0;

  constructor(path: Pt[]) {
    // De-duplicate consecutive identical points (zero-length segments break math).
    const clean: Pt[] = [];
    for (const p of path) {
      if (!clean.length || dist(clean[clean.length - 1], p) > 1e-6) clean.push({ x: p.x, y: p.y });
    }
    if (clean.length === 0) clean.push({ x: 0, y: 0 });
    if (clean.length === 1) clean.push({ x: clean[0].x + 1e-3, y: clean[0].y });
    this.path = clean;
    this.cum = [0];
    for (let i = 1; i < clean.length; i++) this.cum.push(this.cum[i - 1] + dist(clean[i - 1], clean[i]));
    this.total = this.cum[this.cum.length - 1];
  }

  /** Interpolate the path point at arc length `arc` (clamped to [0, total]). */
  pointAtArc(arc: number): Pt {
    arc = arc < 0 ? 0 : arc > this.total ? this.total : arc;
    // binary-ish linear scan (paths are short — a handful of legs)
    let i = 1;
    while (i < this.cum.length && this.cum[i] < arc) i++;
    if (i >= this.cum.length) return { ...this.path[this.path.length - 1] };
    const segLen = this.cum[i] - this.cum[i - 1] || 1e-6;
    const t = (arc - this.cum[i - 1]) / segLen;
    const a = this.path[i - 1];
    const b = this.path[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /**
   * Advance the progress cursor to the car's projection on the path (searching
   * only FORWARD from the current cursor within `window` units) and return the
   * signed cross-track error. Monotonic ⇒ robust on looping routes.
   */
  private projectForward(pose: Pose, window = 24): number {
    let bestArc = this.s;
    let bestD2 = Infinity;
    // sample the path from current cursor forward by `window`, fine step
    const stepLen = 0.75;
    const end = Math.min(this.total, this.s + window);
    for (let arc = this.s; arc <= end + 1e-6; arc += stepLen) {
      const p = this.pointAtArc(arc);
      const d2 = (p.x - pose.x) ** 2 + (p.y - pose.y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestArc = arc;
      }
    }
    this.s = bestArc;
    // signed cross-track: left of the path heading is positive
    const ahead = this.pointAtArc(Math.min(this.total, bestArc + 0.5));
    const here = this.pointAtArc(bestArc);
    const pathHeading = Math.atan2(ahead.y - here.y, ahead.x - here.x);
    const dx = pose.x - here.x;
    const dy = pose.y - here.y;
    // perpendicular (left of path) component = signed cross-track error
    return -Math.sin(pathHeading) * dx + Math.cos(pathHeading) * dy;
  }

  /**
   * Pure-pursuit steering command for the current pose + speed.
   * `lookahead = k*speed + min` — pass the already-computed look-ahead distance.
   */
  steer(pose: Pose, lookahead: number, wheelbase: number): SteerResult {
    const crossTrack = this.projectForward(pose);
    const Ld = Math.max(lookahead, 1.5);
    const targetArc = Math.min(this.total, this.s + Ld);
    const target = this.pointAtArc(targetArc);

    const dx = target.x - pose.x;
    const dy = target.y - pose.y;
    const ld = Math.hypot(dx, dy) || 1e-6;
    // α = angle from heading to the look-ahead point
    const alpha = wrapAngle(Math.atan2(dy, dx) - pose.heading);
    // pure-pursuit curvature → steering angle
    const steer = Math.atan2(2 * wheelbase * Math.sin(alpha), ld);

    return { steer, target, remaining: this.total - this.s, crossTrack };
  }

  /** Arc length already covered. */
  get progress(): number {
    return this.s;
  }
  /** True once the cursor has reached (within eps of) the path end. */
  atEnd(eps = 1.6): boolean {
    return this.total - this.s <= eps;
  }
}
