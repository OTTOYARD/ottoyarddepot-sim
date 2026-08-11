import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_BODY_LENGTH, CAR_BODY_WIDTH } from '@/engine/motion/traffic';
import { METRES_PER_PLAN_UNIT, PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';

/**
 * The fleet robotaxi body — geometry only, no React.
 *
 * Ported from the OTTO-CHARGE ARM viewer's vehicle, which is built from an
 * extruded SIDE PROFILE rather than stacked boxes: a slab with a floating glass
 * cube on top does not read as a vehicle at any distance, which is what the
 * depot's cars looked like before.
 *
 * Kept OUT of Vehicle3D.tsx so vehicleBody.test.ts can measure it. The
 * footprint claim below is the kind of thing that is easy to assert in a
 * comment and quietly wrong in the buffer.
 *
 * ═══════════════════════════════════════════════════════════════════ UNITS ═══
 * The viewer is authored in METRES. This renderer is PLAN UNITS at 0.4785
 * m/unit. The profile is therefore kept in metres — directly comparable with
 * its source, so the shape can be audited — and converted at exactly one
 * place, planUnits() below.
 *
 * ══════════════════════════════════════════════════════════════ FOOTPRINT ═══
 * THE FOOTPRINT IS NOT FROZEN ANY MORE — it is DERIVED. This file used to
 * build the body to 7.5 x 3.367 plan units (3.59 m x 1.61 m), inherited from
 * the old box body's SCALE = 7.5/4.9, and call that frozen. It was frozen to
 * the WRONG NUMBER: the traffic model reserves 10.2 x 4.2 and the 2D cockpit
 * paints 10.2 x 4.2, so the 3D car was 26% shorter and 20% narrower than both.
 * Gaps that read correctly in the cockpit read wrong in 3D, and the mesh was
 * the one of the three that was not a real vehicle (a 3.59 m robotaxi).
 *
 * It now builds to CAR_BODY_LENGTH x CAR_BODY_WIDTH — 4.88 m x 2.01 m — which
 * is the ONE definition of how big a car is. Do not reintroduce a local size.
 *
 * HEIGHT IS UNCHANGED AND WAS ALWAYS CORRECT: the side profile's y values are
 * absolute metres (roof at 1.46 m, sensor pod to ~1.66 m), never scaled off
 * the length. That is why the old mesh read as a stubby pod — only L and W
 * were undersized. Growing L and W is what brings the proportions back.
 *
 * ⚠ WIDTH MOVES THE CHARGING ARM'S TARGET. CAR_W_PU sets the flank plane the
 * OTTO-CHARGE ARM solves IK to, and the DCFC pedestal is fixed at 4.5 pu from
 * the stall centreline, so a wider car sits CLOSER to the pedestal: near-flank
 * standoff 1.3476 m -> 1.1484 m. Swept before shipping, on the real spec:
 *   · SERVICE_WINDOW coverage at the new standoff — 4949 samples, 0 misses.
 *   · far-flank exclusion (the constraint chargePort.ts and the backend stall
 *     gate rest on) gets SAFER: ARM_SCALE ceiling 1.6141 -> 1.7487.
 *   · stowed arm clearance to the flank plane: 0.2344 m -> 0.0352 m. Positive,
 *     and kinematics.test.ts' `stows clear of the vehicle envelope` still
 *     passes — but 35 mm is now the tightest margin in the arm package, and
 *     the next person to widen the car or fatten a housing will break it.
 *     cobotSpec.SERVICE_WINDOW.flankStandoff still documents 1.348; it is
 *     descriptive only (nothing reads it for geometry) but it is now stale.
 */

export const CAR_L_PU = CAR_BODY_LENGTH; // 10.2
export const CAR_W_PU = CAR_BODY_WIDTH; //  4.2
const CAR_L_M = CAR_L_PU * METRES_PER_PLAN_UNIT; // 4.8807
const CAR_W_M = CAR_W_PU * METRES_PER_PLAN_UNIT; // 2.0097

/**
 * Metre-authored geometry -> depot plan units, in the depot's axis convention.
 *
 * The profile is extruded length-along-X (the viewer's convention, where the
 * car parks broadside to the pedestal). This renderer's vehicles face local +Z
 * at rotation 0, so the length has to end up on Z: Ry(-PI/2) maps +X -> +Z,
 * which keeps the NOSE forward rather than mirroring the car end for end.
 */
function planUnits(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.scale(PLAN_UNITS_PER_METRE, PLAN_UNITS_PER_METRE, PLAN_UNITS_PER_METRE);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/**
 * Merge parts into one buffer — one draw call instead of N.
 *
 * mergeGeometries requires every input to AGREE on whether it carries an index,
 * and returns null (with a console error) when they do not. ExtrudeGeometry
 * comes back non-indexed while the primitives are indexed, so mixed groups are
 * brought to a common footing first. Failing loudly beats the null deref that
 * blanked the whole canvas.
 */
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const allIndexed = parts.every((g) => g.index !== null);
  const norm = allIndexed ? parts : parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(norm, false);
  if (!merged) throw new Error('vehicleBody: incompatible geometry attributes in merge');
  return merged;
}

/** Build a closed THREE.Shape from a metre-space point list. */
function shapeFrom(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.lineTo(pts[0][0], pts[0][1]);
  return s;
}

// ════════════════════════════════════════════════ shared geometry (metres) ═══

/**
 * ExtrudeGeometry's bevel grows the shape OUTWARD, it does not inset it.
 *
 * That is the opposite of what the name suggests and it is why the profile is
 * authored 2 x BEVEL short: the bevel puts the length back, and the body ends
 * up exactly CAR_L_M long. Taken at face value the car came out 0.10 m over —
 * a mesh silently disagreeing with the body the traffic model follows at.
 * vehicleBody.test.ts measures the assembled bounding box, not the literals.
 */
const BEVEL = 0.05;
const halfL = CAR_L_M / 2 - BEVEL;

/**
 * How far the glazing and cladding stand out past the paint.
 *
 * Also a consequence of the bevel growing outward: it means the body is WIDEST
 * at its outer faces, so a greenhouse sized to the nominal car width vanishes
 * completely inside the bevel bulge — which is exactly what the first cut of
 * this did. The cars rendered as blank painted loaves with no glass at all.
 * The body is therefore narrowed to leave the band room, and the GREENHOUSE is
 * the widest element, so the car still measures CAR_W_M overall.
 */
const GLASS_PROUD = 0.02;

// A SYMMETRIC ONE-BOX POD. A robotaxi has no engine bay and no driver, so it
// has no long hood; an asymmetric wedge read as a 2005 minivan. The bevel is
// what stops the roofline being a hard crease at this poly count.
const BODY_DEPTH = CAR_W_M - 2 * BEVEL - 2 * GLASS_PROUD;
const bodyGeo = new THREE.ExtrudeGeometry(
  shapeFrom([
    [-halfL, 0.26], [-halfL, 0.62], [-halfL + 0.10, 0.86],
    [-halfL + 0.42, 1.34], [-halfL + 0.72, 1.46],
    [halfL - 0.72, 1.46], [halfL - 0.42, 1.34],
    [halfL - 0.10, 0.86], [halfL, 0.62], [halfL, 0.26],
  ]),
  { depth: BODY_DEPTH, bevelEnabled: true, bevelSize: BEVEL, bevelThickness: BEVEL, bevelSegments: 2 },
);
bodyGeo.translate(0, 0, -BODY_DEPTH / 2);

// Greenhouse: the dark band that makes the pod read as a vehicle rather than a
// painted loaf. It is the car's widest element, at exactly the frozen width.
const GLASS_DEPTH = CAR_W_M;
const greenhouseGeo = new THREE.ExtrudeGeometry(
  shapeFrom([
    [-halfL + 0.16, 0.88], [-halfL + 0.44, 1.32], [halfL - 0.44, 1.32], [halfL - 0.16, 0.88],
  ]),
  { depth: GLASS_DEPTH, bevelEnabled: false },
);
greenhouseGeo.translate(0, 0, -GLASS_DEPTH / 2);

// AV sensor pod — this is a robotaxi, not a private car.
const podGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.20, 14);
podGeo.translate(0, 1.54, 0);
const podGlassGeo = new THREE.CylinderGeometry(0.135, 0.135, 0.07, 14);
podGlassGeo.translate(0, 1.56, 0);

