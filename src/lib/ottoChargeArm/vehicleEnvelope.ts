/**
 * THE FLEET ROBOTAXI AS A SOLID — one shape, two consumers.
 *
 * vehicleBody.ts builds the three.js mesh FROM this file, and the arm's
 * clearance check measures against this file. That is the whole point: the
 * previous footprint attempt was declared safe because 26 arm tests passed,
 * and every one of those tests asked the arm about a plane or a point. NOTHING
 * compared the robot to the car it works on, so a resize that swung the elbow
 * housing through the bodywork looked clean.
 *
 * A clearance number is only worth having if the solid it was measured against
 * is the solid on screen. Deriving both from here is what makes that true by
 * construction rather than by two literals happening to agree.
 *
 * ════════════════════════════════════════════════════════════════ UNITS ═════
 * METRES throughout, like the rest of the arm package. The renderer converts at
 * one place (vehicleBody.planUnits) using PLAN_UNITS_PER_METRE.
 *
 * ═══════════════════════════════════════════════════════════ CONSERVATISM ═══
 * The solid is a SUPERSET of the drawn mesh, deliberately, so "no intersection"
 * is a guarantee and not a sampling artefact:
 *
 *   - the silhouette polygon is grown by the extrude bevel, which is what the
 *     mesh's outer face actually reaches (ExtrudeGeometry's bevel grows the
 *     shape OUTWARD — see vehicleBody.ts) — and it is grown the way the bevel
 *     actually grows it, with MITRED corners. See bevelledBodyProfile();
 *   - the lateral slab is the car's FULL width, so the wheels (which are
 *     inset) and the body (which is narrower than the glazing) are both
 *     covered;
 *   - the wheels are modelled at full width even though they are 0.24 m thick.
 *
 * ═════════════════════════════════════════ WHAT IS AND IS NOT INSIDE IT ══════
 * MEASURED, every vertex of every drawn part, by armClearance.test.ts's
 * "contains every vertex of the drawn car":
 *
 *   body 0.00 mm · glazing 0.00 mm · cladding + roof pod 0.00 mm ·
 *   tyres 0.00 mm · rims -2.50 mm      (max protrusion outside the solid)
 *
 * The body used to read +20.71 mm, at the extreme fore/aft lower corners
 * (along 2.440 m, height 0.210 m). The polygon was grown by a ROUND offset —
 * distance-to-boundary minus the bevel — while ExtrudeGeometry MITRES the
 * corner, and a mitred 90 deg corner stands bevel*(sqrt(2)-1) = 20.71 mm
 * further out than a rounded one.
 *
 * It changed no result: those corners are 2.4 m fore and aft of the pedestal
 * and 0.21 m off the deck, nowhere the arm goes. Every clearance figure in
 * cobotSpec.ts — both tables, the shipped +0.1206 m, the measured safe region —
 * re-measures identically against the corrected solid. Fixed anyway, because
 * this is the one file whose job is to make the claim true by construction, and
 * a guarantee that happens to be harmless where it is broken is still broken.
 *
 * ONE PART IS DELIBERATELY LEFT OUT, and it is the charge port. The drawn
 * socket rim stands 8.66 mm proud of the flank plane and the lit ring 5.20 mm
 * (a torus of tube radius r drawn with 6 radial segments reaches r*sin 60 deg).
 * They are not in the solid because the connector's whole job is to arrive at
 * that ring: folding the inlet into the car would be asserting that the arm may
 * never touch the thing it plugs into. The STRUCTURE's margin is 0.10 m, 11x
 * the taller of the two, so nothing the arm does depends on the difference.
 */

import { CAR_LENGTH, CAR_WIDTH } from '@/engine/motion/traffic';
import { METRES_PER_PLAN_UNIT, ARM_BASE_TO_CAR_CENTRE_M, MOUNT_HEIGHT_M } from './cobotSpec';

