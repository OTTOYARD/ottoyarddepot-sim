import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store/simulationStore';

export function WeatherEffects() {
  const weather = useSimulationStore((s) => s.config.weather);
  const pointsRef = useRef<THREE.Points>(null);

  const rainPositions = useMemo(() => {
    const count = 2000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 1] = Math.random() * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 220;
    }
    return positions;
  }, []);

  useFrame(() => {
    if (weather !== 'Rain' || !pointsRef.current) return;
    const positions = pointsRef.current.geometry.attributes.position;
    const arr = positions.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3 + 1] -= 0.8;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 60;
      }
    }
    positions.needsUpdate = true;
  });

  if (weather === 'Clear') return null;

  if (weather === 'Rain') {
    return (
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={rainPositions.length / 3}
            array={rainPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial color="#88CCFF" size={0.3} transparent opacity={0.4} sizeAttenuation />
      </points>
    );
  }

  // Overcast - just return fog hint (actual fog set in scene)
  return null;
}
