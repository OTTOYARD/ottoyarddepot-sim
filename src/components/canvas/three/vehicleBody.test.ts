/**
 * The robotaxi body is allowed to change SHAPE. Its SIZE has to be the size
 * everything else in the sim believes it is, and it is not allowed to float.
 *
 * Every dimension is the product of a metre literal, a bevel and a unit
 * conversion — exactly the arithmetic that put an earlier arm into the depot at
 * 48% scale. And the size is load-bearing twice over: CAR_LENGTH drives the IDM
 * following gap and the fixture overlap budgets, and CAR_WIDTH sets the flank
 * plane the OTTO-CHARGE ARM works against.
 *
 * The mesh used to be built at 7.5 x 3.3673 while both of those consumers used
 * 10.2 x 4.2, and a comment here called that footprint FROZEN. Freezing it did
 * not make the numbers agree.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VEHICLE_GEO, PORT_GEO, CAR_L_PU, CAR_W_PU } from './vehicleBody';
import { DECK_Y } from './coordUtils';
import { CAR_LENGTH, CAR_WIDTH } from '@/engine/motion/traffic';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { portFor } from '@/lib/ottoChargeArm/chargePort';

/** Tyre radius in plan units — 0.34 m, the value vehicleBody builds them at. */
const WHEEL_RADIUS_PU = 0.34 * PLAN_UNITS_PER_METRE;

function box(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox!;
}

/** Union of every buffer that makes up the car, as rendered. */
function bodyBox(): THREE.Box3 {
  const b = new THREE.Box3();
  for (const key of ['body', 'glass', 'trim', 'tyres', 'rims'] as const) {
    b.union(box(VEHICLE_GEO[key]));
  }
  return b;
}