/** Overall vehicle length, metres — the traffic model's body, converted. */
export const CAR_LENGTH_M = CAR_LENGTH * METRES_PER_PLAN_UNIT;
/** Overall vehicle width, metres. */
export const CAR_WIDTH_M = CAR_WIDTH * METRES_PER_PLAN_UNIT;

/**
 * Extrude bevel, metres. Load-bearing in two directions: it is how much the
 * mesh grows past the authored polygon, and therefore how much the clearance
 * model has to grow that polygon to stay a superset — see
 * bevelledBodyProfile(), which grows it the way the bevel does.
 */
export const BODY_BEVEL_M = 0.05;

/** How far the glazing and cladding stand proud of the painted body. */
export const GLASS_PROUD_M = 0.02;

/** Roof height of the painted body, metres (before the bevel bulge). */
export const BODY_ROOF_M = 1.46;

/**
 * The side profile, metres: (fore/aft from vehicle centre, height above grade).
 *
 * A SYMMETRIC ONE-BOX POD. A robotaxi has no engine bay and no driver, so it
 * has no long hood. The polygon is authored 2 x BEVEL short in length because
 * the bevel puts that length back — see vehicleBody.ts.
 *
 * The x offsets scale with LENGTH; the heights do NOT. A 4.88 m robotaxi is
 * not a 3.59 m one photographically enlarged — it is the same 1.46 m roof over
 * a longer wheelbase, which is exactly what every real one looks like. Scaling
 * the heights with the length would have produced a 1.99 m tall van.
 *
 * CONVEX, and the clearance maths below depends on that. `isConvex()` is
 * asserted in the test rather than assumed.
 */
export function bodyProfile(lengthM: number = CAR_LENGTH_M): [number, number][] {
  const halfL = lengthM / 2 - BODY_BEVEL_M;
  // Rake offsets as a fraction of overall length, so the silhouette keeps its
  // proportions at any size.
  const a = lengthM * 0.0279; // sill -> shoulder
  const b = lengthM * 0.1170; // shoulder -> cant rail
  const c = lengthM * 0.2006; // cant rail -> roof
  return [
    [-halfL, 0.26], [-halfL, 0.62], [-halfL + a, 0.86],
    [-halfL + b, 1.34], [-halfL + c, BODY_ROOF_M],
    [halfL - c, BODY_ROOF_M], [halfL - b, 1.34],
    [halfL - a, 0.86], [halfL, 0.62], [halfL, 0.26],
  ];
}

/**
 * The side profile GROWN BY THE BEVEL — the outline the extruded mesh's widest
 * cross-section actually traces.
 *
 * MITRED, not rounded, because that is what ExtrudeGeometry does: it offsets
 * each edge outward by bevelSize and takes the intersection of the neighbouring
 * offset edges, so a corner of interior angle θ lands at bevel/sin(θ/2) from the
 * original vertex rather than at bevel. At the profile's 90 deg lower corners
 * that is 70.71 mm out along the bisector where a round offset reaches 50.00 mm
 * — the drawn body poking 20.71 mm outside a solid that was supposed to contain
 * it. Rounding the corners instead was the previous model, and it was wrong.
 *
 * Convexity survives the offset (every edge keeps its direction and order), and
 * `isConvex` is asserted on the result rather than assumed — the distance maths
 * below needs it.
 */
export function bevelledBodyProfile(
  lengthM: number = CAR_LENGTH_M, inflate: number = BODY_BEVEL_M,
): [number, number][] {
  const poly = bodyProfile(lengthM);
  const n = poly.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    area2 += x0 * y1 - x1 * y0;
  }
  const w = area2 >= 0 ? 1 : -1; // +1 = counter-clockwise
  const outward = (i: number): [number, number] => {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    const nx = w * (y1 - y0);
    const ny = -w * (x1 - x0);
    const len = Math.hypot(nx, ny) || 1;
    return [nx / len, ny / len];
  };
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = outward((i - 1 + n) % n); // edge arriving at vertex i
    const [bx, by] = outward(i);               // edge leaving vertex i
    let mx = ax + bx, my = ay + by;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    // step along the bisector until the perpendicular distance to BOTH edges is
    // `inflate` — cos of the half-angle between the bisector and either normal
    const cosHalf = mx * ax + my * ay;
    const t = inflate / (cosHalf || 1);
    out.push([poly[i][0] + mx * t, poly[i][1] + my * t]);
  }
  return out;
}

