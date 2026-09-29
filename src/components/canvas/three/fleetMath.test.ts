import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { writeYaw, writeZero, portWorld } from './fleetMath';

/**
 * The instanced fleet writes each car's matrices by hand. Before instancing a
 * car was a <group position={[x,0,z]} rotation-y={yaw}> holding the body at
 * [0, DECK_Y, 0] and the charge port in a nested <group position rotation-y>.
 * These pin the hand-written matrices to what three composed for those groups,
 * so the arm's IK target and the port ring on screen stay one world point
 * (depotIntegration.test.ts reasons in the same frames).
 */
describe('fleetMath — instanced transforms equal the old per-car groups', () => {
  const cases: [number, number, number][] = [[0, 0, 0], [12.5, -40, 1.1], [-88, 63, -2.7], [3, 3, Math.PI]];

  it('writeYaw is Object3D(position, rotation.y).matrix', () => {
    const a = new Float32Array(32);
    for (const [x, z, yaw] of cases) {
      writeYaw(a, 1, x, 0.26, z, yaw);
      const o = new THREE.Object3D();
      o.position.set(x, 0.26, z);
      o.rotation.y = yaw;
      o.updateMatrix();
      const got = new THREE.Matrix4().fromArray(a, 16);
      got.elements.forEach((v, i) => expect(v).toBeCloseTo(o.matrix.elements[i], 6));
    }
  });

  it('portWorld is the nested port group composed with the car group', () => {
    const out = { x: 0, y: 0, z: 0, yaw: 0 };
    for (const [x, z, yaw] of cases) {
      for (const [pos, pyaw] of [[[2, 1.4, -3.1], 0], [[-2, 1.2, 2.2], Math.PI]] as [[number, number, number], number][]) {
        const car = new THREE.Group();
        car.position.set(x, 0, z);
        car.rotation.y = yaw;
        const port = new THREE.Group();
        port.position.set(...pos);
        port.rotation.y = pyaw;
        car.add(port);
        car.updateMatrixWorld(true);
        const p = new THREE.Vector3().setFromMatrixPosition(port.matrixWorld);
        portWorld(x, z, yaw, pos, pyaw, out);
        expect(out.x).toBeCloseTo(p.x, 6);
        expect(out.y).toBeCloseTo(p.y, 6);
        expect(out.z).toBeCloseTo(p.z, 6);
        const m = new THREE.Matrix4();
        writeYaw(m.elements as unknown as Float32Array, 0, out.x, out.y, out.z, out.yaw);
        m.elements.forEach((v, i) => expect(v).toBeCloseTo(port.matrixWorld.elements[i], 6));
      }
    }
  });

  it('writeZero hides a slot (a zero matrix draws nothing)', () => {
    const a = new Float32Array(32).fill(7);
    writeZero(a, 1);
    expect([...a.slice(16)].every((v) => v === 0)).toBe(true);
    expect([...a.slice(0, 16)].every((v) => v === 7)).toBe(true);
  });
});