// Dark lower cladding — breaks up the body mass and grounds the vehicle.
const cladGeo = new THREE.BoxGeometry(CAR_L_M - 0.06, 0.20, GLASS_DEPTH);
cladGeo.translate(0, 0.34, 0);

// Wheels sit tucked under the glazing line: proud of the body's flat flank so
// they read in profile, inside its widest point so they do not add to the
// footprint. Tyres share one buffer, rims share another.
const WHEEL_RADIUS_M = 0.34;
/**
 * Wheels at 0.385 of the length, not the viewer's 0.34.
 *
 * The viewer had no visible charge port, so nothing cared where the axles sat.
 * Here they do: portFor() clamps `along` into the arm's service window at
 * +/-0.94 m, and a Waymo or Tesla port sits at the LEFT REAR by construction,
 * so an axle inside that window draws the inlet on top of a wheel. At the old
 * 3.59 m length 0.34 put the rear tyre at -0.88 m, inside the window; 0.385
 * cleared it by ~0.10 m.
 *
 * Re-measured at the real 4.8807 m body: axle now at 1.8791 m, clearing the
 * +/-0.94 m clamp by 0.939 m — the constraint no longer binds at any sane
 * ratio. 0.385 is kept because wheels-at-the-corners is the correct read for a
 * one-box pod, not because the port still forces it. Tyre outer edge sits at
 * 2.2191 m against a 2.4404 m half-length, so the wheels stay inside the
 * bumpers and add nothing to the footprint.
 */
