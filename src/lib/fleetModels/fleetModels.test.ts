import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVehicle, doorNodes, FLEET_SPECS, setDoors, type DoorRig } from './index';

// A lighter mesh than the app builds: the measurements below do not depend on the density.
const cars = FLEET_SPECS.map((spec) => ({ spec, car: buildVehicle(spec, { detail: 90 }) }));

/** Bounds of the painted body and its doors, without wheels, mirrors or sensors. */
function bodyBox(car: THREE.Object3D): THREE.Box3 {
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

describe('fleet vehicle models', () => {
  it('has six vehicles with distinct keys', () => {
    expect(FLEET_SPECS.length).toBe(6);
    expect(new Set(FLEET_SPECS.map((s) => s.key)).size).toBe(6);
  });

  it.each(cars)('$spec.key: the body measures its stated length, width and height', ({ spec, car }) => {
    setDoors(car, 0);
    const size = bodyBox(car).getSize(new THREE.Vector3());
    expect(Math.abs(size.x - spec.dims.length)).toBeLessThan(0.01);
    expect(Math.abs(size.z - spec.dims.width)).toBeLessThan(0.012);
    // Height is measured from the ground, where the tyres stand.
    expect(Math.abs(bodyBox(car).max.y - (spec.dims.bodyHeight ?? spec.dims.height))).toBeLessThan(0.012);
  });

  it.each(cars)('$spec.key: four wheels stand on the ground at the stated wheelbase', ({ spec, car }) => {
    const w = ['FL', 'FR', 'RL', 'RR'].map((n) => car.getObjectByName(`wheel_${n}`)!);
    expect(w.every(Boolean)).toBe(true);
    expect(w[0].position.x - w[2].position.x).toBeCloseTo(spec.dims.wheelbase, 3);
    expect(w[0].position.y).toBeCloseTo(spec.dims.tyreRadius, 6);
    expect(w[1].position.z - w[0].position.z).toBeCloseTo(spec.dims.track, 6);
  });

  it('the Zoox reaches its published height at its roof housings', () => {
    const { spec, car } = cars.find((c) => c.spec.key === 'zoox_robotaxi')!;
    car.updateMatrixWorld(true);
    const top = Math.max(...['roof_f', 'roof_r'].map((id) => new THREE.Box3().setFromObject(car.getObjectByName(`sensor_${id}`)!).max.y));
    expect(Math.abs(top - spec.dims.height)).toBeLessThan(0.01);
  });

  it('gives each vehicle the doors it has on the road', () => {
    const kinds = Object.fromEntries(cars.map(({ spec, car }) => [spec.key, doorNodes(car).map((n) => (n.userData.door as DoorRig).kind)]));
    expect(kinds.waymo_ojai).toEqual(['slide', 'slide', 'slide', 'slide']);
    expect(kinds.zoox_robotaxi).toEqual(['slide', 'slide', 'slide', 'slide']);
    expect(kinds.waymo_ipace).toEqual(['hinge', 'hinge', 'hinge', 'hinge']);
    expect(kinds.tesla_model_y).toEqual(['hinge', 'hinge', 'hinge', 'hinge']);
    expect(kinds.lucid_gravity_nuro).toEqual(['hinge', 'hinge', 'hinge', 'hinge']);
    expect(kinds.tesla_cybercab).toEqual(['butterfly', 'butterfly']);
  });

  it.each(cars)('$spec.key: every door opens away from the body, and both sides mirror each other', ({ car }) => {
    const centre = (n: THREE.Object3D) => { car.updateMatrixWorld(true); return new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3()); };
    const moved = new Map<string, THREE.Vector3>();
    for (const n of doorNodes(car)) {
      const rig = n.userData.door as DoorRig;
      setDoors(car, 0);
      const shut = centre(n);
      setDoors(car, 1);
      const open = centre(n);
      const d = open.clone().sub(shut);
      moved.set(rig.id, d);
      // Outboard on its own side, or along the body for a slider, never into the cabin.
      expect(d.z * rig.side).toBeGreaterThan(0.05);
      if (rig.kind === 'butterfly') expect(d.y).toBeGreaterThan(0.25);
      if (rig.kind === 'slide') expect(Math.abs(d.x)).toBeGreaterThan(0.5);
    }
    setDoors(car, 0);
    for (const [id, d] of moved) {
      if (!id.endsWith('L')) continue;
      const other = moved.get(`${id.slice(0, -1)}R`)!;
      expect(other.x).toBeCloseTo(d.x, 2);
      expect(other.y).toBeCloseTo(d.y, 2);
      expect(other.z).toBeCloseTo(-d.z, 2);
    }
  });

  it('sliding doors on one side part: the front runs toward the nose, the rear toward the tail', () => {
    for (const key of ['waymo_ojai', 'zoox_robotaxi']) {
      const car = cars.find((c) => c.spec.key === key)!.car;
      const rig = (id: string) => car.getObjectByName(`door_${id}`)!.userData.door as DoorRig;
      expect(rig('FR').along![0]).toBeGreaterThan(0);
      expect(rig('RR').along![0]).toBeLessThan(0);
    }
  });

  it('draws the sensor counts the makers have published', () => {
    const count = (key: string, type: string) => cars.find((c) => c.spec.key === key)!.spec.sensors.filter((s) => s.type === type).length;
    // Waymo, 6th-generation Driver: 13 cameras, 4 lidar, 6 radar.
    expect([count('waymo_ojai', 'camera'), count('waymo_ojai', 'lidar'), count('waymo_ojai', 'radar')]).toEqual([13, 4, 6]);
    // Waymo, 5th generation: one 360 lidar and four perimeter lidars.
    expect(count('waymo_ipace', 'lidar')).toBe(5);
    // Tesla: eight outward cameras, nothing else.
    for (const key of ['tesla_cybercab', 'tesla_model_y']) {
      expect(count(key, 'camera')).toBe(8);
      expect(count(key, 'lidar') + count(key, 'radar')).toBe(0);
    }
    // Zoox: a pod at each of four corners.
    expect(cars.find((c) => c.spec.key === 'zoox_robotaxi')!.spec.sensors.filter((s) => s.id.startsWith('pod_')).length).toBe(4);
  });

  it.each(cars)('$spec.key: every sensor is a named node on or outside the body', ({ spec, car }) => {
    const box = bodyBox(car).expandByScalar(0.35);
    for (const s of spec.sensors) {
      const n = car.getObjectByName(`sensor_${s.id}`);
      expect(n, s.id).toBeTruthy();
      expect(box.containsPoint(n!.getWorldPosition(new THREE.Vector3())), s.id).toBe(true);
    }
  });

  it('records a charge port only where one is known or stated as an assumption', () => {
    const port = (key: string) => cars.find((c) => c.spec.key === key)!.car.getObjectByName('charge_port');
    expect(port('waymo_ipace')!.position.z).toBeLessThan(0); // left front wing
    expect(port('waymo_ipace')!.position.x).toBeGreaterThan(0);
    expect(port('tesla_model_y')!.position.x).toBeLessThan(0); // left rear
    expect(port('tesla_cybercab')).toBeUndefined();
    expect(port('zoox_robotaxi')).toBeUndefined();
  });
});
