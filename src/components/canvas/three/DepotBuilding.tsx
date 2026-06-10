import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { BUILDING } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * Office + operations building with 2 attached PULL-THROUGH service bays
 * (south entry doors, north rear exits into the rear lane). Rooftop PV.
 * Geometry from the shared site plan.
 */
export function DepotBuilding() {
  const H = 13;
  const [cx, , cz] = toWorld({ x: BUILDING.x + BUILDING.w / 2, y: BUILDING.y + BUILDING.h / 2 }, 0);
  const w = BUILDING.w, d = BUILDING.h;

  const mats = useMemo(() => ({
    cladding: MATERIALS.darkCladding(),
    panel: MATERIALS.anodizedPanel(),
    glass: MATERIALS.architecturalGlass(),
    steel: MATERIALS.structuralSteel(),
    trim: MATERIALS.brushedAluminum(),
    door: MATERIALS.darkCladding(),
    sign: MATERIALS.tealLED(3.0),
    led: MATERIALS.whiteLED(1.6),
  }), []);

  // rooftop PV (instanced)
  const pv = useMemo(() => {
    const cols = Math.floor((w - 6) / 4.4), rows = Math.floor((d - 6) / 4.4);
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.0, 0.14, 4.0), MATERIALS.solarPanelGlass(), cols * rows,
    );
    const dm = new THREE.Object3D();
    let i = 0;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      dm.position.set(-w / 2 + 3 + (a + 0.5) * 4.4, H + 0.35, -d / 2 + 3 + (b + 0.5) * 4.4);
      dm.updateMatrix(); inst.setMatrixAt(i++, dm.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, [w, d]);

  // service bay door x-centers in WORLD space (site plan: SVC stalls at x 120, 138)
  const doors = [120, 138].map((x) => x - 150 - cx); // local offset within the group

  return (
    <group position={[cx, 0, cz]}>
      {/* main mass */}
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow material={mats.cladding}>
        <boxGeometry args={[w, H, d]} />
      </mesh>
      {/* parapet trim */}
      <mesh position={[0, H + 0.1, 0]} material={mats.trim}>
        <boxGeometry args={[w + 0.4, 0.25, d + 0.4]} />
      </mesh>
      <primitive object={pv} />

      {/* office glass front (south face, west portion) */}
      <mesh position={[-w / 2 + 19, 4.6, -d / 2 - 0.06]} material={mats.glass}>
        <boxGeometry args={[34, 8.2, 0.12]} />
      </mesh>
      <mesh position={[-w / 2 + 19, 9.6, -d / 2 - 0.1]} material={mats.trim}>
        <boxGeometry args={[35, 0.3, 0.1]} />
      </mesh>

      {/* OTTOYARD sign */}
      <mesh position={[-w / 2 + 19, H - 1.2, -d / 2 - 0.12]} material={mats.sign}>
        <boxGeometry args={[18, 1.6, 0.08]} />
      </mesh>

      {/* 2 service bays — south entry + north rear exit (pull-through) */}
      {doors.map((dx, i) => (
        <group key={i}>
          {/* south door (open: panel raised into header) */}
          <mesh position={[dx, H - 2.2, -d / 2 - 0.05]} material={mats.door}>
            <boxGeometry args={[12, 3.4, 0.3]} />
          </mesh>
          <mesh position={[dx, H - 0.4, -d / 2 - 0.15]} material={mats.trim}>
            <boxGeometry args={[13, 0.5, 0.2]} />
          </mesh>
          {/* opening reveal (dark interior visible) */}
          <mesh position={[dx, 4.2, -d / 2 - 0.02]}>
            <boxGeometry args={[12, 8.4, 0.06]} />
            <meshPhysicalMaterial color="#07090c" roughness={0.95} metalness={0} />
          </mesh>
          {/* rear exit door (closed panel) */}
          <mesh position={[dx, 4.6, d / 2 + 0.08]} material={mats.door}>
            <boxGeometry args={[12, 9.2, 0.25]} />
          </mesh>
          {/* bay number light */}
          <mesh position={[dx - 7.2, 9.4, -d / 2 - 0.12]} material={mats.led}>
            <boxGeometry args={[0.9, 1.6, 0.08]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
