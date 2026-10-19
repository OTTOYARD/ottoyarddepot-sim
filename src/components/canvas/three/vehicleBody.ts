import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_LENGTH, CAR_WIDTH } from '@/engine/motion/traffic';
import { METRES_PER_PLAN_UNIT, PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import {
  CAR_LENGTH_M, CAR_WIDTH_M, BODY_BEVEL_M, GLASS_PROUD_M, bodyProfile,
  WHEEL_RADIUS_M, WHEEL_ALONG_FRACTION, WHEEL_INSET_M, ROOF_POD, tumblehomeScale,
  DOOR, CABIN, CABIN_VOID, SIDE_PANEL_M, seatBoxes, doorHinge, type CarBox,
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
 * ONE CAR, ONE SIZE. This mesh is 9.8 x 4.0 plan units — 4.69 x 1.91 m, a real
 * robotaxi (it was 10.2 x 4.2 until the founder asked for "slightly less
 * big/boxy/bulky" on 2026-09-28) — which is the same body the 2D cockpit draws
 * (VehicleDot) and the same body every following-gap budget in traffic.ts is
 * computed from. Above the charge-port line its glass and roof lean in
 * (vehicleEnvelope.TUMBLEHOME), so it no longer reads as a van.
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

export const CAR_L_PU = CAR_LENGTH; // 9.8
export const CAR_W_PU = CAR_WIDTH; //  4.0
const CAR_L_M = CAR_LENGTH_M; // 4.6893
const CAR_W_M = CAR_WIDTH_M; //  1.9140

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

/** Lean the sides in above the tumblehome line: every vertex's lateral (pre-Z)
 *  coordinate scaled by vehicleEnvelope.tumblehomeScale of its height. Applied in
 *  metre space, before planUnits(), to the parts that make the car's silhouette. */
function tumblehome(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * tumblehomeScale(p.getY(i)));
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
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

/**
 * A closed rounded rectangle as a path, COUNTER-clockwise (y up). The profile is
 * authored clockwise (tail up, over the roof, nose down, back along the sill), and
 * ExtrudeGeometry only reads a hole as a hole when it winds the other way round —
 * which is also what makes its bevel shrink the hole rather than grow it.
 */
function roundedRectPath(x0: number, x1: number, y0: number, y1: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x1, y1 - r);
  p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  p.lineTo(x0 + r, y1);
  p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + r);
  p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}

// THE CABIN is a hole through the extruded body (vehicleEnvelope.CABIN): a tunnel
// from flank to flank, which the flank panels below and the doors close again. The
// bevel grows material into the hole as it grows the outline outward, so the
// tunnel's walls stand BEVEL inside CABIN and flare out to it at each flank: the
// sill and roof-rail lips a real door opening has.
const bodyShape = shapeFrom(PROFILE);
bodyShape.holes.push(roundedRectPath(CABIN.alongMin, CABIN.alongMax, CABIN.yMin, CABIN.yMax, CABIN.cornerR));
const bodyGeo = new THREE.ExtrudeGeometry(
  bodyShape,
  { depth: BODY_DEPTH, bevelEnabled: true, bevelSize: BEVEL, bevelThickness: BEVEL, bevelSegments: 2, curveSegments: 3 },
);
bodyGeo.translate(0, 0, -BODY_DEPTH / 2);
tumblehome(bodyGeo);

// The greenhouse corners, read off the profile so the glazing tracks the
// silhouette instead of restating it. PROFILE runs sill-bottom, sill-top,
// shoulder, cant rail, roof at the tail and then the mirror image at the nose —
// TWO points on the sill, not one — so the window pillars are indices 2..3 and
// 6..7. (This comment used to skip the second sill point and name 2..3 as the
// cant rail and the roof. The indices were right; the names were off by one.)
const [tailShoulder, tailCant] = [PROFILE[2], PROFILE[3]];
const [noseCant, noseShoulder] = [PROFILE[6], PROFILE[7]];
const GLASS_INSET = CAR_L_M * 0.0123; // pillar reveal, scaled with the car

// Greenhouse: the dark band that makes the pod read as a vehicle rather than a
// painted loaf. It is the car's widest element, at exactly the frozen width.
const GLASS_DEPTH = CAR_W_M;
/** The glass band's bottom and top edges (the shoulder and the cant rail, 2 cm in). */
const GLASS_Y0 = tailShoulder[1] + 0.02;
const GLASS_Y1 = tailCant[1] - 0.02;
// Two pieces, tail and nose: a slab of glass across the car would stand in the cabin.
// Over the cabin the flank panels and the doors carry the glass instead (below).
function greenhousePiece(end: 1 | -1): THREE.BufferGeometry {
  const xShoulder = end * (noseShoulder[0] - GLASS_INSET);
  const xCant = end * (noseCant[0] - GLASS_INSET);
  const xCabin = end * CABIN.alongMax;
  const g = new THREE.ExtrudeGeometry(
    shapeFrom(end > 0
      ? [[xCabin, GLASS_Y0], [xShoulder, GLASS_Y0], [xCant, GLASS_Y1], [xCabin, GLASS_Y1]]
      : [[xShoulder, GLASS_Y0], [xCabin, GLASS_Y0], [xCabin, GLASS_Y1], [xCant, GLASS_Y1]]),
    { depth: GLASS_DEPTH, bevelEnabled: false },
  );
  g.translate(0, 0, -GLASS_DEPTH / 2);
  return tumblehome(g);
}
const greenhouseGeo = mergeAll([greenhousePiece(-1), greenhousePiece(1)]);

// ── the flank panels round each door: the rest of the cabin hole, with windows ──
// Paint below the glass line, flush with the body's flank (CAR_W/2 - GLASS_PROUD);
// glass above it, flush with the glass band (CAR_W/2). The aperture between them is
// vehicleEnvelope.DOOR, rounded at its four corners (the panels carry the fillets).
const PAINT_FACE = CAR_W_M / 2 - GLASS_PROUD;
const GLASS_FACE = CAR_W_M / 2;
const GLASS_T = 0.03;

/** A flat panel from an outline in (along, height), `t` thick, its outer face at |z| = `face`, on `side`. */
function flankPanel(outline: THREE.Shape, face: number, t: number, side: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(outline, { depth: t, bevelEnabled: false, curveSegments: 4 });
  // extruded along +z from 0 to t: put the outer face on the flank
  g.translate(0, 0, side > 0 ? face - t : -face);
  return tumblehome(g);
}

/**
 * One flank panel's outline, (along, height): x from `xa` to `xb` (xa < xb), the
 * height band y0..y1, with a FILLET where it meets the aperture (`apertureAt` is the
 * panel's edge on the aperture: 'left' = its xa edge, 'right' = its xb edge) on the
 * corners that touch the cabin hole's own edge, and the cabin hole's rounding on its
 * outer corners. `round` says which of the band's edges are the hole's top or bottom.
 */
function panelOutline(
  xa: number, xb: number, y0: number, y1: number, apertureAt: 'left' | 'right', round: { bottom: boolean; top: boolean },
): THREE.Shape {
  const R = CABIN.cornerR, r = DOOR.cornerR;
  const s = new THREE.Shape();
  // corner kinds, counter-clockwise from bottom-left: outer (hole) rounding on the
  // side away from the aperture, an inverted fillet on the aperture side
  const bl = round.bottom ? (apertureAt === 'left' ? 'fillet' : 'outer') : 'sharp';
  const br = round.bottom ? (apertureAt === 'right' ? 'fillet' : 'outer') : 'sharp';
  const tr = round.top ? (apertureAt === 'right' ? 'fillet' : 'outer') : 'sharp';
  const tl = round.top ? (apertureAt === 'left' ? 'fillet' : 'outer') : 'sharp';
  // bottom-left
  if (bl === 'outer') s.moveTo(xa + R, y0);
  else if (bl === 'fillet') s.moveTo(xa - r, y0);
  else s.moveTo(xa, y0);
  // bottom edge -> bottom-right
  if (br === 'outer') { s.lineTo(xb - R, y0); s.absarc(xb - R, y0 + R, R, -Math.PI / 2, 0, false); }
  else if (br === 'fillet') { s.lineTo(xb + r, y0); s.absarc(xb + r, y0 + r, r, -Math.PI / 2, -Math.PI, true); }
  else s.lineTo(xb, y0);
  // right edge -> top-right
  if (tr === 'outer') { s.lineTo(xb, y1 - R); s.absarc(xb - R, y1 - R, R, 0, Math.PI / 2, false); }
  else if (tr === 'fillet') { s.lineTo(xb, y1 - r); s.absarc(xb + r, y1 - r, r, Math.PI, Math.PI / 2, true); }
  else s.lineTo(xb, y1);
  // top edge -> top-left
  if (tl === 'outer') { s.lineTo(xa + R, y1); s.absarc(xa + R, y1 - R, R, Math.PI / 2, Math.PI, false); }
  else if (tl === 'fillet') { s.lineTo(xa - r, y1); s.absarc(xa - r, y1 - r, r, Math.PI / 2, 0, true); }
  else s.lineTo(xa, y1);
  // left edge -> back to bottom-left
  if (bl === 'outer') { s.lineTo(xa, y0 + R); s.absarc(xa + R, y0 + R, R, Math.PI, Math.PI * 1.5, false); }
  else if (bl === 'fillet') { s.lineTo(xa, y0 + r); s.absarc(xa - r, y0 + r, r, 0, -Math.PI / 2, true); }
  else s.lineTo(xa, y0);
  return s;
}

const flankPaint: THREE.BufferGeometry[] = [];
const flankGlass: THREE.BufferGeometry[] = [];
for (const side of [1, -1] as const) {
  // rear panel: cabin rear edge to the aperture's rear edge (the aperture is on its right)
  flankPaint.push(flankPanel(panelOutline(CABIN.alongMin, DOOR.alongMin, CABIN.yMin, GLASS_Y0, 'right', { bottom: true, top: false }), PAINT_FACE, SIDE_PANEL_M, side));
  flankGlass.push(flankPanel(panelOutline(CABIN.alongMin, DOOR.alongMin, GLASS_Y0, CABIN.yMax, 'right', { bottom: false, top: true }), GLASS_FACE, GLASS_T, side));
  // front panel: the aperture's front edge (the hinge line) to the cabin's front edge
  flankPaint.push(flankPanel(panelOutline(DOOR.alongMax, CABIN.alongMax, CABIN.yMin, GLASS_Y0, 'left', { bottom: true, top: false }), PAINT_FACE, SIDE_PANEL_M, side));
  flankGlass.push(flankPanel(panelOutline(DOOR.alongMax, CABIN.alongMax, GLASS_Y0, CABIN.yMax, 'left', { bottom: false, top: true }), GLASS_FACE, GLASS_T, side));
}

// AV sensor pod — this is a robotaxi, not a private car. Sized and placed from
// ROOF_POD so the arm's clearance model knows it is there.
const POD_H = ROOF_POD.yMax - ROOF_POD.yMin;
const podGeo = new THREE.CylinderGeometry(ROOF_POD.radius * (0.13 / 0.15), ROOF_POD.radius, POD_H, 14);
podGeo.translate(0, ROOF_POD.yMin + POD_H / 2, 0);
const podGlassGeo = new THREE.CylinderGeometry(ROOF_POD.radius * 0.9, ROOF_POD.radius * 0.9, 0.07, 14);
podGlassGeo.translate(0, ROOF_POD.yMax - 0.08, 0);

// Dark lower cladding — breaks up the body mass and grounds the vehicle.
// It stops 1 cm under the door sill (it ran to 0.44 m, over a sill now at 0.42).
const CLAD_Y0 = 0.24, CLAD_Y1 = DOOR.sill - 0.01;
const cladGeo = new THREE.BoxGeometry(CAR_L_M - 0.06, CLAD_Y1 - CLAD_Y0, GLASS_DEPTH);
cladGeo.translate(0, (CLAD_Y0 + CLAD_Y1) / 2, 0);

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

// ── lamps: a white light bar across the nose, a red one across the tail ─────
// The pod is symmetric end for end, so without lamps nothing on screen says
// which way a car is pointing. Each bar is a flat quad lying ON the bevelled
// end face (along = +/-CAR_L_M/2, the plane the body's flat end reaches) —
// not proud of it, because the clearance solid is exactly that face and the
// containment test allows one micrometre. Vehicle3D draws it with a polygon
// offset so it wins the depth test against the paint it is coplanar with.
// One buffer for both ends, coloured per vertex: one draw call, not two.
const LAMP_SPAN = BODY_DEPTH - 0.14;          // inside the bevel's rounding
const LAMP_Y0 = 0.50, LAMP_Y1 = 0.58;         // top of the flat end face (0.26..0.62)
function lampBar(end: 1 | -1, rgb: [number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(LAMP_SPAN, LAMP_Y1 - LAMP_Y0);
  g.rotateY(end * Math.PI / 2);               // face +/-X, the car's nose / tail
  g.translate(end * CAR_L_M / 2, (LAMP_Y0 + LAMP_Y1) / 2, 0);
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const lampsGeo = mergeAll([lampBar(1, [1.6, 1.55, 1.45]), lampBar(-1, [1.5, 0.06, 0.05])]);

// ── status light: a beltline LED strip down each flank + a band on the pod ──
// This replaces a translucent sphere that floated over every working car. It
// said the same thing (charging / washing / service) and nothing real looks
// like it. A purpose-built robotaxi DOES carry exterior status lighting, and on
// the body, not above it. The strips sit in the 20 mm between the paint and the
// car's overall width — the same room the glazing and cladding stand proud in —
// so they need no depth trickery; the pod band is the pod's own envelope
// radius, just proud of the tapered pod. Where a car is also says what it is
// doing (a car in a wash bay is washing), so this is a cue, not the only one.
const STRIP_X = (noseShoulder[0] - GLASS_INSET) * 0.92;
const STRIP_Y0 = 0.78, STRIP_Y1 = 0.83;       // under the glazing, over the door line
const STRIP_T = 0.012;
const STRIP_Z = CAR_W_M / 2 - 0.004 - STRIP_T / 2;
/** A strip from x0 to x1 on `side`'s flank. The door carries its own piece (DOOR_GEO). */
function flankStrip(side: 1 | -1, x0: number, x1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, STRIP_Y1 - STRIP_Y0, STRIP_T);
  g.translate((x0 + x1) / 2, (STRIP_Y0 + STRIP_Y1) / 2, side * STRIP_Z);
  return g;
}
/** The strip's gap at each edge of the aperture, so a moving door never shows a seam of light. */
const STRIP_GAP = 0.012;
const podBandGeo = new THREE.CylinderGeometry(ROOF_POD.radius, ROOF_POD.radius, 0.045, 16, 1, true);
podBandGeo.translate(0, ROOF_POD.yMin + 0.09, 0);
const statusGeo = mergeAll([
  ...([1, -1] as const).flatMap((sd) => [
    flankStrip(sd, -STRIP_X, DOOR.alongMin - STRIP_GAP),
    flankStrip(sd, DOOR.alongMax + STRIP_GAP, STRIP_X),
  ]),
  podBandGeo,
]);

// ── wheel arches: a matte band over each tyre, on the flank ────────────────
// Without them the tyres read as discs pressed against a loaf. A flat half-ring
// just inside the car's overall width (the 20 mm the glazing and cladding
// already stand proud in), centred on each axle, facing out. Merged into the
// trim buffer: no extra draw call.
const ARCH_IN = WHEEL_RADIUS_M + 0.03, ARCH_OUT = WHEEL_RADIUS_M + 0.1;
function archAt(along: number, side: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(ARCH_IN, ARCH_OUT, 20, 1, 0, Math.PI); // upper half, facing +Z
  if (side < 0) g.rotateY(Math.PI);                                     // face the -Z flank
  g.translate(along, WHEEL_RADIUS_M, side * (CAR_W_M / 2 - 0.006));
  return g;
}
const archGeo = mergeAll([-1, 1].flatMap((a) => [archAt(a * WHEEL_X, 1), archAt(a * WHEEL_X, -1)]));

// ── the cabin interior: a liner on the tunnel's walls, two benches, a floor mat ──
// Coloured per vertex (one buffer, one draw call): a dark liner and mat, mid-grey
// seats, so the benches the OTTO-CLEAN ARM works on read against the cabin. It rides
// the car's own transform and is closed in by the doors, so it costs nothing to
// leave it drawn on every car.
// LINEAR colours (vertex colours are not converted from sRGB): the liner reads as a dark
// charcoal (#2b2e33 in sRGB), the benches a mid grey (#4b5058), the mat near-black.
const LINER: [number, number, number] = [0.024, 0.027, 0.033];
const SEAT: [number, number, number] = [0.07, 0.08, 0.096];
const SEAT_EDGE: [number, number, number] = [0.035, 0.04, 0.05];
const MAT_RGB: [number, number, number] = [0.012, 0.014, 0.016];
/** The cabin light: coloured over 1.0, which Vehicle3D's interior material reads as a lamp. */
export const CABIN_LAMP_RGB: [number, number, number] = [1.25, 1.2, 1.1];

function coloured(g: THREE.BufferGeometry, rgb: [number, number, number]): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  ng.deleteAttribute('uv');
  return ng;
}
/** An axis-aligned box in the car frame. */
function carBox(b: CarBox): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
  g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  return g;
}
/** A quad facing INTO the cabin: the box's face on `axis` at `at`, normal toward `inward`. */
function linerQuad(axis: 'x' | 'y' | 'z', at: number, inward: 1 | -1, a: [number, number], b: [number, number]): THREE.BufferGeometry {
  const w = a[1] - a[0], h = b[1] - b[0];
  const g = new THREE.PlaneGeometry(w, h);
  // PlaneGeometry is centred on its origin and faces +z: turn it to face the cabin
  // along `axis` (a turn about its own centre keeps it centred), then move it there.
  // `a` is the span on the first remaining axis (x for 'y' and 'z', z for 'x'), `b` on the second.
  if (axis === 'x') { g.rotateY(inward > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(at, (b[0] + b[1]) / 2, (a[0] + a[1]) / 2); }
  else if (axis === 'y') { g.rotateX(inward > 0 ? -Math.PI / 2 : Math.PI / 2); g.translate((a[0] + a[1]) / 2, at, (b[0] + b[1]) / 2); }
  else { if (inward < 0) g.rotateY(Math.PI); g.translate((a[0] + a[1]) / 2, (b[0] + b[1]) / 2, at); }
  return g;
}
const V = CABIN_VOID;
const interiorParts: THREE.BufferGeometry[] = [
  // floor (faces up), ceiling (faces down), rear and front walls (face in)
  coloured(linerQuad('y', V.floor, 1, [V.alongMin, V.alongMax], [-V.halfWidth, V.halfWidth]), LINER),
  coloured(linerQuad('y', V.ceiling, -1, [V.alongMin, V.alongMax], [-V.halfWidth, V.halfWidth]), LINER),
  coloured(linerQuad('x', V.alongMin, 1, [-V.halfWidth, V.halfWidth], [V.floor, V.ceiling]), LINER),
  coloured(linerQuad('x', V.alongMax, -1, [-V.halfWidth, V.halfWidth], [V.floor, V.ceiling]), LINER),
  // side trim over the flank panels' painted inner faces, both flanks, under the glass line
  ...([1, -1] as const).flatMap((sd) => [
    coloured(linerQuad('z', sd * V.halfWidth, (-sd) as 1 | -1, [V.alongMin, DOOR.alongMin], [V.floor, GLASS_Y0]), LINER),
    coloured(linerQuad('z', sd * V.halfWidth, (-sd) as 1 | -1, [DOOR.alongMax, V.alongMax], [V.floor, GLASS_Y0]), LINER),
  ]),
  // a floor mat between the benches
  coloured(carBox({ x0: -0.55, x1: 0.55, y0: V.floor, y1: V.floor + 0.012, z0: -0.7, z1: 0.7 }), MAT_RGB),
  // the cabin light down the headliner's centre (a lamp: see CABIN_LAMP_RGB)
  coloured(carBox({ x0: -0.6, x1: 0.6, y0: V.ceiling - 0.012, y1: V.ceiling - 0.002, z0: -0.05, z1: 0.05 }), CABIN_LAMP_RGB),
  // the benches: cushions and backs, with a darker welt along each cushion's front edge
  ...seatBoxes().map((b) => coloured(carBox(b), SEAT)),
  ...seatBoxes().slice(0, 2).map((b) => {
    const front = b.x0 < 0 ? b.x1 : b.x0;
    return coloured(carBox({ x0: front - 0.02, x1: front + 0.02, y0: b.y1 - 0.03, y1: b.y1 + 0.005, z0: b.z0, z1: b.z1 }), SEAT_EDGE);
  }),
];
const interiorGeo = tumblehome(mergeAll(interiorParts));

/** Body geometry, plan units, origin at the centre of the tyre contact patch. */
export const VEHICLE_GEO = {
  body: planUnits(mergeAll([bodyGeo, ...flankPaint])),
  glass: planUnits(mergeAll([greenhouseGeo, ...flankGlass, podGlassGeo])),
  trim: planUnits(mergeAll([cladGeo, podGeo, archGeo])),
  tyres: planUnits(atWheels(() => new THREE.CylinderGeometry(WHEEL_RADIUS_M, WHEEL_RADIUS_M, 0.24, 14))),
  rims: planUnits(atWheels(() => new THREE.CylinderGeometry(0.20, 0.20, 0.255, 12))),
  lamps: planUnits(lampsGeo),
  status: planUnits(statusGeo),
  interior: planUnits(interiorGeo),
};

// ── the doors ───────────────────────────────────────────────────────────────
// One per flank, in the aperture vehicleEnvelope.DOOR describes, drawn SHUT in the
// car frame; Vehicle3D turns each about its hinge (doorHinge, below) by the angle
// the OTTO-CLEAN ARM's session asks for. Three buffers per flank: the panel (paint
// outside, a dark trim inside, coloured per vertex so the car's paint colour still
// comes from instanceColor), its window, and its piece of the status strip.
const DOOR_X0 = DOOR.alongMin + DOOR.seam, DOOR_X1 = DOOR.alongMax - DOOR.seam;
const DOOR_Y0 = DOOR.sill + DOOR.seam, DOOR_Y1 = DOOR.top - DOOR.seam;
const DOOR_SKIN = 0.014;

/** The door's outline in (along, height) between y0 and y1, rounded on the corners that are the door's own. */
function doorOutline(y0: number, y1: number, roundBottom: boolean, roundTop: boolean): THREE.Shape {
  const r = DOOR.cornerR - DOOR.seam;
  const s = new THREE.Shape();
  const x0 = DOOR_X0, x1 = DOOR_X1;
  s.moveTo(roundBottom ? x0 + r : x0, y0);
  if (roundBottom) { s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false); } else s.lineTo(x1, y0);
  if (roundTop) { s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false); s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false); }
  else { s.lineTo(x1, y1); s.lineTo(x0, y1); }
  if (roundBottom) { s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false); } else s.lineTo(x0, y0);
  return s;
}

