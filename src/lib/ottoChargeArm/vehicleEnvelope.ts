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
import { METRES_PER_PLAN_UNIT, PEDESTAL_TO_CAR_CENTRE_M, MOUNT_HEIGHT_M } from './cobotSpec';

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

/**
 * TUMBLEHOME: above `fromM` the body's sides lean in, until at the roof the car is
 * `roofScale` of its width — the glass and roof tipped inward the way every real
 * car's are. The founder, 2026-09-28: "make the vehicles just slightly less
 * big/boxy/bulky". A profile extruded straight across the car is a loaf with
 * vertical walls all the way to the roof, which is what read as a van.
 *
 * It starts above the highest inlet any OEM family presents (chargePort.ts: vans to
 * 1.05 m), so every charge port still sits on a vertical flank at the car's full
 * width — where Vehicle3D draws it and where the arm aims. The clearance solid
 * below keeps the full-width slab: leaning the mesh in only moves it further inside
 * the solid, so "the solid contains every drawn vertex" still holds by construction.
 */
export const TUMBLEHOME = { fromM: 1.06, roofScale: 0.86 } as const;

/** How much of the car's half-width the body keeps at height `yM` (1 below the
 *  tumblehome line, TUMBLEHOME.roofScale at the top of the bevelled roof). */
