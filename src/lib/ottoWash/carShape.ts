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
