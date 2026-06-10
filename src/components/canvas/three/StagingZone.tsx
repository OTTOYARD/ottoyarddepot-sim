import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { PARK_RUNS } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * Perimeter parking: painted stall lines + SOLAR CARPORTS over every run
 * (weather cover + extra PV capacity). Geometry from the site plan.
 */
export function StagingZone({ count: _count }: { count: number }) {
  const mats = useMemo(() => ({
    roof: MATERIALS.darkCladding(),
    steel: MATERIALS.structuralSteel(),
  }), []);

  // instanced stall side-lines (2 per stall)
  const stripes = useMemo(() => {
    const total = PARK_RUNS.reduce((n, r) => n + r.n, 0) * 2;
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 0.05, 10.5), MATERIALS.laneMarkingWhite(), total,
    );
    const d = new THREE.Object3D();
    let i = 0;
    for (const run of PARK_RUNS) {
      const across = run.angle === 90; // stalls along a column → car oriented east-west
      for (let k = 0; k < run.n; k++) {
        const x = run.x0 + k * run.dx, y = run.y0 + k * run.dy;
        const [wx, , wz] = toWorld({ x, y }, 0);
        for (const side of [-1, 1]) {
          if (across) {
            d.position.set(wx, 0.05, wz + side * 2.9);
            d.rotation.set(0, Math.PI / 2, 0);
          } else {
            d.position.set(wx + side * 2.9, 0.05, wz);
            d.rotation.set(0, 0, 0);
          }
          d.updateMatrix();
          inst.setMatrixAt(i++, d.matrix);
        }
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, []);

  // carports: roof + flush PV + posts
  const carports = useMemo(() => PARK_RUNS.map((run) => {
    const r = run.carport;
    const [cx, , cz] = toWorld({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, 0);
    const H = 8;
    const cols = Math.max(1, Math.floor((r.w - 1.5) / 4.4));
    const rows = Math.max(1, Math.floor((r.h - 1.5) / 4.4));
    const pv = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.0, 0.13, 4.0), MATERIALS.solarPanelGlass(), cols * rows,
    );
    const d = new THREE.Object3D();
    let i = 0;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      d.position.set(
        -r.w / 2 + 0.75 + (a + 0.5) * ((r.w - 1.5) / cols),
        H + 0.5,
        -r.h / 2 + 0.75 + (b + 0.5) * ((r.h - 1.5) / rows),
      );
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      pv.setMatrixAt(i++, d.matrix);
    }
    pv.instanceMatrix.needsUpdate = true;

    // posts along the inner edge (single row, cantilever style)
    const posts: [number, number][] = [];
    if (r.w >= r.h) {
      for (let x = -r.w / 2 + 4; x <= r.w / 2 - 4; x += 20) posts.push([x, 0]);
    } else {
      for (let z = -r.h / 2 + 4; z <= r.h / 2 - 4; z += 20) posts.push([0, z]);
    }
    return { id: run.id, cx, cz, w: r.w, d: r.h, H, pv, posts };
  }), []);

  return (
    <group>
      <primitive object={stripes} />
      {carports.map((c) => (
        <group key={c.id} position={[c.cx, 0, c.cz]}>
          <mesh position={[0, c.H, 0]} castShadow material={mats.roof}>
            <boxGeometry args={[c.w, 0.5, c.d]} />
          </mesh>
          <primitive object={c.pv} />
          {c.posts.map(([px, pz], i) => (
            <mesh key={i} position={[px, c.H / 2, pz]} castShadow material={mats.steel}>
              <boxGeometry args={[0.8, c.H, 0.8]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