describe('robotaxi body geometry', () => {
  it('is ONE car with the traffic model: 10.2 x 4.2 plan units', () => {
    const b = bodyBox();
    // length on Z (vehicles face local +Z), width on X
    expect(b.max.z - b.min.z).toBeCloseTo(CAR_L_PU, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(CAR_W_PU, 6);
    // The mesh is built to the SAME constants the traffic model budgets gaps
    // from and the 2D cockpit draws. It used to be built to 7.5 x 3.3673 while
    // those two used 10.2 x 4.2 — a 3D car 26% shorter and 20% narrower than
    // the car the engine believed it was steering. The literals here are the
    // point: if the mesh and the constants ever disagree again, this fails.
    expect(CAR_L_PU).toBe(CAR_LENGTH);
    expect(CAR_W_PU).toBe(CAR_WIDTH);
    expect(CAR_L_PU).toBe(10.2);
    expect(CAR_W_PU).toBe(4.2);
    // 4.88 m x 2.01 m — a real robotaxi
    expect(CAR_L_PU / PLAN_UNITS_PER_METRE).toBeCloseTo(4.8807, 3);
    expect(CAR_W_PU / PLAN_UNITS_PER_METRE).toBeCloseTo(2.0097, 3);
  });

  it('is centred on its own origin, so a stall pose puts it in the stall', () => {
    const b = bodyBox();
    expect(b.min.z + b.max.z).toBeCloseTo(0, 6);
    expect(b.min.x + b.max.x).toBeCloseTo(0, 6);
  });

  it('rests its tyres on grade rather than floating or sinking', () => {
    // Geometry origin is the contact patch; Vehicle3D lifts the group to DECK_Y.
    expect(box(VEHICLE_GEO.tyres).min.y).toBeCloseTo(0, 6);
    // and nothing pokes below the tyres
    expect(bodyBox().min.y).toBeCloseTo(0, 6);
  });

  it('is a POD, not a slab — the roofline is above the shoulder', () => {
    const b = bodyBox();
    const height = b.max.y - b.min.y;
    // 1.46 m of body + the sensor pod on top, in plan units
    expect(height).toBeGreaterThan(1.55 * PLAN_UNITS_PER_METRE);
    expect(height).toBeLessThan(1.75 * PLAN_UNITS_PER_METRE);
    // the greenhouse sits in the upper half — it is glazing, not a skirt
    expect(box(VEHICLE_GEO.glass).min.y).toBeGreaterThan(height * 0.5);
  });

  it('shows its glazing — the band must stand PROUD of the paint', () => {
    // ExtrudeGeometry's bevel grows outward, so the body is widest at its outer
    // faces. A greenhouse sized to the nominal width therefore disappears
    // INSIDE the bevel bulge, and the fleet renders as blank painted loaves.
    // That is what shipped in the first cut of this body; it is invisible in a
    // bounding-box check of the whole car, so it gets its own assertion.
    const glass = box(VEHICLE_GEO.glass);
    const body = box(VEHICLE_GEO.body);
    expect(glass.max.x).toBeGreaterThan(body.max.x);
    expect(glass.min.x).toBeLessThan(body.min.x);
    // ...but only just: the glazing is what sets the car's width.
    expect(glass.max.x).toBeCloseTo(CAR_W_PU / 2, 6);
  });

  it('stays cheap: five shared buffers, four wheels merged into one each', () => {
    // The whole point of merging. If someone splits these back out, 115 cars
    // pay for it in draw calls.
    const tri = (g: THREE.BufferGeometry) =>
      (g.index ? g.index.count : g.attributes.position.count) / 3;
    expect(Object.keys(VEHICLE_GEO)).toHaveLength(6); // 5 body buffers + the status glow
    // four tyres in one buffer: a single 14-segment cylinder is ~56 triangles
    expect(tri(VEHICLE_GEO.tyres)).toBeGreaterThan(4 * 40);
    expect(tri(VEHICLE_GEO.body)).toBeLessThan(600);
  });
});

describe('the charge port ring', () => {
  it('sits proud of the flank it is mounted on, with the socket sunk inward', () => {
    const socket = box(PORT_GEO.socket);
    const ring = box(PORT_GEO.ring);
    // Authored with the flank normal on +X, converted to the depot's axes:
    // the ring is a flat annulus facing outward, the socket recesses behind it.
    expect(ring.max.x - ring.min.x).toBeLessThan(ring.max.y - ring.min.y);
    expect(socket.min.x).toBeLessThan(ring.min.x); // recess goes INTO the body
  });

  it('is a real inlet, not a decal — ~18 cm across, at true scale', () => {
    const ring = box(PORT_GEO.ring);
    const diameterM = (ring.max.y - ring.min.y) / PLAN_UNITS_PER_METRE;
    expect(diameterM).toBeGreaterThan(0.15);
    expect(diameterM).toBeLessThan(0.21);
  });
});

describe('the charge port clears the bodywork it is mounted next to', () => {
  it('never lands on a wheel, for any OEM in the fleet', () => {
    // portFor() puts Tesla, Waymo and Ioniq inlets at the LEFT REAR, and clamps
    // every OEM into the arm's service window. If the axles sit where the
    // viewer put them, that rear cluster is drawn straight through the tyre.
    const tyres = box(VEHICLE_GEO.tyres);
    // rear tyres occupy [min.z, -gap]; the port must stay inboard of that.
    const rearTyreInnerEdge = -(-tyres.min.z - 2 * WHEEL_RADIUS_PU);
    const oems = ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null, 'unknown'];
    let checked = 0;
    for (const oem of oems) {
      for (let i = 0; i < 60; i++) {
        const p = portFor(`veh-${oem}-${i}`, oem);
        const z = p.along * PLAN_UNITS_PER_METRE;
        expect(Math.abs(z), `${oem} along=${p.along}`).toBeLessThan(Math.abs(rearTyreInnerEdge));
        checked++;
      }
    }
    expect(checked).toBe(480);
  });
});

describe('the depot grade datum', () => {
  it('is the asphalt deck, shared by the vehicle and the arm', () => {
    // Documented here because it is the value that reconciles two independent
    // placement paths; if DepotGround's overlay moves, both must move with it.
    expect(DECK_Y).toBeCloseTo(0.26, 6);
  });
});
