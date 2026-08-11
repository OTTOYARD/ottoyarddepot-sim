import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_LENGTH, CAR_WIDTH } from '@/engine/motion/traffic';
import { METRES_PER_PLAN_UNIT, PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import {
  CAR_LENGTH_M, CAR_WIDTH_M, BODY_BEVEL_M, GLASS_PROUD_M, bodyProfile,
  WHEEL_RADIUS_M, WHEEL_ALONG_FRACTION, WHEEL_INSET_M, ROOF_POD,
} from '@/lib/ottoChargeArm/vehicleEnvelope';

/**
 * The fleet robotaxi body — geometry only, no React.
 *
 * Built from an extruded SIDE PROFILE rather than stacked boxes: a slab with a
 * floating glass cube on top does not read as a vehicle at any distance.
 *
 * Kept OUT of Vehicle3D.tsx so vehicleBody.test.ts can measure it. The
 * footprint claim below is the kind of thing that is easy to assert in a
 * comment and quietly wrong in the buffer.
 *
 * ═══════════════════════════════════════════════════════════════════ UNITS ═══
 * The shape is authored in METRES, in vehicleEnvelope.ts. This renderer is PLAN
 * UNITS at 0.4785 m/unit. Conversion happens at exactly one place, planUnits()
 * below.
 *
 * ═════════════════════════════════════════════════════════════ FOOTPRINT ═════
 * ONE CAR, ONE SIZE. This mesh is 10.2 x 4.2 plan units — 4.88 x 2.01 m, a real
 * robotaxi — which is the same body the 2D cockpit draws (VehicleDot) and the
 * same body every following-gap budget in traffic.ts is computed from.
 *
 * It was not. The mesh was built at 7.5 x 3.367 and this comment used to say the
 * footprint was FROZEN there, so the 3D car was 26% shorter and 20% narrower
 * than the car the traffic model was steering. Freezing the mesh did not make
 * the numbers agree; it just moved the disagreement somewhere no test looked.
 *
 * The shape is not defined here any more. It lives in vehicleEnvelope.ts,
 * because the OTTO-CHARGE ARM has to know the shape of the thing it reaches
 * into — and a clearance measured against a different solid from the one on
 * screen is not a measurement. armClearance.test.ts is the consumer.
 */

export const CAR_L_PU = CAR_LENGTH; // 10.2
export const CAR_W_PU = CAR_WIDTH; //   4.2
const CAR_L_M = CAR_LENGTH_M; // 4.8807
const CAR_W_M = CAR_WIDTH_M; //  2.0097

/**
 * Metre-authored geometry -> depot plan units, in the depot's axis convention.
 *
 * The profile is extruded length-along-X (the arm package's convention, where
 * the car parks broadside to the pedestal). This renderer's vehicles face local
 * +Z at rotation 0, so the length has to end up on Z: Ry(-PI/2) maps +X -> +Z,
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
 * That is the opposite of what the name suggests and it is why bodyProfile() is
 * authored 2 x BEVEL short: the bevel puts the length back, and the body ends up
 * exactly CAR_L_M long. Taken at face value the car comes out 2 x BEVEL over —
 * a mesh silently disagreeing with the CAR_LENGTH the traffic model follows at.
 * vehicleBody.test.ts measures it.
 *
 * It is also why the clearance model in vehicleEnvelope.ts inflates the same
 * polygon by the same BEVEL: the mesh really does reach that far out.
 */
const BEVEL = BODY_BEVEL_M;
const PROFILE = bodyProfile();

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
const GLASS_PROUD = GLASS_PROUD_M;

// A SYMMETRIC ONE-BOX POD. A robotaxi has no engine bay and no driver, so it
// has no long hood; an asymmetric wedge read as a 2005 minivan. The bevel is
// what stops the roofline being a hard crease at this poly count.
const BODY_DEPTH = CAR_W_M - 2 * BEVEL - 2 * GLASS_PROUD;
const bodyGeo = new THREE.ExtrudeGeometry(
  shapeFrom(PROFILE),
  { depth: BODY_DEPTH, bevelEnabled: true, bevelSize: BEVEL, bevelThickness: BEVEL, bevelSegments: 2 },
);
bodyGeo.translate(0, 0, -BODY_DEPTH / 2);

// The greenhouse corners, read off the profile so the glazing tracks the
// silhouette instead of restating it. PROFILE runs tail-sill, tail-shoulder,
// tail-cant, tail-roof, ... so indices 2..3 and 6..7 are the two window pillars.
const [tailShoulder, tailCant] = [PROFILE[2], PROFILE[3]];
const [noseCant, noseShoulder] = [PROFILE[6], PROFILE[7]];
const GLASS_INSET = CAR_L_M * 0.0123; // pillar reveal, scaled with the car

// Greenhouse: the dark band that makes the pod read as a vehicle rather than a
// painted loaf. It is the car's widest element, at exactly the frozen width.
const GLASS_DEPTH = CAR_W_M;
const greenhouseGeo = new THREE.ExtrudeGeometry(
  shapeFrom([
    [tailShoulder[0] + GLASS_INSET, tailShoulder[1] + 0.02],
    [tailCant[0] + GLASS_INSET, tailCant[1] - 0.02],
    [noseCant[0] - GLASS_INSET, noseCant[1] - 0.02],
    [noseShoulder[0] - GLASS_INSET, noseShoulder[1] + 0.02],
  ]),
  { depth: GLASS_DEPTH, bevelEnabled: false },
);
greenhouseGeo.translate(0, 0, -GLASS_DEPTH / 2);

// AV sensor pod — this is a robotaxi, not a private car. Sized and placed from
// ROOF_POD so the arm's clearance model knows it is there.
const POD_H = ROOF_POD.yMax - ROOF_POD.yMin;
const podGeo = new THREE.CylinderGeometry(ROOF_POD.radius * (0.13 / 0.15), ROOF_POD.radius, POD_H, 14);
podGeo.translate(0, ROOF_POD.yMin + POD_H / 2, 0);
const podGlassGeo = new THREE.CylinderGeometry(ROOF_POD.radius * 0.9, ROOF_POD.radius * 0.9, 0.07, 14);
podGlassGeo.translate(0, ROOF_POD.yMax - 0.08, 0);

// Dark lower cladding — breaks up the body mass and grounds the vehicle.
const cladGeo = new THREE.BoxGeometry(CAR_L_M - 0.06, 0.20, GLASS_DEPTH);
cladGeo.translate(0, 0.34, 0);

// Wheels sit tucked under the glazing line: proud of the body's flat flank so
// they read in profile, inside its widest point so they do not add to the
// footprint. Tyres share one buffer, rims share another.
//
// The axle fraction is WHEEL_ALONG_FRACTION and it belongs to the envelope, not
// to this file: the arm's clearance model has to put the wheels where they are
// drawn. It went out to 0.385 on the old 3.59 m body because the arm's service
// window ran into the rear tyre; on the real 4.88 m body 0.34 clears it with
// 0.32 m to spare, and 0.385 would have been a 3.76 m wheelbase.
const WHEEL_X = CAR_L_M * WHEEL_ALONG_FRACTION;
const WHEEL_Z = CAR_W_M / 2 - WHEEL_INSET_M;
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
  // Decorative status halo, not a footprint: a soft 12%-opacity sphere floating
  // over the roof. Sized off the car so it stays proportionate, never budgeted
  // against.
  glow: new THREE.SphereGeometry(CAR_W_PU * 0.66, 8, 8),
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