/** Tyre radius, metres — 0.68 m diameter, a 20" wheel with tyre on it. */
export const WHEEL_RADIUS_M = 0.34;

/**
 * Axle position as a fraction of overall length.
 *
 * 0.34 is the viewer's original value. It was pushed out to 0.385 on the
 * 3.59 m body because the arm's +/-0.94 m service window ran INTO the rear
 * tyre, so a Waymo or Tesla port (left rear by construction) was drawn on top
 * of the wheel. On the real 4.88 m body the rear tyre's inner edge sits at
 * 1.66 - 0.34 = 1.32 m, well outside that window, so the axles can go back
 * where they belong: 0.385 of a 4.88 m car is a 3.76 m wheelbase, which is a
 * bus. vehicleBody.test.ts still checks the port-vs-tyre clearance directly.
 */
export const WHEEL_ALONG_FRACTION = 0.34;

/** Half-track inset from the flank, metres. */
export const WHEEL_INSET_M = 0.13;

/** AV sensor pod on the roof: centred, this tall, this wide. */
export const ROOF_POD = { radius: 0.15, yMin: 1.44, yMax: 1.64 } as const;

// ═══════════════════════════════════════════════════════════════════════════
// THE SOLID, IN THE ARM'S BASE FRAME
//
// Arm base frame: origin on the J1 axis at MOUNT_HEIGHT_M above the deck,
// +Z toward the vehicle, +X along the car (fore/aft), +Y up.
// ═══════════════════════════════════════════════════════════════════════════

export interface CarSolid {
  /**
   * Convex silhouette in (along, height-above-grade), metres, ALREADY GROWN BY
   * THE BEVEL. There is deliberately no separate inflate radius: a scalar
   * inflate rounds the corners, and the mesh's corners are mitred.
   */
  profile: readonly (readonly [number, number])[];
  /** Lateral extent of the whole vehicle, arm-frame z, metres. */
  zMin: number;
  zMax: number;
  /** Wheels, as discs in the same (along, height) plane. */
  wheels: readonly { along: number; height: number; radius: number }[];
  /** Roof sensor pod, a vertical cylinder. */
  pod: { along: number; z: number; radius: number; yMin: number; yMax: number };
  /** Arm-frame y of the deck the tyres rest on (negative: the arm is above it). */
  gradeY: number;
}

/**
 * The parked vehicle, in the arm's base frame.
 *
 * @param centreZ lateral distance from the arm base to the car centreline.
 *                Defaults to the depot's own pedestal offset.
 */
export function carSolidInArmFrame(
  centreZ: number = ARM_BASE_TO_CAR_CENTRE_M,
  mountHeight: number = MOUNT_HEIGHT_M,
): CarSolid {
  const halfW = CAR_WIDTH_M / 2;
  const wx = CAR_LENGTH_M * WHEEL_ALONG_FRACTION;
  return {
    profile: bevelledBodyProfile(),
    zMin: centreZ - halfW,
    zMax: centreZ + halfW,
    wheels: [
      { along: -wx, height: WHEEL_RADIUS_M, radius: WHEEL_RADIUS_M },
      { along: +wx, height: WHEEL_RADIUS_M, radius: WHEEL_RADIUS_M },
    ],
    pod: { along: 0, z: centreZ, radius: ROOF_POD.radius, yMin: ROOF_POD.yMin, yMax: ROOF_POD.yMax },
    gradeY: -mountHeight,
  };
}

