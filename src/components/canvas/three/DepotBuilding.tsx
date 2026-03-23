import { toWorld } from './coordUtils';
import { Html } from '@react-three/drei';

export function DepotBuilding() {
  // Operations building: 2D (60,5) to (180,40) → width=120, depth=35
  const [bx, , bz] = toWorld({ x: 120, y: 22.5 }, 0);
  const buildingHeight = 8;

  return (
    <group>
      {/* Main building */}
      <mesh position={[bx, buildingHeight / 2, bz]} castShadow receiveShadow>
        <boxGeometry args={[120, buildingHeight, 35]} />
        <meshStandardMaterial color="#3A3A3A" roughness={0.7} />
      </mesh>

      {/* Service bays section (left third: 2D x=60-100) */}
      {(() => {
        const [sx, , sz] = toWorld({ x: 80, y: 22.5 }, 0);
        return (
          <group>
            <mesh position={[sx, buildingHeight + 0.1, sz]}>
              <boxGeometry args={[40, 0.2, 35]} />
              <meshStandardMaterial color="#4A4A4A" roughness={0.6} />
            </mesh>
            <Html position={[sx, buildingHeight + 2, sz]} center>
              <span className="text-[8px] text-white/50 font-mono">SERVICE</span>
            </Html>
          </group>
        );
      })()}

      {/* Control Room (right section: 2D x=100-180) */}
      {(() => {
        const [cx, , cz] = toWorld({ x: 140, y: 22.5 }, 0);
        return (
          <Html position={[cx, buildingHeight + 2, cz]} center>
            <span className="text-[8px] text-white/50 font-mono">CONTROL ROOM</span>
          </Html>
        );
      })()}

      {/* Lounge (small section at 2D 60,5 w15 h12) */}
      {(() => {
        const [lx, , lz] = toWorld({ x: 67.5, y: 11 }, 0);
        return (
          <group>
            <mesh position={[lx, buildingHeight / 2, lz]}>
              <boxGeometry args={[15, buildingHeight + 1, 12]} />
              <meshStandardMaterial color="#3A3A3A" roughness={0.6} />
            </mesh>
            {/* Glass windows */}
            <mesh position={[lx, buildingHeight / 2 + 1, lz + 6.1]}>
              <planeGeometry args={[13, 5]} />
              <meshStandardMaterial color="#87CEEB" opacity={0.3} transparent />
            </mesh>
          </group>
        );
      })()}

      {/* Roof accent line */}
      <mesh position={[bx, buildingHeight + 0.5, bz]}>
        <boxGeometry args={[122, 0.3, 0.3]} />
        <meshStandardMaterial color="#ffffff" opacity={0.2} transparent />
      </mesh>
    </group>
  );
}
