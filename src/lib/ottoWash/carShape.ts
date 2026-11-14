/**
 * The fleet car as the wash machine meets it: its top and its flanks, in the BAY's frame
 * and in plan units (washSpec.ts). Read from vehicleEnvelope.ts, the solid the car mesh is
 * built from, so a brush that clears this clears the car on screen.
 *
 * A car in a bay faces north, so a point `dy` plan units SOUTH of the car's centre is
 * `-dy` along the car (the car frame's +x is the nose).
 */
import {
  bevelledBodyProfile, CAR_LENGTH_M, CAR_WIDTH_M, ROOF_POD, tumblehomeScale, BODY_ROOF_M, BODY_BEVEL_M,
} from '@/lib/ottoChargeArm/vehicleEnvelope';
import { METRES_PER_PLAN_UNIT, PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import type { WashSolid } from '@/lib/fleetModels/washSolid';

/** Half the car's length and width, plan u (the body drawn: 9.8 x 4.0). */
export const CAR_HALF_LEN_U = (CAR_LENGTH_M / 2) * PLAN_UNITS_PER_METRE;
export const CAR_HALF_WIDTH_U = (CAR_WIDTH_M / 2) * PLAN_UNITS_PER_METRE;

const PROFILE = bevelledBodyProfile();

/** The body's top above grade at `alongM` metres from the car's centre, metres; null past its ends. */
function profileTopM(alongM: number): number | null {
  let top: number | null = null;
  const n = PROFILE.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = PROFILE[i];
    const [x1, y1] = PROFILE[(i + 1) % n];
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    if (alongM < lo - 1e-9 || alongM > hi + 1e-9) continue;
    const y = hi - lo < 1e-9 ? Math.max(y0, y1) : y0 + ((alongM - x0) / (x1 - x0)) * (y1 - y0);
    if (top === null || y > top) top = y;
  }
  return top;
}

/** The car's top (body or roof pod) at `alongM` metres from its centre, metres; null past its ends. */
export function carTopM(alongM: number): number | null {
  const body = profileTopM(alongM);
  if (body === null) return null;
  return Math.abs(alongM) <= ROOF_POD.radius ? Math.max(body, ROOF_POD.yMax) : body;
}

/** The car's top at `dy` plan units south of its centre, plan u, or null past its ends. */
export function carTopU(dy: number): number | null {
  const m = carTopM(-dy * METRES_PER_PLAN_UNIT);
  return m === null ? null : m * PLAN_UNITS_PER_METRE;
}

/** The car's highest point anywhere, plan u (the roof pod). */
export const CAR_TOP_U = ROOF_POD.yMax * PLAN_UNITS_PER_METRE;

/** The car's half-width at height `yU` plan units, plan u: full width below the tumblehome line, narrower above. */
export function carHalfWidthAtU(yU: number): number {
  return CAR_HALF_WIDTH_U * tumblehomeScale(yU * METRES_PER_PLAN_UNIT);
}

/** The roof's half-width, plan u (where the top brush and the top dryer work). */
export const ROOF_HALF_WIDTH_U = carHalfWidthAtU((BODY_ROOF_M + BODY_BEVEL_M) * PLAN_UNITS_PER_METRE);

/** Is the point (x across, dy along, y up), plan u in the bay frame, inside the car's solid? Conservative box test by slice. */
export function insideCar(x: number, dy: number, y: number): boolean {
  if (Math.abs(dy) > CAR_HALF_LEN_U) return false;
  const top = carTopU(dy);
  if (top === null || y > top || y < 0) return false;
  return Math.abs(x) <= carHalfWidthAtU(y);
}

/**
 * A vehicle's shape as the GANTRY meets it: what its air knives follow and what its frame must clear. Plan units, in
 * the bay's frame. `GENERIC_SHAPE` is the twin's one car. A fleet vehicle's is read from its own solid
 * (`fleetShape`), so the top knife rides over a taller roof and its sensors, and the side knives stand off a wider
 * body, its mirrors and its side pods.
 */
export interface CarShape {
  /** half the vehicle's length */
  halfLenU: number;
  /** half its width, everything on it counted */
  halfWidthU: number;
  /** its highest point */
  topU: number;
  /** its highest point at `dy` south of its centre, or null past its ends */
  topAtU(dy: number): number | null;
  /** half its width where the side knives blow: between their lower and upper ends, and 0.35 m past each */
  sideU: number;
}

export const GENERIC_SHAPE: CarShape = {
  halfLenU: CAR_HALF_LEN_U, halfWidthU: CAR_HALF_WIDTH_U, topU: CAR_TOP_U, topAtU: carTopU, sideU: carHalfWidthAtU(0),
};

/** How far past the side knives' ends a part of the vehicle still sets where they stand, metres. */
export const SIDE_KNIFE_REACH_M = 0.35;

/** A fleet vehicle's shape, from its wash solid (fleetModels/washSolid.ts). `knife`: the side knives' lower and upper ends, plan u. */
export function fleetShape(solid: Pick<WashSolid, 'halfLen' | 'halfWidth' | 'top' | 'topAt' | 'halfWidthIn'>, knife: { y0: number; y1: number }): CarShape {
  const U = PLAN_UNITS_PER_METRE, M = METRES_PER_PLAN_UNIT;
  return {
    halfLenU: solid.halfLen * U, halfWidthU: solid.halfWidth * U, topU: solid.top * U,
    topAtU: (dy) => { const t = solid.topAt(dy * M); return t === null ? null : t * U; },
    sideU: solid.halfWidthIn(knife.y0 * M - SIDE_KNIFE_REACH_M, knife.y1 * M + SIDE_KNIFE_REACH_M) * U,
  };
}