/** The near flank plane — where the charge port lives. Arm-frame z, metres. */
export function nearFlankZ(centreZ: number = ARM_BASE_TO_CAR_CENTRE_M): number {
  return centreZ - CAR_WIDTH_M / 2;
}

// ───────────────────────────────────────────────── distance primitives ──────

/** Signed distance from a point to a slab [lo, hi] on one axis. */
function slabDistance(v: number, lo: number, hi: number): number {
  if (v < lo) return lo - v;
  if (v > hi) return v - hi;
  return -Math.min(v - lo, hi - v); // inside: negative penetration
}

/** Distance from a point to a segment, 2D. */
function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Signed distance from a point to a CONVEX polygon, 2D. Negative inside.
 *
 * Exact on both sides: outside it is the true distance to the boundary
 * (nearest edge, which covers the vertex case); inside it is the depth of the
 * deepest supporting half-plane. The polygon must wind consistently; the sign
 * of the area tells us which way, so the caller does not have to care.
 */
export function convexPolygonDistance(
  px: number, py: number, poly: readonly (readonly [number, number])[],
): number {
  const n = poly.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    area2 += x0 * y1 - x1 * y0;
  }
  const w = area2 >= 0 ? 1 : -1; // +1 = counter-clockwise

  let inside = true;
  let deepest = -Infinity;
  let nearest = Infinity;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    // outward normal of edge i for the polygon's actual winding
    const nx = w * (y1 - y0);
    const ny = -w * (x1 - x0);
    const len = Math.hypot(nx, ny) || 1;
    const s = ((px - x0) * nx + (py - y0) * ny) / len;
    if (s > 0) inside = false;
    deepest = Math.max(deepest, s);
    nearest = Math.min(nearest, segDistance(px, py, x0, y0, x1, y1));
  }
  return inside ? deepest : nearest;
}

/** Is a polygon convex? Asserted rather than assumed — the maths above needs it. */
export function isConvex(poly: readonly (readonly [number, number])[]): boolean {
  const n = poly.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    const [cx, cy] = poly[(i + 2) % n];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-12) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Combine two orthogonal-subspace distances into one.
 *
 * The car's parts are all PRODUCT SETS — a 2D cross-section extruded along the
 * remaining axis — and for a product set A x B in orthogonal subspaces the
 * exact distance is hypot(dist_A, dist_B) outside and max(dist_A, dist_B)
 * inside. That is what makes this check analytic and cheap instead of a mesh
 * sweep, and it is exact, not an approximation.
 */
function combine(a: number, b: number): number {
  if (a <= 0 && b <= 0) return Math.max(a, b);
  return Math.hypot(Math.max(0, a), Math.max(0, b));
}

/**
 * Signed clearance from a point to the parked vehicle, metres.
 * Positive = clear air. Negative = inside the bodywork.
 *
 * @param p point in the ARM BASE frame, metres
 */
export function clearanceToCar(
  p: { x: number; y: number; z: number }, car: CarSolid,
): number {
  const h = p.y - car.gradeY; // height above the deck
  const dz = slabDistance(p.z, car.zMin, car.zMax);

  // painted body + glazing: convex silhouette, already grown by the extrude bevel
  const dBody = convexPolygonDistance(p.x, h, car.profile);
  let best = combine(dBody, dz);

  // wheels
  for (const w of car.wheels) {
    const d = Math.hypot(p.x - w.along, h - w.height) - w.radius;
    best = Math.min(best, combine(d, dz));
  }

  // roof sensor pod — a vertical cylinder, so the product split is
  // (horizontal disc) x (height slab), not (silhouette) x (lateral slab)
  const dDisc = Math.hypot(p.x - car.pod.along, p.z - car.pod.z) - car.pod.radius;
  const dH = slabDistance(h, car.pod.yMin, car.pod.yMax);
  best = Math.min(best, combine(dDisc, dH));

  return best;
}
