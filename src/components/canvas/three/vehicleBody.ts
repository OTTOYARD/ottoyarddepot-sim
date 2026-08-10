import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_LENGTH, CAR_WIDTH } from '@/engine/motion/traffic';
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
 * The FOOTPRINT IS FROZEN. Only the shape changes: the old box body was
 * 2.2 x 0.85 x 4.9 at SCALE = 7.5/4.9, i.e. 7.5 plan units long x 3.367 wide,
 * and every element here is sized so the new body measures the same. Vehicle
 * length is load-bearing elsewhere (CAR_LENGTH drives the IDM gap, and the
 * overlap budgets in TwinMotionDriver.fixture.test), so growing the mesh would
 * quietly desynchronise what you see from what the traffic model believes.
 */

export const CAR_L_PU = CAR_LENGTH; // 7.5
export const CAR_W_PU = CAR_WIDTH; //  3.3673
const CAR_L_M = CAR_L_PU * METRES_PER_PLAN_UNIT; // 3.5888
const CAR_W_M = CAR_W_PU * METRES_PER_PLAN_UNIT; // 1.6113

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
 * up exactly CAR_L_M long. Taken at face value the car came out 3.689 m — 0.209
 * plan units over the frozen 7.5 — which is a mesh silently disagreeing with
 * the CAR_LENGTH the traffic model follows at. vehicleBody.test.ts measures it.
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
 * +/-0.94 m, and at 0.34 the rear tyre reaches -0.88 m — so a Waymo or Tesla
 * port, which sits at the LEFT REAR by construction, was drawn on top of the
 * wheel. Pushing the axles out to 0.385 puts the whole clamped window between
 * them with ~0.10 m to spare, and wheels-at-the-corners is the correct read for
 * a one-box pod anyway.
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
  glow: new THREE.SphereGeometry(3.6 / 2.0 * (7.5 / 4.9), 8, 8),
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
