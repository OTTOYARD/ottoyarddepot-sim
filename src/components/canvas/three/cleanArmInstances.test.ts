import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CLEAN_TEMPLATE, CLEAN_PARTS, cleanSkeleton, makeCleanArmFleet, writeCleanArm } from './cleanArmInstances';
import { poseCleanArm, buildCleanArm } from '@/lib/ottoCleanArm/buildCleanArm';
import { cleanJointsAt, sidesFor } from '@/lib/ottoCleanArm/cleanArmPose';
import { CLEAN_CHAIN } from '@/lib/ottoCleanArm/cleanArmSpec';

/**
 * The instanced cleaning arms must draw EXACTLY the geometry a whole clone of the
 * template draws, at every pose of the cycle: same triangles, same materials, same
 * shadow casters, same world positions.
 */

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

function place(root: THREE.Object3D) {
  root.position.set(-47, 0.26, -18);
  root.rotation.y = 2.6;
  root.scale.setScalar(2.09);
}

describe('cleanArmInstances — the instanced OTTO-CLEAN ARM draws what the clone draws', () => {
  it('draws every arm on the site in fewer calls than ONE arm has meshes', () => {
    // measured 2026-10-19: 38 meshes (27 shadow casters) an arm as a clone; 28
    // instanced parts (17 casters) for all of them, at ten arms or twenty
    let meshes = 0, casters = 0;
    CLEAN_TEMPLATE.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes++; if (o.castShadow) casters++; } });
    expect(CLEAN_PARTS.length).toBeLessThan(meshes);
    expect(CLEAN_PARTS.filter((p) => p.castShadow).length).toBeLessThan(casters);
  });

  it('matches the clone vertex for vertex at poses through the whole cycle, on both flanks', () => {
    const fleet = makeCleanArmFleet(4);
    for (const toward of [1, -1] as const) {
      const sides = sidesFor(toward);
      for (const phase of CLEAN_CHAIN) {
        const q = cleanJointsAt(phase, 0.37, sides);
        const clone = buildCleanArm();
        poseCleanArm(clone.nodes, q);
        place(clone.root);
        clone.root.updateMatrixWorld(true);
        const want: Parameters<typeof signature>[0] = [];
        clone.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) want.push({ geo: m.geometry, world: m.matrixWorld, mat: m.material as THREE.Material, cast: m.castShadow });
        });

        const sk = cleanSkeleton();
        poseCleanArm(sk.nodes, q);
        place(sk.root);
        sk.root.updateMatrixWorld(true);
        writeCleanArm(fleet, 2, sk.segments, 0x35d07f, 1);
        const got = CLEAN_PARTS.map((p, i) => {
          const m = new THREE.Matrix4();
          fleet.meshes[i].getMatrixAt(2, m);
          return { geo: p.geometry, world: m, mat: p.material, cast: p.castShadow };
        });
        const a = signature(want), b = signature(got);
        expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
        for (const [k, s] of a) {
          const t = b.get(k)!;
          expect(t.n).toBe(s.n);
          // the instance matrices are float32: at ~50 units from the origin one ulp is ~4e-6
          for (const ax of ['sx', 'sy', 'sz'] as const) expect(Math.abs(t[ax] - s[ax]) / Math.max(1, s.n)).toBeLessThan(2e-5);
        }
      }
    }
    fleet.dispose();
  });

  it('leaves every unused slot empty', () => {
    const fleet = makeCleanArmFleet(3);
    const m = new THREE.Matrix4();
    fleet.meshes[0].getMatrixAt(1, m);
    expect(m.elements.every((x) => x === 0)).toBe(true);
    fleet.dispose();
  });
});
