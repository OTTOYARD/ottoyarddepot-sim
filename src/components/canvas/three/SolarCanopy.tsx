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
      <mesh position={[0, h, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.35, d]} />
        <meshStandardMaterial color='#1a2a3a' roughness={0.3} metalness={0.7} />
      </mesh>
      {Array.from({ length: Math.floor(w / 16) }, (_, i) => (
        <mesh key={i} position={[-w / 2 + 8 + i * 16, h + 0.2, 0]}>
          <boxGeometry args={[14.5, 0.04, d - 4]} />
          <meshStandardMaterial color='#0a1520' roughness={0.2} metalness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: cols }, (_, i) => {
        const x = -w / 2 + 10 + i * ((w - 20) / (cols - 1));
        return [d / 2 - 5, -d / 2 + 5].map((z, j) => (
          <mesh key={`c${i}${j}`} position={[x, h / 2, z]} castShadow>
            <cylinderGeometry args={[0.35, 0.45, h, 8]} />
            <meshStandardMaterial color='#4a5568' roughness={0.6} metalness={0.5} />
          </mesh>
        ));
      })}
      {[-d / 2 + 3, d / 2 - 3].map((z, i) => (
        <mesh key={i} ref={i === 0 ? led : undefined} position={[0, h - 0.3, z]}>
          <boxGeometry args={[w - 8, 0.12, 0.12]} />
          <meshStandardMaterial color='#00B4A6' emissive='#00B4A6'
            emissiveIntensity={0.8} />
        </mesh>
      ))}
      <pointLight position={[0, h - 2, 0]} color='#00B4A6'
        intensity={0.15} distance={w * 0.6} />
    </group>
  );
}
