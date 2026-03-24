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
  approaching: { glow: '', pulse: 0, op: 0.85 },
  queued: { glow: '', pulse: 0, op: 0.6 },
  charging: { glow: '#00B4A6', pulse: 3, op: 1 },
  washing: { glow: '#2196F3', pulse: 2, op: 1 },
  detailing: { glow: '#2196F3', pulse: 1.5, op: 1 },
  maintenance: { glow: '#FF9800', pulse: 1, op: 1 },
  staging: { glow: '', pulse: 0, op: 0.7 },
  departing: { glow: '', pulse: 0, op: 0.85 },
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
      {/* Body — clearcoat automotive paint */}
      <mesh position={[0, 0.65, 0]} castShadow>
        <boxGeometry args={[2.6, 1, 5]} />
        <meshPhysicalMaterial
          color={col}
          roughness={0.48}
          metalness={0.12}
          clearcoat={0.45}
          clearcoatRoughness={0.2}
          opacity={fx.op}
          transparent={fx.op < 1}
        />
      </mesh>

      {/* Cabin — tinted glass */}
      <mesh position={[0, 1.4, -0.3]}>
        <boxGeometry args={[2.2, 0.7, 2.8]} />
        <meshPhysicalMaterial
          color="hsl(218, 26%, 20%)"
          roughness={0.18}
          metalness={0.05}
          transmission={0.35}
          ior={1.5}
          thickness={0.3}
          transparent
          opacity={0.35}
        />
      </mesh>

      {/* Wheels — torus tires */}
      {([[-1.3, .35, 2], [1.3, .35, 2], [-1.3, .35, -2], [1.3, .35, -2]] as [number, number, number][]).map((pos, i) => (
        <group key={i} position={pos}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.3, 0.12, 8, 16]} />
            <meshPhysicalMaterial color="hsl(220, 8%, 15%)" roughness={0.9} metalness={0.04} />
          </mesh>
          {/* Rim */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.2, 0.2, 0.22, 8]} />
            <meshPhysicalMaterial color="hsl(210, 6%, 62%)" roughness={0.45} metalness={0.25} />
          </mesh>
        </group>
      ))}

      {/* Headlights */}
      {([[-0.9, .65, 2.55], [0.9, .65, 2.55]] as [number, number, number][]).map((pos, i) => (
        <mesh key={`hl${i}`} position={pos}>
          <sphereGeometry args={[0.18, 8, 8]} />
          <meshStandardMaterial color="#FFFFEE" emissive="#FFFFCC" emissiveIntensity={0.8} />
        </mesh>
      ))}

      {/* Tail lights */}
      {([[-0.9, .65, -2.55], [0.9, .65, -2.55]] as [number, number, number][]).map((pos, i) => (
        <mesh key={`tl${i}`} position={pos}>
          <boxGeometry args={[0.4, 0.15, 0.05]} />
          <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={0.6} />
        </mesh>
      ))}

      {/* Status glow */}
      {fx.glow && (
        <mesh ref={glw} position={[0, 2.2, 0]}>
          <sphereGeometry args={[1.8, 12, 12]} />
          <meshStandardMaterial color={fx.glow} emissive={fx.glow} emissiveIntensity={0.5} transparent opacity={0.12} />
        </mesh>
      )}

      {/* SoC badge */}
      <Html position={[0, 3.2, 0]} center>
        <div className="px-1.5 py-0.5 rounded text-[7px] font-mono bg-black/80 text-white whitespace-nowrap border border-white/10 flex items-center gap-1"
          style={{ backdropFilter: 'blur(4px)' }}>
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
