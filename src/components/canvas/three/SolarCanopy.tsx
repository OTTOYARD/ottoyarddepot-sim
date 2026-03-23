import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function SolarCanopy({ solarKWdc }: { solarKWdc: number }) {
  const led = useRef<THREE.Mesh>(null);
  if (solarKWdc === 0) return null;

  const s = solarKWdc / 500;
  const w = 180 * Math.min(s, 1.6);
  const d = 90 * Math.min(s, 1.4);
  const h = 16;
  const cols = Math.max(4, Math.floor(6 * s));

  useFrame(({ clock }) => {
    if (led.current)
      (led.current.material as THREE.MeshStandardMaterial)
        .emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 2) * 0.3;
  });

  return (
    <group position={[0, 0, 20]}>
      {/* Main canopy structure */}
      <mesh position={[0, h, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.35, d]} />
        <meshPhysicalMaterial color="#1a2a3a" roughness={0.25} metalness={0.7} />
      </mesh>

      {/* Solar panel rows — dark reflective */}
      {Array.from({ length: Math.floor(w / 16) }, (_, i) => (
        <group key={`panel${i}`}>
          <mesh position={[-w / 2 + 8 + i * 16, h + 0.22, 0]}>
            <boxGeometry args={[14.5, 0.06, d - 4]} />
            <meshPhysicalMaterial
              color="#0a1520"
              roughness={0.12}
              metalness={0.65}
              clearcoat={0.4}
              clearcoatRoughness={0.15}
            />
          </mesh>
          {/* Aluminum edge frame */}
          <mesh position={[-w / 2 + 8 + i * 16, h + 0.22, (d - 4) / 2]}>
            <boxGeometry args={[14.8, 0.1, 0.15]} />
            <meshPhysicalMaterial color="#aaaaaa" roughness={0.2} metalness={0.9} />
          </mesh>
          <mesh position={[-w / 2 + 8 + i * 16, h + 0.22, -(d - 4) / 2]}>
            <boxGeometry args={[14.8, 0.1, 0.15]} />
            <meshPhysicalMaterial color="#aaaaaa" roughness={0.2} metalness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Brushed steel columns */}
      {Array.from({ length: cols }, (_, i) => {
        const x = -w / 2 + 10 + i * ((w - 20) / (cols - 1));
        return [d / 2 - 5, -d / 2 + 5].map((z, j) => (
          <mesh key={`c${i}${j}`} position={[x, h / 2, z]} castShadow>
            <cylinderGeometry args={[0.3, 0.4, h, 12]} />
            <meshPhysicalMaterial color="#606060" roughness={0.35} metalness={0.7} />
          </mesh>
        ));
      })}

      {/* Under-canopy warm downlights */}
      {Array.from({ length: Math.floor(w / 30) }, (_, i) => (
        <pointLight
          key={`dl${i}`}
          position={[-w / 2 + 15 + i * 30, h - 1.5, 0]}
          color="#ffeedd"
          intensity={0.3}
          distance={15}
          decay={2}
        />
      ))}

      {/* LED accent strips */}
      {[-d / 2 + 3, d / 2 - 3].map((z, i) => (
        <mesh key={i} ref={i === 0 ? led : undefined} position={[0, h - 0.3, z]}>
          <boxGeometry args={[w - 8, 0.1, 0.1]} />
          <meshStandardMaterial color="#00B4A6" emissive="#00B4A6" emissiveIntensity={0.8} />
        </mesh>
      ))}

      <pointLight position={[0, h - 2, 0]} color="#00B4A6" intensity={0.1} distance={w * 0.6} />
    </group>
  );
}
