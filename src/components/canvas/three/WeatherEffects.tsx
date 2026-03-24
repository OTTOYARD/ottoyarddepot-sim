import { forwardRef, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export const WeatherEffects = forwardRef<THREE.Group, { weather: string }>(function WeatherEffects({ weather }, groupRef) {
  const ref = useRef<THREE.Points>(null);
  const count = weather === 'Rain' ? 3000 : weather === 'Snow' ? 1500 : 0;

  const positions = useMemo(() => {
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = (Math.random() - 0.5) * 300;
      a[i * 3 + 1] = Math.random() * 60;
      a[i * 3 + 2] = (Math.random() - 0.5) * 220;
    }
    return a;
  }, [count]);

  useFrame(() => {
    if (!ref.current || count === 0) return;
    const arr = ref.current.geometry.attributes.position.array as Float32Array;
    const spd = weather === 'Rain' ? 1.2 : 0.3;
    const drift = weather === 'Snow' ? 0.15 : 0;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= spd;
      arr[i * 3] += (Math.random() - 0.5) * drift;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 50 + Math.random() * 10;
        arr[i * 3] = (Math.random() - 0.5) * 300;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 220;
      }
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  if (weather === 'Clear') return null;

  return (
    <group ref={groupRef}>
      {count > 0 && (
        <points ref={ref}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={count}
              array={positions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial
            size={weather === 'Rain' ? 0.3 : 0.6}
            color={weather === 'Rain' ? '#aaccee' : '#ffffff'}
            transparent
            opacity={weather === 'Rain' ? 0.5 : 0.7}
            sizeAttenuation
          />
        </points>
      )}
      {weather === 'Extreme Heat' && (
        <fog attach="fog" args={['#2a1500', 80, 250]} />
      )}
      {weather === 'Rain' && (
        <fog attach="fog" args={['#0a0a1a', 100, 200]} />
      )}
    </group>
  );
});
