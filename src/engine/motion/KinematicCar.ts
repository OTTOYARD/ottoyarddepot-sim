// ============================================================================
// KinematicCar — the rear-axle KINEMATIC BICYCLE MODEL.
//
// This is the single change that makes vehicle motion physically car-like and
// makes the old "lateral slide" mathematically impossible.
//
// A car is non-holonomic: it can ONLY move in the direction it is pointing, and
// it changes heading ONLY by steering. The bicycle model encodes exactly that:
//
//     x'      = v · cos(θ)            position advances ONLY along the heading
//     y'      = v · sin(θ)            (there is NO lateral velocity term)
//     θ'      = v · tan(δ) / L        heading turns ONLY via steering angle δ
//     v'      = a
//
// Because (x', y') is always parallel to (cosθ, sinθ), the body cannot crab or
// slide sideways the way a holonomic steering-force agent (Yuka) does. Clamping
// |δ| ≤ δmax gives a minimum turn radius R = L/tan(δmax), so a "turn right" is a
// real arc of believable radius rather than a pivot-in-place or a slide.
//
// Coordinates are the sitePlan LOGICAL 2D frame: x = west→east (0..300),
// y = north→south (0..220), 1 unit ≈ 1.57 ft. Heading θ is radians, measured
// from +x (east), CCW positive — so VehicleDot's atan2(dy,dx) convention and the
// 3D toWorld mapping both consume `heading` directly.
//
// Refs: rear-axle kinematic bicycle model — Algorithms-for-Automated-Driving
// (thomasfermi), OMSCS robotics notes; the standard model behind pure-pursuit
// and Stanley lateral control.
// ============================================================================

export interface Pose {
  x: number;
  y: number;
  heading: number; // radians, 0 = +x (east), CCW positive
}

export interface CarParams {
  /** Wheelbase L (logical units). Drives the turn radius. */
  wheelbase: number;
  /** Max steering angle δmax (radians). R_min = L / tan(δmax). */
  maxSteer: number;
  /** How fast the wheels can turn, dδ/dt (rad/s). Makes steering visible, not instant. */
  steerRate: number;
  /** Forward speed cap (u/s). ~13 u/s ≈ 14 mph depot taxi. */
  maxSpeed: number;
  /** Reverse speed cap (positive u/s) — used only for back-out maneuvers. */
  maxReverseSpeed: number;
  /** Comfortable acceleration (u/s²). */
  maxAccel: number;
  /** Comfortable deceleration (u/s²) — firmer than accel. */
  maxDecel: number;
}

/** Realistic defaults for a depot robotaxi in logical units (1u ≈ 1.57 ft). */
export const DEFAULT_CAR_PARAMS: CarParams = {
  wheelbase: 6,        // ~9.4 ft
  maxSteer: 0.5,       // 28.6° → R_min = 6/tan(0.5) ≈ 11 u ≈ 17 ft (realistic)
  steerRate: 1.6,      // wheels swing to full lock in ~0.3 s
  maxSpeed: 13,        // ≈ 14 mph
  maxReverseSpeed: 5,  // slow, careful reverse
  maxAccel: 5,
  maxDecel: 9,
};

const TWO_PI = Math.PI * 2;
/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a <= -Math.PI) a += TWO_PI;
  return a;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class KinematicCar {
  x: number;
  y: number;
  heading: number;
  /** Signed speed: positive = forward, negative = reverse. */
  speed = 0;
  /** Current steering angle δ (rad). Rate-limited toward the command. */
  steer = 0;
  readonly params: CarParams;

  constructor(pose: Pose, params: CarParams = DEFAULT_CAR_PARAMS) {
    this.x = pose.x;
    this.y = pose.y;
    this.heading = pose.heading;
    this.params = params;
  }

  get pose(): Pose {
    return { x: this.x, y: this.y, heading: this.heading };
  }

  /** Minimum turn radius R = L / tan(δmax) in logical units. */
  minTurnRadius(): number {
    return this.params.wheelbase / Math.tan(this.params.maxSteer);
  }

  /**
   * Advance the kinematics by `dt` seconds toward a desired speed and a desired
   * steering angle. Steering is rate-limited (visible wheel turn) and clamped to
   * ±maxSteer; speed is acceleration/deceleration-limited; then the rear-axle
   * bicycle model is integrated. No lateral term ⇒ no slide, ever.
   */
  step(dt: number, desiredSpeed: number, desiredSteer: number): void {
    const p = this.params;

    // --- steering: ramp toward the command at steerRate, clamp to lock ---
    const targetSteer = clamp(desiredSteer, -p.maxSteer, p.maxSteer);
    const maxDSteer = p.steerRate * dt;
    this.steer += clamp(targetSteer - this.steer, -maxDSteer, maxDSteer);

    // --- speed: accel toward the command, limited by accel/decel ---
    const targetSpeed = clamp(desiredSpeed, -p.maxReverseSpeed, p.maxSpeed);
    const dv = targetSpeed - this.speed;
    // accelerating = growing |speed| in the current travel direction; else braking
    const speedingUp = Math.abs(targetSpeed) > Math.abs(this.speed) && Math.sign(targetSpeed || this.speed) === Math.sign(this.speed || targetSpeed);
    const lim = (speedingUp ? p.maxAccel : p.maxDecel) * dt;
    this.speed += clamp(dv, -lim, lim);
    if (Math.abs(this.speed) < 1e-4) this.speed = 0;

    // --- integrate the rear-axle kinematic bicycle (Euler) ---
    // Sub-step at high speed to keep the arc accurate (cheap; a few iters max).
    const dist = Math.abs(this.speed) * dt;
    const steps = dist > 1.5 ? Math.ceil(dist / 1.5) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.x += this.speed * Math.cos(this.heading) * h;
      this.y += this.speed * Math.sin(this.heading) * h;
      this.heading = wrapAngle(this.heading + (this.speed * Math.tan(this.steer) / p.wheelbase) * h);
    }
  }
}