export function tumblehomeScale(yM: number): number {
  const top = BODY_ROOF_M + BODY_BEVEL_M;
  const t = Math.max(0, Math.min(1, (yM - TUMBLEHOME.fromM) / (top - TUMBLEHOME.fromM)));
  return 1 - (1 - TUMBLEHOME.roofScale) * t;
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
// THE DOORS AND THE CABIN (2026-10-19)
//
// Chase: "right now our vehicle doors don't even open to demonstrate a robotic
// arm, reaching inside to clean." The OTTO-CLEAN ARM (src/lib/ottoCleanArm) reaches
// into the cabin through the doors while the car charges, so the car now HAS a
// cabin, an aperture on each flank and a door in it. docs/OTTO-CLEAN-ARM.md is the
// design; these are its numbers, and the clearance tests read them from here.
//
// FRAME: the authored CAR frame, metres — x along the car (+ = nose), y up from
// grade, z across it from the centreline. +z is the car's RIGHT flank: planUnits()
// in vehicleBody.ts sends authored +z to local -X, which is the right (see
// depotPlacement.portInVehicleFrame). `side` = +1 is the right flank, -1 the left.
//
// ONE DOOR A SIDE, HINGED AT ITS FRONT EDGE, swinging out. A sliding door cannot fit
// this 4.69 m pod: a 1.1 m door slid forward stands above the sloping nose, and slid
// back it covers the charge port. Front-hinged, it opens AWAY from the rear quarter
// where every inlet now is (chargePort.ts), so on the port flank the door and the
// OTTO-CHARGE ARM never share space (cleanArmClearance.test.ts measures it).
// ═══════════════════════════════════════════════════════════════════════════

/** The door aperture on each flank, and the door that fills it, metres. */
export const DOOR = {
  /** Rear edge of the aperture, along the car from its centre. */
  alongMin: -0.3,
  /** Front edge of the aperture: the hinge line. */
  alongMax: 0.85,
  /** Aperture bottom above grade (the cladding stops under it). */
  sill: 0.42,
  /** Aperture top: the top of the glass band, so no sliver of glass is left over the door. */
  top: 1.32,
  /** Gap between the door and the aperture, all round. */
  seam: 0.004,
  /** The door panel, outer skin to inner trim. */
  thickness: 0.045,
  /** Hinge axis outboard of the flank, so the door's front edge swings clear of the body. */
  hingeOut: 0.025,
  /** How far it opens. 78 deg puts the open door nearly square to the flank, which is
   *  what leaves the cleaning arm room to work behind it. */
  openDeg: 78,
  /** Rounding of the aperture's and the door's corners. */
  cornerR: 0.05,
} as const;

/**
 * The CABIN: the hole cut through the extruded body (vehicleBody.ts), at the flank.
 * It is longer than the aperture: the panels between the aperture and the wheel
 * arches cover the rest of it on each flank, and carry the side windows.
 */
export const CABIN = {
  alongMin: -1.05, alongMax: 1.05, yMin: DOOR.sill, yMax: DOOR.top, cornerR: 0.08,
} as const;

/** The flank panels' thickness: the depth of the body side round the aperture. */
export const SIDE_PANEL_M = BODY_BEVEL_M;

/**
 * The cabin's FREE volume, metres — what the cleaning wand may enter.
 *
 * The extrude bevel grows the material into every hole as it grows the outline
 * outward, so the tunnel's walls stand BODY_BEVEL_M inside CABIN, and the flank
 * panels and doors take SIDE_PANEL_M / DOOR.thickness off each side. The liner is
 * drawn 1 cm inside these walls, so the void is that much smaller again.
 */
export const CABIN_VOID = {
  alongMin: CABIN.alongMin + BODY_BEVEL_M + 0.01,
  alongMax: CABIN.alongMax - BODY_BEVEL_M - 0.01,
  floor: CABIN.yMin + BODY_BEVEL_M + 0.01,
  ceiling: CABIN.yMax - BODY_BEVEL_M - 0.01,
  /** Half-width at the floor; above the tumblehome line it narrows with the body. */
  halfWidth: CAR_WIDTH_M / 2 - GLASS_PROUD_M - Math.max(SIDE_PANEL_M, DOOR.thickness) - 0.01,
} as const;

/**
 * Two benches facing each other across the cabin (carriage seating: a purpose-built
 * robotaxi has no driver to face forward for). Boxes in the car frame, metres.
 */
export const SEATS = {
  halfWidth: 0.78,
  cushion: { depth: 0.44, top: 0.70 },
  back: { depth: 0.14, top: 1.15 },
} as const;

export interface CarBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

/** The seat parts as boxes, car frame, metres: cushions first, then backs. */
export function seatBoxes(): CarBox[] {
  const v = CABIN_VOID, w = SEATS.halfWidth;
  const rearC: CarBox = { x0: v.alongMin, x1: v.alongMin + SEATS.cushion.depth, y0: v.floor, y1: SEATS.cushion.top, z0: -w, z1: w };
  const rearB: CarBox = { x0: v.alongMin, x1: v.alongMin + SEATS.back.depth, y0: SEATS.cushion.top, y1: SEATS.back.top, z0: -w, z1: w };
  const mirror = (b: CarBox): CarBox => ({ ...b, x0: -b.x1, x1: -b.x0 });
  return [rearC, mirror(rearC), rearB, mirror(rearB)];
}

/** The hinge axis (vertical) of the door on `side`, car frame, metres. */
export function doorHinge(side: 1 | -1): { x: number; z: number } {
  return { x: DOOR.alongMax, z: side * (CAR_WIDTH_M / 2 + DOOR.hingeOut) };
}

/**
 * The door's swing about its hinge, radians about +y, for an opening fraction
 * 0 (shut) .. 1 (open). Signed so the door's rear edge always swings OUTWARD:
 * Ry(phi) sends the door's rear-pointing arm (-L, 0) to (-L cos phi, L sin phi),
 * so the right flank (+z) opens with +phi and the left with -phi.
 */
export function doorSwing(side: 1 | -1, open01: number): number {
  const f = Math.max(0, Math.min(1, open01));
  return side * f * (DOOR.openDeg * Math.PI) / 180;
}

/** A point of the shut door (car frame) moved to where it is with the door open `open01`. */
export function doorPoint(side: 1 | -1, open01: number, p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const h = doorHinge(side);
  const phi = doorSwing(side, open01);
  const c = Math.cos(phi), s = Math.sin(phi);
  const dx = p.x - h.x, dz = p.z - h.z;
  return { x: h.x + c * dx + s * dz, y: p.y, z: h.z - s * dx + c * dz };
}

/**
 * The door as a solid: an oriented box in the car frame (the door's own frame is the
 * shut door's, turned about the hinge). Conservative, a superset of what is drawn: the
 * full aperture outline with no corner rounding, and deep enough to hold the window's
 * TUMBLEHOME lean, which takes the top of the door up to 0.14 m in from its foot
 * (vehicleBody.test.ts checks every drawn door vertex is inside, shut and open).
 */
export function doorSolid(side: 1 | -1, open01: number): {
  hinge: { x: number; z: number }; phi: number;
  /** In the door frame: x from the hinge (negative = toward the rear edge), z outward from the hinge line. */
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
} {
  const h = doorHinge(side);
  return {
    hinge: h, phi: doorSwing(side, open01),
    x0: DOOR.alongMin - DOOR.alongMax, x1: 0,
    y0: DOOR.sill, y1: DOOR.top,
    // outward from the hinge line: the door's glass face (the car's full width) stands
    // DOOR.hingeOut inboard of it at its foot; its inner trim DOOR.thickness behind
    // the paint, and the top of the door leans in further by the tumblehome
    z0: -(DOOR.hingeOut + CAR_WIDTH_M / 2
      - (CAR_WIDTH_M / 2 - GLASS_PROUD_M - DOOR.thickness) * tumblehomeScale(DOOR.top)),
    z1: -DOOR.hingeOut,
  };
}

/**
 * The door's inner and outer faces at height `y`, as offsets OUTWARD from the hinge line
 * (both negative: the door stands inboard of its hinge). The drawn door's shape, with the
 * paint panel below the glass line and the window above it leaning in with the body.
 * `GLASS_LINE` and `WINDOW_T` are vehicleBody's (the shoulder + 2 cm; the 3 cm glass).
 */
const GLASS_LINE = 0.88, WINDOW_T = 0.03;
function doorFaces(y: number): { inner: number; outer: number } {
  const hinge = CAR_WIDTH_M / 2 + DOOR.hingeOut;
  const paint = CAR_WIDTH_M / 2 - GLASS_PROUD_M;
  const panel = { inner: -(hinge - (paint - DOOR.thickness)), outer: -(hinge - paint) };
  const s = tumblehomeScale(y);
  const window = { inner: -(hinge - (CAR_WIDTH_M / 2 - WINDOW_T) * s), outer: -(hinge - (CAR_WIDTH_M / 2) * s) };
  // on the glass line itself both parts meet: the door there is their union
  if (Math.abs(y - GLASS_LINE) < 1e-6) {
    return { inner: Math.min(panel.inner, window.inner), outer: Math.max(panel.outer, window.outer) };
  }
  return y < GLASS_LINE ? panel : window;
}

/**
 * Signed distance from a point (car frame, metres) to the door, open `open01`. Negative
 * inside. The lateral faces are taken at the point's own height (doorFaces), so the
 * window's lean is followed rather than boxed; doorSolid's box is the superset, kept
 * for anything that wants one shape.
 */
export function clearanceToDoor(p: { x: number; y: number; z: number }, side: 1 | -1, open01: number): number {
  const d = doorSolid(side, open01);
  // into the door frame: undo the swing about the hinge, then measure z outward
  const c = Math.cos(-d.phi), s = Math.sin(-d.phi);
  const dx = p.x - d.hinge.x, dz = p.z - d.hinge.z;
  const lx = c * dx + s * dz;
  const lzRaw = -s * dx + c * dz;
  const lz = side * lzRaw; // outward-positive on either flank
  const f = doorFaces(Math.max(d.y0, Math.min(d.y1, p.y)));
  const ex = slabDistance(lx, d.x0, d.x1);
  const ey = slabDistance(p.y, d.y0, d.y1);
  const ez = slabDistance(lz, f.inner, f.outer);
  return combine(combine(ex, ey), ez);
}

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
  centreZ: number = PEDESTAL_TO_CAR_CENTRE_M,
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
export function nearFlankZ(centreZ: number = PEDESTAL_TO_CAR_CENTRE_M): number {
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
