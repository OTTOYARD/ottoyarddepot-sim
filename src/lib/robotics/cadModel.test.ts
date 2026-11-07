// cadModel.test.ts — the viewer core on a hand-built scene: joints pose about their own axis, parts explode along
// their vector and come back, isolation ghosts or hides, a selected part shows through an x-ray, fasteners hide, and a
// pick finds the part from any of its meshes.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { explodeCad, highlightCad, indexCad, partAt, poseCad, stowedAngles } from './cadModel';

function scene() {
  const root = new THREE.Group();
  root.userData = { robot: 'test' };
  const j = new THREE.Group();
  j.position.set(0, 1, 0);
  j.userData = { sub: 'J2', joint: { name: 'J2', axis: [1, 0, 0], limits: [-2, 2], kind: 'revolute', stowed: 0.5 } };
  const s = new THREE.Group();
  s.userData = { sub: 'S', joint: { name: 'S', axis: [0, -1, 0], limits: [0, 1], kind: 'prismatic', stowed: 0 } };
  const mk = (part: string, sub: string, ex?: number[]) => {
    const o = new THREE.Group();
    o.userData = { part, sub, ...(ex ? { explode: ex } : {}) };
    o.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial()));
    return o;
  };
  const a = mk('LINK', 'J2', [0, 0, 0.5]);
  const b = mk('ISO4762-M8x30-12.9', 'J2', [0.1, 0, 0]);
  const c = mk('BASE', 'MOUNT');
  j.add(a, b);
  root.add(j, s, c);
  return { root, j, s, a, b, c };
}

describe('cadModel', () => {
  it('indexes parts and joints, and poses a revolute and a prismatic joint', () => {
    const { root, j, s } = scene();
    const m = indexCad(root);
    expect(m.robot).toBe('test');
    expect(m.parts.map((p) => p.part)).toEqual(['LINK', 'ISO4762-M8x30-12.9', 'BASE']);
    expect(stowedAngles(m)).toEqual({ J2: 0.5, S: 0 });
    poseCad(m, { J2: Math.PI / 2, S: 0.25 });
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(j.quaternion).z).toBeCloseTo(1, 6);   // +Y leans to +Z
    expect(s.position.y).toBeCloseTo(-0.25, 6);
    poseCad(m, { J2: 9 });                                                                   // clamped to the limit
    expect(new THREE.Euler().setFromQuaternion(j.quaternion).x).toBeCloseTo(2, 6);
  });
  it('explodes along each vector and returns exactly', () => {
    const { root, a, b } = scene();
    const m = indexCad(root);
    explodeCad(m, 1);
    expect(a.position.z).toBeCloseTo(0.5, 6);
    expect(b.position.x).toBeCloseTo(0.1, 6);
    explodeCad(m, 0);
    expect(a.position.toArray()).toEqual([0, 0, 0]);
  });
  it('isolates, x-rays to a selected part, hides fasteners, and picks from a mesh', () => {
    const { root, a, b, c } = scene();
    const m = indexCad(root);
    const meshOf = (o: THREE.Object3D) => o.children[0] as THREE.Mesh;
    highlightCad(m, { isolate: 'J2', ghostOthers: false });
    expect(c.visible).toBe(false);
    highlightCad(m, { isolate: 'J2', ghostOthers: true });
    expect(c.visible).toBe(true);
    expect((meshOf(c).material as THREE.MeshStandardMaterial).opacity).toBeLessThan(0.5);
    highlightCad(m, { selected: 'LINK', xraySelected: true });
    expect((meshOf(b).material as THREE.MeshStandardMaterial).opacity).toBeLessThan(0.5);
    expect(meshOf(a).material).not.toBe(m.baseMaterial.get(meshOf(a).id));
    highlightCad(m, { hideFasteners: true, fasteners: new Set(['ISO4762-M8x30-12.9']) });
    expect(b.visible).toBe(false);
    expect(meshOf(a).material).toBe(m.baseMaterial.get(meshOf(a).id));
    expect(partAt(m, meshOf(b))?.part).toBe('ISO4762-M8x30-12.9');
    expect(partAt(m, root)).toBeNull();
  });
});
