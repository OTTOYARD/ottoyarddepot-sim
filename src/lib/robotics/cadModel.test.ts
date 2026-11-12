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

describe('fitDistance', () => {
  it('fits a sphere on the tighter angle: a wide view by its height, a narrow view by its width', async () => {
    const { fitDistance } = await import('./cadModel');
    const v = (35 * Math.PI) / 180 / 2;
    expect(fitDistance(1, 35, 2, 1)).toBeCloseTo(1 / Math.sin(v), 9);            // wide: the vertical angle binds
    const h = Math.atan(Math.tan(v) * 0.5);
    expect(fitDistance(1, 35, 0.5, 1)).toBeCloseTo(1 / Math.sin(h), 9);          // tall: the horizontal angle binds
    expect(fitDistance(1, 35, 0.5)).toBeGreaterThan(fitDistance(1, 35, 2));
    expect(fitDistance(2, 35, 1)).toBeCloseTo(2 * fitDistance(1, 35, 1), 9);
  });
});

describe('fitBox', () => {
  it('puts every corner of the box inside both view angles, and no further back than it must', async () => {
    const { fitBox } = await import('./cadModel');
    const box = new THREE.Box3(new THREE.Vector3(-0.3, -2.2, -0.4), new THREE.Vector3(0.9, 0.4, 0.5)); // tall and thin
    for (const [dir, aspect] of [[[1, 0.6, 1.15], 2.4], [[0, 0.12, 1], 0.6], [[0.0001, 1, 0.02], 1.9], [[1, 0.12, 0], 1]] as const) {
      const d = new THREE.Vector3(...dir).normalize();
      const { centre, distance } = fitBox(box, d, 35, aspect, 1);
      const cam = new THREE.PerspectiveCamera(35, aspect, 0.01, 100);
      cam.position.copy(centre).addScaledVector(d, distance);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      let edge = 0;
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-6);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-6);
        edge = Math.max(edge, Math.abs(p.x), Math.abs(p.y));
      }
      expect(edge).toBeGreaterThan(0.98); // a corner touches the edge: the fit is tight
    }
  });
});
