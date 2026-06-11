import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { BESS_YARD, LIGHT_POLES } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

interface UtilityEquipmentProps {
  bessCapacity: number;
  bessPower: number;
}

/**
 * Secured BESS yard (NW corner, own fence + hazard placard) and the
 * overhead commercial light poles for 24/7 operations. From the site plan.
 */
export function UtilityEquipment({ bessCapacity, bessPower }: UtilityEquipmentProps) {
  const mats = useMemo(() => ({
    bess: MATERIALS.darkCladding(),
    panel: MATERIALS.anodizedPanel(),
    steel: MATERIALS.structuralSteel(),
    teal: MATERIALS.tealLED(1.6),
    amber: MATERIALS.amberIndicator(),
    pole: MATERIALS.structuralSteel(),
    head: MATERIALS.whiteLED(1.8),
  }), []);

  const [bx, , bz] = toWorld({ x: BESS_YARD.x + BESS_YARD.w / 2, y: BESS_YARD.y + BESS_YARD.h / 2 }, 0);
  const containers = Math.max(2, Math.min(4, Math.round(bessCapacity)));

  // BESS yard fence
  const fence = useMemo(() => {
    const w = BESS_YARD.w, d = BESS_YARD.h;
    const pts: { x: number; z: number; len: number; rot: number }[] = [
      { x: 0, z: -d / 2, len: w, rot: 0 },
      { x: 0, z: d / 2, len: w, rot: 0 },
      { x: -w / 2, z: 0, len: d, rot: Math.PI / 2 },
      { x: w / 2, z: 0, len: d, rot: Math.PI / 2 },
    ];
    return pts;
  }, []);

  return (
    <group>
      {/* ---- BESS yard ---- */}
      <group position={[bx, 0, bz]}>
        {/* concrete pad */}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.06, 0]} receiveShadow>
          <planeGeometry args={[BESS_YARD.w - 2, BESS_YARD.h - 2]} />
          <primitive object={MATERIALS.polishedConcrete()} attach="material" />
        </mesh>
        {/* battery containers */}
        {Array.from({ length: containers }, (_, i) => (
          <group key={i} position={[-BESS_YARD.w / 2 + 9 + i * 11, 0, 0]}>
            <mesh position={[0, 3.2, 0]} castShadow material={mats.bess}>
              <boxGeometry args={[9, 6.4, 16]} />
            </mesh>
            <mesh position={[0, 6.5, 0]} material={mats.steel}>
              <boxGeometry args={[9.2, 0.2, 16.2]} />
            </mesh>
            <mesh position={[4.55, 3.6, 0]} material={mats.teal}>
              <boxGeometry args={[0.06, 0.5, 12]} />
            </mesh>
          </group>
        ))}
        {/* inverter cabinets */}
        {[0, 1].map((i) => (
          <mesh key={i} position={[BESS_YARD.w / 2 - 5, 2, -6 + i * 12]} castShadow material={mats.panel}>
            <boxGeometry args={[5, 4, 4]} />
          </mesh>
        ))}
        {/* securing fence + hazard placard */}
        {fence.map((f, i) => (
          <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
            <mesh position={[0, 2.6, 0]} material={mats.steel}>
              <boxGeometry args={[f.len, 0.12, 0.1]} />
            </mesh>
            <mesh position={[0, 1.5, 0]}>
              <boxGeometry args={[f.len, 2.6, 0.03]} />
              <meshPhysicalMaterial color="#15181d" roughness={0.8} metalness={0.6} transparent opacity={0.3} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 3.4, BESS_YARD.h / 2 + 0.08]} material={mats.amber}>
          <boxGeometry args={[7, 1.6, 0.08]} />
        </mesh>
      </group>

      {/* ---- site light poles (24/7 ops) ---- */}
      {LIGHT_POLES.map((p, i) => {
        const [wx, , wz] = toWorld({ x: p.x, y: p.y }, 0);
        return (
          <group key={i} position={[wx, 0, wz]}>
            <mesh position={[0, 9, 0]} castShadow material={mats.pole}>
              <cylinderGeometry args={[0.28, 0.4, 18, 8]} />
            </mesh>
            <mesh position={[2.6, 17.7, 0]} material={mats.pole}>
              <boxGeometry args={[5.2, 0.3, 0.3]} />
            </mesh>
            <mesh position={[5, 17.5, 0]} material={mats.head}>
              <boxGeometry args={[2.6, 0.5, 1.3]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
