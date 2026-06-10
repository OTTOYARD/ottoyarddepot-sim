import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { CANOPIES } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * The three central charging canopies (site plan: A=DCFC, B/C=L2).
 * Flat steel roof with a flush instanced PV array, posts along both edges.
 * `solarKWdc` kept for API compatibility (scales panel emissive slightly).
 */
export function SolarCanopy({ solarKWdc }: { solarKWdc: number }) {
  const H = 11; // canopy clearance height (~17 ft)

  const mats = useMemo(() => ({
    roof: MATERIALS.darkCladding(),
    steel: MATERIALS.structuralSteel(),
    trim: MATERIALS.brushedAluminum(),
  }), []);

  const canopies = useMemo(() => CANOPIES.map((c) => {
    const [cx, , cz] = toWorld({ x: c.cx, y: c.y + c.h / 2 }, 0);

    // flush PV array (instanced)
    const cols = Math.floor((c.w - 2) / 4.4);
    const rows = Math.floor((c.h - 2) / 4.4);
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.0, 0.14, 4.0),
      MATERIALS.solarPanelGlass(),
      cols * rows,
    );
    const d = new THREE.Object3D();
    let i = 0;
    for (let a = 0; a < cols; a++) {
      for (let b = 0; b < rows; b++) {
        d.position.set(
          -c.w / 2 + 1 + (a + 0.5) * ((c.w - 2) / cols),
          H + 0.62,
          -c.h / 2 + 1 + (b + 0.5) * ((c.h - 2) / rows),
        );
        d.updateMatrix();
        inst.setMatrixAt(i++, d.matrix);
      }
    }
    inst.instanceMatrix.needsUpdate = true;

    // posts along both x-edges
    const postZ: number[] = [];
    for (let z = -c.h / 2 + 5; z <= c.h / 2 - 5; z += 22) postZ.push(z);

    return { id: c.id, cx, cz, w: c.w, h: c.h, inst, postZ };
  }), []);

  return (
    <group>
      {canopies.map((c) => (
        <group key={c.id} position={[c.cx, 0, c.cz]}>
          {/* roof slab */}
          <mesh position={[0, H, 0]} castShadow material={mats.roof}>
            <boxGeometry args={[c.w, 0.7, c.h]} />
          </mesh>
          <mesh position={[0, H - 0.42, 0]} material={mats.trim}>
            <boxGeometry args={[c.w + 0.3, 0.14, c.h + 0.3]} />
          </mesh>
          {/* PV array */}
          <primitive object={c.inst} />
          {/* posts */}
          {c.postZ.map((z, i) => (
            <group key={i}>
              <mesh position={[-c.w / 2 + 1.4, H / 2, z]} castShadow material={mats.steel}>
                <boxGeometry args={[1.0, H, 1.0]} />
              </mesh>
              <mesh position={[c.w / 2 - 1.4, H / 2, z]} castShadow material={mats.steel}>
                <boxGeometry args={[1.0, H, 1.0]} />
              </mesh>
            </group>
          ))}
          {/* under-canopy LED strip (soft, scaled by solar config) */}
          <mesh position={[0, H - 0.55, 0]}>
            <boxGeometry args={[c.w - 4, 0.06, 0.3]} />
            <primitive object={MATERIALS.whiteLED(Math.min(2.5, 1 + solarKWdc / 600))} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
