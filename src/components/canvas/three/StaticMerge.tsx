import { useLayoutEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * MERGED STATIC GEOMETRY for a subtree that never moves (phone lane, 2026-09-29).
 *
 * Wrap a static component (the ground, the building, the utility yard...) and,
 * once its meshes have mounted, every plain mesh under it is baked into one
 * buffer per (material, shadow flags) and the originals are hidden. Same
 * geometry, same place, same material object — so a material whose colour or
 * intensity changes at runtime still changes — just one draw call where there
 * were dozens, and one shadow-pass call where each caster had its own.
 *
 * Left alone (drawn as they were): instanced meshes (already one call),
 * transparent materials (merging would change their draw order), multi-
 * material meshes, vertex-coloured materials, points, lines, and anything
 * under an object named with a leading '~' (an opt-out for a part that moves).
 *
 * `version` must change whenever the subtree's CONTENT changes (a layout, a
 * count): the merge is redone from scratch. Between versions the subtree is
 * assumed static — that is the contract.
 */
export function StaticMerge({ version = '', children, name }: { version?: string | number; children: ReactNode; name?: string }) {
  const root = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    const g = root.current;
    if (!g) return;
    g.updateWorldMatrix(true, true);
    const toLocal = new THREE.Matrix4().copy(g.matrixWorld).invert();

    const buckets = new Map<string, { mesh: THREE.Mesh; geos: THREE.BufferGeometry[]; members: THREE.Mesh[] }>();
    const skip = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p && p !== g; p = p.parent) if (p.name.startsWith('~')) return true;
      return false;
    };
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      if (Array.isArray(m.material) || !m.visible || skip(m)) return;
      const mat = m.material as THREE.Material;
      if (mat.transparent || mat.vertexColors || m.morphTargetInfluences) return;
      const key = `${mat.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
      const b = buckets.get(key) ?? { mesh: m, geos: [], members: [] };
      let geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, m.matrixWorld));
      geo = geo.index ? geo.toNonIndexed() : geo;
      for (const a of Object.keys(geo.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') geo.deleteAttribute(a);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      b.geos.push(geo);
      b.members.push(m);
      buckets.set(key, b);
    });

    const merged: THREE.Mesh[] = [];
    const hidden: THREE.Mesh[] = [];
    for (const b of buckets.values()) {
      if (b.members.length < 2) { for (const x of b.geos) x.dispose(); continue; }
      const geo = mergeGeometries(b.geos, false);
      for (const x of b.geos) x.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const out = new THREE.Mesh(geo, b.mesh.material);
      out.name = `merged:${(b.mesh.material as THREE.Material).name || (b.mesh.material as THREE.Material).type}`;
      out.castShadow = b.mesh.castShadow;
      out.receiveShadow = b.mesh.receiveShadow;
      out.renderOrder = b.mesh.renderOrder;
      g.add(out);
      merged.push(out);
      for (const m of b.members) { m.visible = false; hidden.push(m); }
    }
    return () => {
      for (const m of merged) { g.remove(m); m.geometry.dispose(); }
      for (const m of hidden) m.visible = true;
    };
  }, [version]);

  return <group ref={root} name={name}>{children}</group>;
}
