import { useMemo } from 'react';
import { MATERIALS } from './materials';
import { toWorld } from './coordUtils';

/**
 * Interior equipment for the 2 service bays (lift posts + tool walls),
 * visible through the open south doors. Positions = SVC stalls (site plan).
 */
export function ServiceBays() {
  const mats = useMemo(() => ({
    steel: MATERIALS.structuralSteel(),
    blue: MATERIALS.anodizedPanel(),
    amber: MATERIALS.amberIndicator(),
  }), []);

  // SVC stalls: x 120/138, y 31 (inside the building)
  const bays = [120, 138].map((x) => toWorld({ x, y: 31 }, 0));

  return (
    <group>
      {bays.map(([wx, , wz], i) => (
        <group key={i} position={[wx, 0, wz]}>
          {/* two-post lift */}
          {[-4.2, 4.2].map((px, j) => (
            <mesh key={j} position={[px, 3.2, 0]} castShadow material={mats.blue}>
              <boxGeometry args={[0.7, 6.4, 0.7]} />
            </mesh>
          ))}
          <mesh position={[0, 6.2, 0]} material={mats.steel}>
            <boxGeometry args={[9.2, 0.4, 0.5]} />
          </mesh>
          {/* lift arms */}
          {[-2.2, 2.2].map((pz, j) => (
            <mesh key={j} position={[0, 1.0, pz]} material={mats.steel}>
              <boxGeometry args={[7.4, 0.18, 0.5]} />
            </mesh>
          ))}
          {/* tool cabinet */}
          <mesh position={[0, 1.2, 5.4]} castShadow material={mats.steel}>
            <boxGeometry args={[6, 2.4, 1.2]} />
          </mesh>
          <mesh position={[0, 2.6, 5.4]} material={mats.amber}>
            <boxGeometry args={[1.4, 0.18, 0.6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
