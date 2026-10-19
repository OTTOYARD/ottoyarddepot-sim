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
import { VEHICLE_GEO, PORT_GEO, CAR_L_PU, CAR_W_PU, DOOR_GEO, DOOR_HINGE_PU } from './vehicleBody';
import { DOOR, CABIN_VOID, doorPoint, doorHinge, doorSwing, clearanceToDoor } from '@/lib/ottoChargeArm/vehicleEnvelope';
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
  it('is ONE car with the traffic model: 9.8 x 4.0 plan units', () => {
    const b = bodyBox();
    // length on Z (vehicles face local +Z), width on X
    expect(b.max.z - b.min.z).toBeCloseTo(CAR_L_PU, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(CAR_W_PU, 6);
    // The mesh is built to the SAME constants the traffic model budgets gaps
    // from and the 2D cockpit draws. It used to be built to 7.5 x 3.3673 while
    // those two used 10.2 x 4.2 — a 3D car 26% shorter and 20% narrower than
    // the car the engine believed it was steering. The literals here are the
    // point: if the mesh and the constants ever disagree again, this fails.
    // (10.2 x 4.2 until 2026-09-28: "slightly less big/boxy/bulky".)
    expect(CAR_L_PU).toBe(CAR_LENGTH);
    expect(CAR_W_PU).toBe(CAR_WIDTH);
    expect(CAR_L_PU).toBe(9.8);
    expect(CAR_W_PU).toBe(4.0);
    // 4.69 m x 1.91 m — a real robotaxi (a Jaguar I-PACE is 4.68 x 1.90 m)
    expect(CAR_L_PU / PLAN_UNITS_PER_METRE).toBeCloseTo(4.6893, 3);
    expect(CAR_W_PU / PLAN_UNITS_PER_METRE).toBeCloseTo(1.914, 3);
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

  it('stays cheap: seven shared buffers, four wheels merged into one each', () => {
    // The whole point of merging. If someone splits these back out, 115 cars
    // pay for it in draw calls.
    const tri = (g: THREE.BufferGeometry) =>
      (g.index ? g.index.count : g.attributes.position.count) / 3;
    // 5 body buffers + lamps (both ends, one buffer) + status lights (both
    // flanks and the pod band, one buffer, drawn only on cars being worked on)
    // + the cabin interior (liner, benches and mat in one buffer, 2026-10-19).
    // The doors are not here: each has its own transform (DOOR_GEO).
    expect(Object.keys(VEHICLE_GEO)).toHaveLength(8);
    // four tyres in one buffer: a single 14-segment cylinder is ~56 triangles
    expect(tri(VEHICLE_GEO.tyres)).toBeGreaterThan(4 * 40);
    // The body is a shell round the cabin now: the hole's rounded corners and the four
    // flank panels round the doors. Measured 760 when it was cut (the interior 100); the
    // bounds are what keep a careless curveSegments from multiplying them.
    expect(tri(VEHICLE_GEO.body)).toBeLessThan(1000);
    expect(tri(VEHICLE_GEO.interior)).toBeLessThan(200);
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

describe('lamps and status lights', () => {
  it('put a white bar on the NOSE (+Z, the way the car drives) and red on the tail', () => {
    const g = VEHICLE_GEO.lamps;
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    let front = 0, rear = 0;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const [r, gg, b] = [col.getX(i), col.getY(i), col.getZ(i)];
      if (z > 0) { front++; expect(Math.min(r, gg, b)).toBeGreaterThan(1); } // white, bright enough to bloom
      else { rear++; expect(r).toBeGreaterThan(1); expect(gg).toBeLessThan(0.2); expect(b).toBeLessThan(0.2); }
      // on the end faces, not floating in front of them
      expect(Math.abs(Math.abs(z) - CAR_L_PU / 2)).toBeLessThan(1e-5);
    }
    expect(front).toBeGreaterThan(0);
    expect(rear).toBeGreaterThan(0);
  });

  it('keeps the status light ON the car: inside its footprint and under the pod top', () => {
    const s = box(VEHICLE_GEO.status);
    const car = bodyBox();
    expect(s.max.x).toBeLessThanOrEqual(car.max.x + 1e-6);
    expect(s.min.x).toBeGreaterThanOrEqual(car.min.x - 1e-6);
    expect(s.max.z).toBeLessThan(car.max.z);
    expect(s.min.z).toBeGreaterThan(car.min.z);
    expect(s.max.y).toBeLessThanOrEqual(car.max.y);
    // and it is the flank strips, visible from the side: they reach the width
    expect(s.max.x).toBeGreaterThan(CAR_W_PU / 2 - 0.02);
  });
});


// ═══════════════════════════════════════════════════════════════ THE DOORS ═══
// The car has a cabin and a door on each flank (2026-10-19) so the OTTO-CLEAN ARM can
// reach in while it charges. These pin what the eye checks: the hole is the cabin, the
// door fills its aperture, it swings out without passing through the body, and no
// charge inlet sits on it.

/** A plan-unit vertex back in the authored car frame, metres: planUnits() sent
 *  (x, y, z) to (-z, y, x) and scaled by PLAN_UNITS_PER_METRE. */
const toCar = (x: number, y: number, z: number) => ({
  x: z / PLAN_UNITS_PER_METRE, y: y / PLAN_UNITS_PER_METRE, z: -x / PLAN_UNITS_PER_METRE,
});
function eachVertex(g: THREE.BufferGeometry, f: (p: { x: number; y: number; z: number }) => void) {
  const a = g.getAttribute('position');
  for (let i = 0; i < a.count; i++) f(toCar(a.getX(i), a.getY(i), a.getZ(i)));
}

describe('the cabin and the doors', () => {
  it('cuts the cabin through the body, and the bevel shrinks it to the void the arm is given', () => {
    // No body vertex stands inside the cabin's free volume (the liner sits 1 cm inside
    // the tunnel walls, so the walls themselves are 1 cm outside it) ...
    let inside = 0, onWalls = 0;
    eachVertex(VEHICLE_GEO.body, (p) => {
      const inX = p.x > CABIN_VOID.alongMin + 1e-4 && p.x < CABIN_VOID.alongMax - 1e-4;
      const inY = p.y > CABIN_VOID.floor + 1e-4 && p.y < CABIN_VOID.ceiling - 1e-4;
      const inZ = Math.abs(p.z) < CABIN_VOID.halfWidth - 1e-4;
      if (inX && inY && inZ) inside++;
      // ... and the tunnel's end walls are there, 1 cm outside the void: the hole was
      // cut and the bevel grew INTO it (a hole wound the wrong way grows instead)
      if (Math.abs(Math.abs(p.x) - (CABIN_VOID.alongMax + 0.01)) < 1e-3 && inY && inZ) onWalls++;
    });
    expect(inside).toBe(0);
    expect(onWalls).toBeGreaterThan(8);
  });

  it('draws the doors shut in their apertures, inside the car', () => {
    for (const [name, d] of Object.entries(DOOR_GEO)) {
      for (const part of [d.panel, d.glass, d.status]) {
        eachVertex(part, (p) => {
          expect(p.x, `${name} x`).toBeGreaterThanOrEqual(DOOR.alongMin - 1e-6);
          expect(p.x, `${name} x`).toBeLessThanOrEqual(DOOR.alongMax + 1e-6);
          expect(p.y, `${name} y`).toBeGreaterThanOrEqual(DOOR.sill - 1e-6);
          expect(p.y, `${name} y`).toBeLessThanOrEqual(DOOR.top + 1e-6);
          // on its own flank, and no wider than the car
          expect(Math.sign(p.z), name).toBe(name === 'right' ? 1 : -1);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(CAR_W_PU / 2 / PLAN_UNITS_PER_METRE + 1e-6);
        });
      }
    }
  });

  it('puts the hinge where the renderer turns the door: the same point in both frames', () => {
    for (const [side, h] of [[1, DOOR_HINGE_PU.right], [-1, DOOR_HINGE_PU.left]] as const) {
      const c = toCar(h.x, 0, h.z);
      const e = doorHinge(side);
      expect(c.x).toBeCloseTo(e.x, 9);
      expect(c.z).toBeCloseTo(e.z, 9);
    }
  });

  it('swings each door OUT, its rear edge away from the car, to DOOR.openDeg', () => {
    for (const side of [1, -1] as const) {
      const rear = { x: DOOR.alongMin, y: 0.8, z: side * (CAR_W_PU / 2 / PLAN_UNITS_PER_METRE) };
      const open = doorPoint(side, 1, rear);
      expect(side * open.z).toBeGreaterThan(side * rear.z + 0.9);   // about a metre off the flank
      expect(open.x).toBeGreaterThan(DOOR.alongMin);                // and forward, toward the hinge
      expect(Math.abs(doorSwing(side, 1)) * 180 / Math.PI).toBeCloseTo(DOOR.openDeg, 9);
      expect(Math.abs(doorSwing(side, 0))).toBe(0);
    }
  });

  it('never passes the door through the body: inside the flank, a door point is in its aperture', () => {
    // Sampled through the whole swing. A point of the swinging door that is inboard of
    // the paint face must be inside the aperture (where the door itself was); anywhere
    // else inboard of the flank is the body or a flank panel.
    const paintFace = CAR_W_PU / 2 / PLAN_UNITS_PER_METRE - 0.02;
    let checked = 0;
    for (const [name, d] of Object.entries(DOOR_GEO)) {
      const side = name === 'right' ? 1 : -1;
      for (let k = 0; k <= 40; k++) {
        const f = k / 40;
        eachVertex(d.panel, (p0) => {
          const p = doorPoint(side, f, p0);
          checked++;
          if (Math.abs(p.z) < paintFace - 1e-6) {
            expect(p.x, `${name} at ${f}`).toBeGreaterThan(DOOR.alongMin - 1e-6);
            expect(p.x, `${name} at ${f}`).toBeLessThan(DOOR.alongMax + 1e-6);
          }
        });
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('agrees with its own solid: every drawn door vertex is inside clearanceToDoor, shut and open', () => {
    for (const [name, d] of Object.entries(DOOR_GEO)) {
      const side = name === 'right' ? 1 : -1;
      for (const f of [0, 0.3, 0.7, 1]) {
        for (const part of [d.panel, d.glass]) {
          eachVertex(part, (p0) => {
            const p = doorPoint(side, f, p0);
            expect(clearanceToDoor(p, side, f), `${name} at ${f}`).toBeLessThanOrEqual(1e-6);
          });
        }
      }
    }
  });

  it('keeps every charge inlet off the door, with panel round its ring', () => {
    const ringR = 0.092 + 0.006;
    const oems = ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null, 'unknown'];
    let worst = Infinity;
    for (const oem of oems) {
      for (let i = 0; i < 80; i++) {
        const p = portFor(`veh-${oem}-${i}`, oem);
        worst = Math.min(worst, (DOOR.alongMin - DOOR.seam) - (p.along + ringR));
      }
    }
    // the lit ring's outer edge stands 0.148 m of panel behind the door's rear seam
    expect(worst).toBeGreaterThan(0.14);
  });
});