function doorParts(side: 1 | -1) {
  const skin = coloured(flankPanel(doorOutline(DOOR_Y0, GLASS_Y0, true, false), PAINT_FACE, DOOR_SKIN, side), [1, 1, 1]);
  const trim = coloured(flankPanel(doorOutline(DOOR_Y0, GLASS_Y0, true, false), PAINT_FACE - DOOR_SKIN, DOOR.thickness - DOOR_SKIN, side), [0.02, 0.022, 0.026]);
  const win = flankPanel(doorOutline(GLASS_Y0, DOOR_Y1, false, true), GLASS_FACE, GLASS_T, side);
  return {
    panel: planUnits(mergeAll([skin, trim])),
    glass: planUnits(win),
    status: planUnits(flankStrip(side, DOOR_X0 + STRIP_GAP, DOOR_X1 - STRIP_GAP)),
  };
}

/** The two doors, shut, plan units in the car frame: right (+1) and left (-1) flank. */
export const DOOR_GEO = { right: doorParts(1), left: doorParts(-1) } as const;

/**
 * Each door's hinge axis in the car's LOCAL plan-unit frame (nose on +Z, the right
 * flank on -X): vehicleEnvelope.doorHinge put through planUnits(). A rotation about
 * +Y commutes with planUnits' Ry(-PI/2), so the swing angle is doorSwing's as is.
 */
export const DOOR_HINGE_PU = {
  right: { x: -doorHinge(1).z * PLAN_UNITS_PER_METRE, z: doorHinge(1).x * PLAN_UNITS_PER_METRE },
  left: { x: -doorHinge(-1).z * PLAN_UNITS_PER_METRE, z: doorHinge(-1).x * PLAN_UNITS_PER_METRE },
} as const;

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
