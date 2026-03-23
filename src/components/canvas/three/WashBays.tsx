import { useDepotStore } from '@/store/depotStore';
import { toWorld } from './coordUtils';
import { Html } from '@react-three/drei';

export function WashBays() {
  const stalls = useDepotStore((s) => s.stalls);
  const washStalls = stalls.filter((s) => s.type === 'wash');

  return (
    <group>
      {washStalls.map((stall) => {
        const [x, , z] = toWorld(stall.position);
        const isActive = stall.status === 'servicing' || stall.status === 'occupied';

        return (
          <group key={stall.id} position={[x, 0, z]}>
            {/* Wash bay structure */}
            <mesh position={[0, 2, 0]} castShadow>
              <boxGeometry args={[12, 4, 8]} />
              <meshStandardMaterial color="#2a2a3a" roughness={0.6} metalness={0.2} />
            </mesh>
            {/* Blue accent strip */}
            <mesh position={[0, 4.05, 0]}>
              <boxGeometry args={[12.2, 0.2, 8.2]} />
              <meshStandardMaterial
                color="#2196F3"
                emissive="#2196F3"
                emissiveIntensity={isActive ? 0.6 : 0.15}
              />
            </mesh>
            {/* Opening */}
            <mesh position={[0, 1.5, 4.1]}>
              <planeGeometry args={[8, 3]} />
              <meshStandardMaterial color="#111122" />
            </mesh>
          </group>
        );
      })}

      {/* Label */}
      {washStalls.length > 0 && (() => {
        const [lx, , lz] = toWorld({ x: 215, y: 28 }, 0);
        return (
          <Html position={[lx, 6, lz]} center>
            <span className="text-[9px] font-bold text-[#2196F3]/60 tracking-wider">WASH</span>
          </Html>
        );
      })()}
    </group>
  );
}
