import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVehicle, doorNodes, FLEET_SPECS, setDoors } from './index';
import { bakeYardModel, toYardFrame, triangleCount, YARD_FROM_MODEL, YARD_PART_KINDS, type YardModel } from './yardLod';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { VEHICLE_GEO } from '@/components/canvas/three/vehicleBody';

const t0 = performance.now();
const models = FLEET_SPECS.map((spec) => ({ spec, yard: bakeYardModel(spec) }));
const bakeMs = (performance.now() - t0) / models.length;

/** Bounds of the full model's painted body and shut doors, as fleetModels.test.ts measures them. */
function fullBodyBox(car: THREE.Object3D): THREE.Box3 {
  setDoors(car, 0);
  car.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const o of [car.getObjectByName('body')!, ...doorNodes(car)]) {
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh && mesh.name !== 'arch_liner' && !mesh.parent?.name.startsWith('mirror')) box.union(new THREE.Box3().setFromObject(mesh));
    });
  }
  return box;
}

const bounds = (m: YardModel): THREE.Box3 => {
  const box = new THREE.Box3();
  for (const p of m.body) box.union(new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute));
  return box;
};

describe('the yard model of each fleet vehicle', () => {
  it('reports its size (triangles and draw calls a model)', () => {
    const table = models.map(({ spec, yard }) => ({
      key: spec.key,
      triangles: yard.triangles,
      body: yard.body.map((p) => `${p.kind} ${triangleCount(p.geometry)}`).join(', '),
      doors: yard.doors.map((d) => d.parts.reduce((n, p) => n + triangleCount(p.geometry), 0)).join(' + '),
      shadow: triangleCount(yard.shadow),
      draws: yard.body.length + yard.doors.reduce((n, d) => n + d.parts.length, 0) + 1,
    }));
    console.table(table);
    console.log(`bake: ${bakeMs.toFixed(0)} ms a model`);
    expect(table.length).toBe(6);
  });

  it.each(models)('$spec.key: at most 12,000 triangles, and at most 8 static body draws', ({ yard }) => {
    expect(yard.triangles).toBeLessThanOrEqual(12000);
    expect(yard.triangles).toBeGreaterThan(1500);
    expect(yard.body.length).toBeLessThanOrEqual(8);
    // one part per finish, in the order the renderer lists them
    expect(yard.body.map((p) => p.kind)).toEqual(YARD_PART_KINDS.filter((k) => yard.body.some((p) => p.kind === k)));
    expect(yard.body.some((p) => p.kind === 'paint')).toBe(true);
    for (const p of yard.body) {
      for (const a of ['position', 'normal', 'color']) expect(p.geometry.getAttribute(a), `${p.kind}.${a}`).toBeTruthy();
      expect(p.geometry.index).toBeTruthy();
    }
    expect(triangleCount(yard.shadow)).toBeLessThan(800);
  });

  it.each(models)('$spec.key: the body box is within 3 cm of the full model', ({ spec, yard }) => {
    const full = fullBodyBox(buildVehicle(spec));
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(yard.bodyBox.min[axis] - full.min[axis]), `min ${axis}`).toBeLessThan(0.03);
      expect(Math.abs(yard.bodyBox.max[axis] - full.max[axis]), `max ${axis}`).toBeLessThan(0.03);
    }
    // and it stands on the ground, centred where the full model is
    expect(bounds(yard).min.y).toBeGreaterThan(-0.005);
    expect(bounds(yard).min.y).toBeLessThan(0.02);
    expect(Math.abs(yard.bodyBox.min.x + yard.bodyBox.max.x)).toBeLessThan(0.02);
    expect(Math.abs(yard.bodyBox.min.z + yard.bodyBox.max.z)).toBeLessThan(0.02);
  });

  it('keeps every door as its own part, with its rig', () => {
    expect(models.map(({ yard }) => yard.doors.length)).toEqual([4, 4, 4, 2, 4, 4]);
    for (const { spec, yard } of models) {
      const full = buildVehicle(spec, { detail: 60 });
      for (const door of yard.doors) {
        expect(door.parts.length, `${spec.key} ${door.id}`).toBeGreaterThanOrEqual(1);
        expect(door.parts.length, `${spec.key} ${door.id}`).toBeLessThanOrEqual(2);
        expect(door.parts[0].kind).toBe('paint');
        // the rig is the full model's own
        expect(door.rig).toEqual(full.getObjectByName(`door_${door.id}`)!.userData.door);
      }
      // a shut door fills its opening: with the doors, the body's bounds do not grow
      const box = bounds(yard);
      for (const door of yard.doors) {
        const at = new THREE.Matrix4().makeTranslation(...door.rig.pivot);
        for (const p of door.parts) {
          const b = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(at);
          // a door mirror stands out from the body side
          expect(box.clone().expandByScalar(0.3).containsBox(b), `${spec.key} ${door.id}`).toBe(true);
        }
      }
    }
  });

  it.each(models)('$spec.key: the nose is toward +Z in the yard, as the generic car is', ({ spec, yard }) => {
    // the model's own nose is +X
    const lamps = yard.body.find((p) => p.kind === 'lamps')!;
    expect(lamps, 'lamps').toBeTruthy();
    const g = toYardFrame(lamps.geometry);
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    // head lamps are white (green as bright as red), tail lamps red
    let headZ = 0, heads = 0, tailZ = 0, tails = 0;
    for (let i = 0; i < pos.count; i++) {
      if (col.getY(i) > 0.5 * col.getX(i)) { headZ += pos.getZ(i); heads++; }
      else if (col.getX(i) > 0.5 && col.getY(i) < 0.2 * col.getX(i)) { tailZ += pos.getZ(i); tails++; }
    }
    expect(heads).toBeGreaterThan(0);
    expect(tails).toBeGreaterThan(0);
    expect(headZ / heads).toBeGreaterThan(1.5);
    expect(tailZ / tails).toBeLessThan(-1.5);
    // length along Z, width along X, in plan units
    const box = yard.bodyBox.clone().applyMatrix4(YARD_FROM_MODEL);
    expect(box.max.z - box.min.z).toBeCloseTo(spec.dims.length * PLAN_UNITS_PER_METRE, 1);
    expect(box.max.x - box.min.x).toBeCloseTo(spec.dims.width * PLAN_UNITS_PER_METRE, 1);
    // the front axle is ahead of the middle: +X in the model, +Z in the yard
    const axle = new THREE.Vector3(spec.dims.length / 2 - spec.dims.frontAxle, 0, 0).applyMatrix4(YARD_FROM_MODEL);
    expect(axle.z).toBeGreaterThan(1);
    expect(Math.abs(axle.x)).toBeLessThan(1e-9);
    // the car's right (+Z in the model) is -X in the yard, the generic car's convention
    expect(new THREE.Vector3(0, 0, 1).applyMatrix4(YARD_FROM_MODEL).x).toBeCloseTo(-PLAN_UNITS_PER_METRE, 6);
  });

  it('the generic car it replaces also has its white lamps toward +Z', () => {
    const pos = VEHICLE_GEO.lamps.getAttribute('position');
    const col = VEHICLE_GEO.lamps.getAttribute('color');
    let headZ = 0, heads = 0, tailZ = 0, tails = 0;
    for (let i = 0; i < pos.count; i++) {
      if (col.getY(i) > 0.5 * col.getX(i)) { headZ += pos.getZ(i); heads++; } else { tailZ += pos.getZ(i); tails++; }
    }
    expect(headZ / heads).toBeGreaterThan(1.5);
    expect(tailZ / tails).toBeLessThan(-1.5);
  });

  it.each(models)('$spec.key: the status strips are on the body, clear of the wheel arches', ({ spec, yard }) => {
    const b = new THREE.Box3().setFromBufferAttribute(yard.status.getAttribute('position') as THREE.BufferAttribute);
    expect(yard.bodyBox.clone().expandByScalar(0.02).containsBox(b)).toBe(true);
    const d = spec.dims;
    expect(b.max.x).toBeLessThan(d.length / 2 - d.frontAxle - spec.archRadius);
    expect(b.min.x).toBeGreaterThan(d.length / 2 - d.frontAxle - d.wheelbase + spec.archRadius);
  });
});
