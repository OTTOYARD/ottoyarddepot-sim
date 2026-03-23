import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { toWorld } from './coordUtils';
import type { Vehicle } from '@/engine/types';

const COLORS: Record<string, string> = {
  fleet: '#00B4A6', core: '#E0E0E0', concierge: '#A0A0A0', elite: '#FFD700'
};
const FX: Record<string, { glow: string; pulse: number; op: number }> = {
  approaching: { glow: '', pulse: 0, op: 0.7 },
  queued: { glow: '', pulse: 0, op: 0.5 },
  charging: { glow: '#00B4A6', pulse: 3, op: 1 },
  washing: { glow: '#2196F3', pulse: 2, op: 1 },
  detailing: { glow: '#2196F3', pulse: 1.5, op: 1 },
  maintenance: { glow: '#FF9800', pulse: 1, op: 1 },
  staging: { glow: '', pulse: 0, op: 0.6 },
  departing: { glow: '', pulse: 0, op: 0.7 },
};

export function Vehicle3D({ vehicle, simSpeed }: { vehicle: Vehicle; simSpeed: number }) {
  const grp = useRef<THREE.Group>(null);
  const glw = useRef<THREE.Mesh>(null);
  const col = COLORS[vehicle.type] || '#fff';
  const fx = FX[vehicle.status] || FX.staging;
  const [tx, , tz] = toWorld(vehicle.position);

  useFrame((_, delta) => {
    if (!grp.current) return;
    const p = grp.current.position;
    const rate = Math.min(delta * 2 * Math.max(simSpeed, 1), 1);
    p.x = THREE.MathUtils.lerp(p.x, tx, rate);
    p.z = THREE.MathUtils.lerp(p.z, tz, rate);
    if (glw.current && fx.pulse > 0) {
      (glw.current.material as THREE.MeshStandardMaterial)
        .emissiveIntensity = 0.4 + Math.sin(Date.now() * 0.001 * fx.pulse) * 0.6;
    }
  });

  return (
    <group ref={grp} position={[tx, 0, tz]}>
      {/* Body */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[2.6, 1, 5]} />
        <meshStandardMaterial color={col} roughness={0.4} metalness={0.3} opacity={fx.op} transparent />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.4, -0.3]}>
        <boxGeometry args={[2.2, 0.7, 2.8]} />
        <meshStandardMaterial color="#222222" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Wheels */}
      {([[-1.3, .3, 2], [1.3, .3, 2], [-1.3, .3, -2], [1.3, .3, -2]] as [number, number, number][]).map((pos, i) => (
        <mesh key={i} position={pos} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.35, 0.35, 0.3, 8]} />
          <meshStandardMaterial color="#111" roughness={0.8} />
        </mesh>
      ))}
      {/* Headlights */}
      {([[-1, .6, 3.05], [1, .6, 3.05]] as [number, number, number][]).map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.15, 6, 6]} />
          <meshStandardMaterial color="#FFFFCC" emissive="#FFFFCC" emissiveIntensity={0.5} />
        </mesh>
      ))}
      {/* Status glow */}
      {fx.glow && (
        <mesh ref={glw} position={[0, 2.2, 0]}>
          <sphereGeometry args={[1.8, 12, 12]} />
          <meshStandardMaterial color={fx.glow} emissive={fx.glow} emissiveIntensity={0.5} transparent opacity={0.15} />
        </mesh>
      )}
      {/* SoC badge */}
      <Html position={[0, 3.2, 0]} center>
        <div className="px-1.5 py-0.5 rounded text-[7px] font-mono bg-black/80 text-white whitespace-nowrap border border-white/10 flex items-center gap-1">
          <div className="w-6 h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${vehicle.currentSoC}%`,
                backgroundColor: vehicle.currentSoC > 60 ? '#22c55e' : vehicle.currentSoC > 30 ? '#eab308' : '#ef4444',
              }}
            />
          </div>
          {Math.round(vehicle.currentSoC)}%
        </div>
      </Html>
    </group>
  );
}
