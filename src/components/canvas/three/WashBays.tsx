import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { WASH } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * 3 PULL-THROUGH wash bays beside the operations building (travel lane
 * between them). South glass entry doors, north rear exits. Rooftop PV.
 */
export function WashBays({ count }: { count: number }) {
  const H = 10;
  const [cx, , cz] = toWorld({ x: WASH.x + WASH.w / 2, y: WASH.y + WASH.h / 2 }, 0);
  const w = WASH.w, d = WASH.h;

  const mats = useMemo(() => ({
    shell: MATERIALS.anodizedPanel(),
    glass: MATERIALS.architecturalGlass(),
    trim: MATERIALS.brushedAluminum(),
    door: MATERIALS.darkCladding(),
    teal: MATERIALS.tealLED(2.2),
    led: MATERIALS.whiteLED(1.4),
  }), []);

  const pv = useMemo(() => {
    const cols = Math.floor((w - 5) / 4.4), rows = Math.floor((d - 5) / 4.4);
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.0, 0.14, 4.0), MATERIALS.solarPanelGlass(), cols * rows,
    );
    const dm = new THREE.Object3D();
    let i = 0;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      dm.position.set(-w / 2 + 2.5 + (a + 0.5) * 4.4, H + 0.32, -d / 2 + 2.5 + (b + 0.5) * 4.4);
      dm.updateMatrix(); inst.setMatrixAt(i++, dm.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, [w, d]);

  // bay door x-centers in local space (site plan: WASH stalls at x 168, 186, 204)
  const doors = Array.from({ length: count }, (_, i) => 168 + i * 18 - 150 - cx);

  return (
    <group position={[cx, 0, cz]}>
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow material={mats.shell}>
        <boxGeometry args={[w, H, d]} />
      </mesh>
      <mesh position={[0, H + 0.08, 0]} material={mats.trim}>
        <boxGeometry args={[w + 0.4, 0.22, d + 0.4]} />
      </mesh>
      <primitive object={pv} />

      {/* WASH sign */}
      <mesh position={[0, H - 1.0, -d / 2 - 0.1]} material={mats.teal}>
        <boxGeometry args={[12, 1.2, 0.08]} />
      </mesh>

      {doors.map((dx, i) => (
        <group key={i}>
          {/* south glass entry (open look: glass + raised panel header) */}
          <mesh position={[dx, 3.8, -d / 2 - 0.04]} material={mats.glass}>
            <boxGeometry args={[11, 7.6, 0.1]} />
          </mesh>
          <mesh position={[dx, H - 1.6, -d / 2 - 0.06]} material={mats.door}>
            <boxGeometry args={[11.6, 2.4, 0.25]} />
          </mesh>
          {/* rear exit */}
          <mesh position={[dx, 4.0, d / 2 + 0.06]} material={mats.door}>
            <boxGeometry args={[11, 8, 0.22]} />
          </mesh>
          {/* status lamp */}
          <mesh position={[dx + 6.4, 7.6, -d / 2 - 0.1]} material={mats.led}>
            <boxGeometry args={[0.5, 0.9, 0.08]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
