import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ARM_TEMPLATE, ARM_PARTS, ARM_SEGMENTS, armSkeleton, segmentNodes, makeArmFleet, writeArm } from './armInstances';

/**
 * The instanced arms must draw EXACTLY the geometry the per-arm clones drew,
 * at every pose: same triangles, same materials, same shadow casters, same
 * world positions. Pose a full template clone and a skeleton with the same
 * joint angles, and compare what each would put on screen.
 */

type Pose = Record<(typeof ARM_SEGMENTS)[number], (o: THREE.Object3D) => void>;
const pose = (seed: number): Pose => {
  const r = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 1.2;
  return {
    J1_BaseYaw: (o) => o.rotation.set(0, r(1), 0),
    J2_Shoulder: (o) => o.rotation.set(r(2), 0, 0),
    J3_Elbow: (o) => o.rotation.set(r(3), 0, 0),
    J4_ForearmRoll: (o) => o.rotation.set(0, r(4), 0),
    J5_WristPitch: (o) => o.rotation.set(r(5), 0, 0),
    J6_ToolRoll: (o) => o.rotation.set(0, r(6), 0),
    Connector_Latch: (o) => o.scale.set(0.8, 1, 0.8),
  };
};

function apply(root: THREE.Object3D, p: Pose) {
  for (const n of ARM_SEGMENTS) p[n](root.getObjectByName(n)!);
  root.position.set(31, 0.26, -12);
  root.rotation.y = 0.7;
  root.scale.setScalar(2.09);
  root.updateMatrixWorld(true);
}

/** Per material name + caster flag: vertex count and the sum of world positions. */
function signature(entries: { geo: THREE.BufferGeometry; world: THREE.Matrix4; mat: THREE.Material; cast: boolean }[]) {
  const sig = new Map<string, { n: number; sx: number; sy: number; sz: number }>();
  const v = new THREE.Vector3();
  for (const e of entries) {
    const g = e.geo.index ? e.geo.toNonIndexed() : e.geo;
    const pos = g.attributes.position;
    const k = `${e.mat.name}|${e.cast}`;
    const s = sig.get(k) ?? { n: 0, sx: 0, sy: 0, sz: 0 };
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(e.world);
      s.n++; s.sx += v.x; s.sy += v.y; s.sz += v.z;
    }
    sig.set(k, s);
  }
  return sig;
}

describe('armInstances — the instanced OTTO-CHARGE ARM draws what the clone drew', () => {
  it('cuts the template into far fewer draw calls than meshes', () => {
    let meshes = 0, casters = 0;
    ARM_TEMPLATE.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes++; if (o.castShadow) casters++; } });
    const partCasters = ARM_PARTS.filter((p) => p.castShadow).length;
    expect(ARM_PARTS.length).toBeLessThan(meshes);
    expect(partCasters).toBeLessThan(casters);
  });

  for (const seed of [1, 2, 3]) {
    it(`same world geometry per material at pose ${seed}`, () => {
      const full = ARM_TEMPLATE.root.clone(true);
      apply(full, pose(seed));
      const before: Parameters<typeof signature>[0] = [];
      full.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) before.push({ geo: m.geometry, world: m.matrixWorld, mat: m.material as THREE.Material, cast: m.castShadow });
      });

      const skel = armSkeleton();
      apply(skel, pose(seed));
      const nodes = segmentNodes(skel);
      const after = ARM_PARTS.map((p) => ({ geo: p.geometry, world: nodes[p.segment].matrixWorld, mat: p.material, cast: p.castShadow }));

      const a = signature(before), b = signature(after);
      expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
      for (const [k, s] of a) {
        const t = b.get(k)!;
        expect(t.n).toBe(s.n);
        expect(t.sx).toBeCloseTo(s.sx, 2);
        expect(t.sy).toBeCloseTo(s.sy, 2);
        expect(t.sz).toBeCloseTo(s.sz, 2);
      }
    });
  }

  it('a skeleton carries no meshes (nothing is drawn twice)', () => {
    let meshes = 0;
    armSkeleton().traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBe(0);
  });

  it('writeArm fills its own slot only, with the status colour and glow', () => {
    const fleet = makeArmFleet(4);
    const skel = armSkeleton();
    apply(skel, pose(1));
    writeArm(fleet, 2, segmentNodes(skel), 0x35d07f, 1.3);
    const m = new THREE.Matrix4();
    fleet.meshes[0].getMatrixAt(2, m);
    const want = segmentNodes(skel)[ARM_PARTS[0].segment].matrixWorld;
    m.elements.forEach((x, i) => expect(x).toBeCloseTo(want.elements[i], 4)); // float32 storage
    fleet.meshes[0].getMatrixAt(1, m);
    expect(m.elements.every((x) => x === 0)).toBe(true);
    const c = new THREE.Color(0x35d07f);
    expect(fleet.statusColor.getX(2)).toBeCloseTo(c.r, 5);
    expect(fleet.glow.getX(2)).toBeCloseTo(1.3, 5);
    expect(fleet.glow.getX(1)).toBe(0);
    fleet.dispose();
  });

  it('twenty arms cost the same draw calls as ten', () => {
    // one InstancedMesh per part, whatever the capacity
    expect(makeArmFleet(10).meshes.length).toBe(ARM_PARTS.length);
    expect(makeArmFleet(20).meshes.length).toBe(ARM_PARTS.length);
  });
});
