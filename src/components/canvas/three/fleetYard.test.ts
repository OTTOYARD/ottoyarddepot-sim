import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FLEET_SPECS, buildVehicle, setDoors } from '@/lib/fleetModels';
import { bakeYardModel, YARD_FROM_MODEL } from '@/lib/fleetModels/yardLod';
import { commitModelFleet, makeModelFleet, writeModelCar } from './fleetYard';
import { writeYaw } from './fleetMath';

/**
 * What the instanced model fleet writes must be the generic car's own transform for the body, and that transform
 * times the full model's door pose for each door: the same picture buildVehicle + setDoors gives, in the yard.
 */

const models = FLEET_SPECS.map((spec) => ({ spec, model: bakeYardModel(spec) }));
const X = 37.5, Y = 0.26, Z = -12.25, YAW = 0.83;

const at = (a: ArrayLike<number>, slot: number) => new THREE.Matrix4().fromArray(Array.from(a).slice(slot * 16, slot * 16 + 16));
const close = (a: THREE.Matrix4, b: THREE.Matrix4, eps = 1e-4) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < eps);

describe('the instanced vehicle model fleet', () => {
  it.each(models)('$spec.key: at most 15 draw calls for every car of the model, and one in the shadow pass', ({ model }) => {
    const fleet = makeModelFleet(model, 32);
    expect(fleet.draws.main).toBeLessThanOrEqual(15);
    expect(fleet.body.length).toBeLessThanOrEqual(8);
    expect(fleet.meshes.filter((m) => m.castShadow)).toEqual([fleet.shadow]);
    expect(fleet.meshes[0]).toBe(fleet.pick);
    fleet.setCount(7);
    expect(fleet.meshes.every((m) => m.count === 7)).toBe(true);
    // every static part rides the one car buffer
    for (const m of fleet.body) expect(m.instanceMatrix).toBe(fleet.carM);
    expect(fleet.shadow.instanceMatrix).toBe(fleet.carM);
    fleet.dispose();
  });

  it.each(models)("$spec.key: the body is written with the generic car's transform", ({ model }) => {
    const fleet = makeModelFleet(model, 4);
    writeModelCar(fleet, 2, X, Y, Z, YAW, 0, 0, true);
    commitModelFleet(fleet);
    const generic = new Float32Array(16 * 4);
    writeYaw(generic, 2, X, Y, Z, YAW);
    expect(close(at(fleet.carM.array, 2), at(generic, 2))).toBe(true);
    // lit: the strips ride the car; not lit: they are hidden
    expect(close(at(fleet.status.instanceMatrix.array, 2), at(generic, 2))).toBe(true);
    writeModelCar(fleet, 2, X, Y, Z, YAW, 0, 0, false);
    expect(Array.from(fleet.status.instanceMatrix.array).slice(32, 48).every((v) => v === 0)).toBe(true);
    fleet.dispose();
  });

  it.each(models)('$spec.key: each door is where the full model puts it, shut and open', ({ spec, model }) => {
    const fleet = makeModelFleet(model, 1);
    const full = buildVehicle(spec, { detail: 40 });
    const car = new THREE.Matrix4().makeRotationY(YAW).setPosition(X, Y, Z).multiply(YARD_FROM_MODEL);
    for (const [right, left] of [[0, 0], [1, 1], [0.4, 0], [0, 0.7]]) {
      writeModelCar(fleet, 0, X, Y, Z, YAW, right, left, false);
      // the door store's `right` is the car's right flank: the rig's side +1
      setDoors(full, Object.fromEntries(model.doors.map((d) => [d.id, d.rig.side > 0 ? right : left])));
      full.updateMatrixWorld(true);
      model.doors.forEach((d, i) => {
        const want = car.clone().multiply(full.getObjectByName(`door_${d.id}`)!.matrixWorld);
        expect(close(at(fleet.doors[i].m.array, 0), want), `${d.id} at ${right}/${left}`).toBe(true);
      });
    }
    fleet.dispose();
  });

  it.each(models)('$spec.key: each door of a flank takes its own opening when the door store gives one, front to rear', ({ spec, model }) => {
    const fleet = makeModelFleet(model, 1);
    const full = buildVehicle(spec, { detail: 40 });
    const car = new THREE.Matrix4().makeRotationY(YAW).setPosition(X, Y, Z).multiply(YARD_FROM_MODEL);
    // a flank's doors front to rear: the door whose pivot is nearer the nose first
    const rank = (d: (typeof model.doors)[number]) => model.doors.filter((o) => o.rig.side === d.rig.side && o.rig.pivot[0] > d.rig.pivot[0]).length;
    const perFlank = Math.max(...model.doors.map(rank)) + 1;
    for (let open = 0; open < perFlank; open++) {
      // the left flank: only door `open` stands open (0.8), the flank's value says 1; the right flank all at 0.3
      const leftEach = Array.from({ length: perFlank }, (_, k) => (k === open ? 0.8 : 0));
      writeModelCar(fleet, 0, X, Y, Z, YAW, 0.3, 1, false, undefined, leftEach);
      setDoors(full, Object.fromEntries(model.doors.map((d) => [d.id, d.rig.side > 0 ? 0.3 : leftEach[rank(d)]])));
      full.updateMatrixWorld(true);
      model.doors.forEach((d, i) => {
        const want = car.clone().multiply(full.getObjectByName(`door_${d.id}`)!.matrixWorld);
        expect(close(at(fleet.doors[i].m.array, 0), want), `${d.id}, left door ${open} open`).toBe(true);
      });
    }
    fleet.dispose();
  });

  it.each(models)('$spec.key: an open door stands outboard on its own flank of the yard car', ({ model }) => {
    const fleet = makeModelFleet(model, 1);
    // car at the origin facing +Z: its right flank is -X (the generic car's convention)
    const centre = (i: number) => {
      const box = new THREE.Box3();
      for (const p of model.doors[i].parts) box.union(new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute));
      return box.getCenter(new THREE.Vector3()).applyMatrix4(at(fleet.doors[i].m.array, 0));
    };
    writeModelCar(fleet, 0, 0, 0, 0, 0, 0, 0, false);
    const shut = model.doors.map((_, i) => centre(i));
    writeModelCar(fleet, 0, 0, 0, 0, 0, 1, 1, false);
    model.doors.forEach((d, i) => {
      const moved = centre(i).sub(shut[i]);
      expect(-d.rig.side * moved.x, d.id).toBeGreaterThan(0.1);
    });
    fleet.dispose();
  });
});
