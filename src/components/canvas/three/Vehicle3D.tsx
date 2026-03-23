import type { Vehicle } from '@/engine/types';
import { toWorld } from './coordUtils';
import { Html } from '@react-three/drei';

const TYPE_COLORS: Record<string, string> = {
  fleet: '#C00000',
  core: '#00B4A6',
  concierge: '#F59E0B',
  elite: '#9C27B0',
};

export function Vehicle3D({ vehicle }: { vehicle: Vehicle }) {
  const [x, , z] = toWorld(vehicle.position, 0);
  const color = TYPE_COLORS[vehicle.type] || '#666666';
  const soc = vehicle.currentSoC;

  return (
    <group position={[x, 0, z]}>
      {/* Car body */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[3, 1.2, 5]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.7, -0.3]}>
        <boxGeometry args={[2.4, 0.8, 3]} />
        <meshStandardMaterial color="#222222" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Headlights */}
      <mesh position={[0.8, 0.7, 2.5]}>
        <sphereGeometry args={[0.2, 6, 6]} />
        <meshStandardMaterial color="#FFFFCC" emissive="#FFFFCC" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[-0.8, 0.7, 2.5]}>
        <sphereGeometry args={[0.2, 6, 6]} />
        <meshStandardMaterial color="#FFFFCC" emissive="#FFFFCC" emissiveIntensity={0.5} />
      </mesh>

      {/* SoC badge */}
      <Html position={[0, 3.2, 0]} center>
        <div className="px-1 py-0.5 rounded text-[7px] font-mono bg-black/70 text-white whitespace-nowrap border border-white/10">
          {Math.round(soc)}%
        </div>
      </Html>
    </group>
  );
}