const WHEEL_X = CAR_L_M * 0.385;
const WHEEL_Z = CAR_W_M / 2 - 0.13;
function atWheels(make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const g = make();
    g.rotateX(Math.PI / 2); // axle across the car
    g.translate(sx * WHEEL_X, WHEEL_RADIUS_M, sz * WHEEL_Z);
    parts.push(g);
  }
  return mergeAll(parts);
}

/** Body geometry, plan units, origin at the centre of the tyre contact patch. */
export const VEHICLE_GEO = {
  body: planUnits(bodyGeo),
  glass: planUnits(mergeAll([greenhouseGeo, podGlassGeo])),
  trim: planUnits(mergeAll([cladGeo, podGeo])),
  tyres: planUnits(atWheels(() => new THREE.CylinderGeometry(WHEEL_RADIUS_M, WHEEL_RADIUS_M, 0.24, 14))),
  rims: planUnits(atWheels(() => new THREE.CylinderGeometry(0.20, 0.20, 0.255, 12))),
  // Status halo, drawn floating ABOVE the roof (Vehicle3D positions it at
  // y = 3.9 pu) — a UI marker, not part of the body, so it is deliberately not
  // derived from the footprint. The literal was `3.6 / 2.0 * (7.5 / 4.9)`,
  // which was the last surviving copy of the old mesh scale seed; it is
  // written out here at the same value so nothing on screen moves and nobody
  // mistakes it for a car dimension again.
  glow: new THREE.SphereGeometry(2.7551020408163263, 8, 8),
};

// ── the charge port, as a real feature on the flank ─────────────────────────
// Socket (rim + recess) is one buffer; the lit ring is the second, because an
// emissive material cannot be merged into a lit one. The owning group carries
// the position, so the ring the arm mates with is the ring on screen.
//
// AXIS, and it is easy to get backwards: these go through planUnits() like
// everything else, and Ry(-PI/2) sends pre-Z to car -X. So a port whose axis
// must end up on the car's FLANK (+/-X) has to be authored with its axis on
// pre-Z — which is where TorusGeometry already puts it, no rotation needed.
// Rotating it to pre-X, as the viewer does in its own axis convention, lands
// the inlet on the NOSE. Likewise the recess sinks inward by translating along
// pre +Z, which becomes car -X.
const portRimGeo = new THREE.TorusGeometry(0.075, 0.010, 6, 18);
const portRecessGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.035, 14);
portRecessGeo.rotateX(Math.PI / 2);
portRecessGeo.translate(0, 0, 0.018); // sunk INTO the bodywork
const portGlowGeo = new THREE.TorusGeometry(0.092, 0.006, 6, 20);

export const PORT_GEO = {
  socket: planUnits(mergeAll([portRimGeo, portRecessGeo])),
  ring: planUnits(portGlowGeo),
};
