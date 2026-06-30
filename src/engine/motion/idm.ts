// ============================================================================
// idm.ts — the Intelligent Driver Model (longitudinal car-following).
//
// This is what makes cars keep a realistic following gap, decelerate smoothly,
// and QUEUE single-file behind a leader or a stopped car — and never stack.
// It is collision-free by construction: as the gap closes toward the desired
// minimum, the braking term grows without bound, so the follower is forced to
// slow before contact.
//
//     a_IDM = a · [ 1 − (v/v0)^δ − ( s*(v,Δv) / gap )² ]
//     s*    = s0 + max(0,  v·T + v·Δv / (2·√(a·b)) )
//
//   v   = own speed,  gap = bumper-to-bumper distance to leader,
//   Δv  = v − v_leader (approach rate, positive when closing),
//   v0  = desired speed, T = safe time headway, s0 = jam gap,
//   a   = max accel, b = comfortable decel, δ = accel exponent (4).
//
// Built directly from the equations (Treiber, Hennecke, Helbing, Phys. Rev. E 62,
// 1805, 2000) — NOT copied from the GPL traffic-simulation.de source — so it is
// clean to ship in a proprietary product. Tuned here for low depot speeds.
// ============================================================================

export interface IDMParams {
  v0: number; // desired (free-road) speed, u/s
  T: number;  // safe time headway, s
  a: number;  // max acceleration, u/s²
  b: number;  // comfortable deceleration, u/s²
  s0: number; // minimum jam gap (bumper-to-bumper at standstill), u
  delta: number; // acceleration exponent
}

/** Depot-tuned IDM: slow speeds, tight-but-safe gaps so cars queue without overlap. */
export const DEFAULT_IDM: IDMParams = {
  v0: 13,   // matches the car's free-road cruise (≈14 mph)
  T: 1.2,   // 1.2 s headway
  a: 4.5,   // gentle pickup
  b: 7,     // comfortable braking
  s0: 5,    // ~8 ft standstill gap (a car length-ish) — visible, no overlap
  delta: 4,
};

/**
 * IDM acceleration given the leader. `gap` is bumper-to-bumper (already
 * accounting for vehicle lengths); `leaderSpeed` the leader's speed. Pass
 * gap = Infinity (or call freeRoadAccel) when there is no leader.
 */
export function idmAccel(
  v: number,
  gap: number,
  leaderSpeed: number,
  p: IDMParams = DEFAULT_IDM,
): number {
  const free = 1 - Math.pow(Math.max(v, 0) / p.v0, p.delta);
  if (!isFinite(gap) || gap >= 1e6) {
    return p.a * free;
  }
  const dv = v - leaderSpeed; // approach rate (positive = closing)
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const g = Math.max(gap, 0.05); // guard divide-by-zero when nearly touching
  const interaction = (sStar / g) ** 2;
  return p.a * (free - interaction);
}

/** Free-road acceleration (no leader) — accelerate toward v0. */
export function freeRoadAccel(v: number, p: IDMParams = DEFAULT_IDM): number {
  return p.a * (1 - Math.pow(Math.max(v, 0) / p.v0, p.delta));
}

/**
 * A "virtual leader" for a fixed stop line (a reserved stall entry, a closed
 * merge, or the path end): model it as a stationary leader at `gapToStop`. This
 * is how a car eases to a precise halt at a reservation boundary using the same
 * collision-free math.
 */
export function stopAccel(v: number, gapToStop: number, p: IDMParams = DEFAULT_IDM): number {
  return idmAccel(v, gapToStop, 0, p);
}
