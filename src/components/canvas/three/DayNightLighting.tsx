import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function DayNightLighting({ simTime }: { simTime: number }) {
  const dirRef = useRef<THREE.DirectionalLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  const hour = simTime / 3600;

  let sunI = 0, ambI = 0.08, sunCol = '#334466', sunY = 10;
  if (hour >= 6 && hour < 8) {
    const t = (hour - 6) / 2;
    sunI = t * 0.6; ambI = 0.1 + t * 0.15; sunCol = '#ffaa66'; sunY = 20 + t * 60;
  } else if (hour >= 8 && hour < 17) {
    sunI = 0.8; ambI = 0.3; sunCol = '#ffeedd'; sunY = 80;
  } else if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    sunI = 0.8 * (1 - t); ambI = 0.3 - t * 0.2; sunCol = '#ff8844'; sunY = 80 - t * 60;
  }

  useFrame(() => {
    if (dirRef.current) {
      dirRef.current.intensity = sunI;
      dirRef.current.color.set(sunCol);
      dirRef.current.position.y = sunY;
    }
    if (ambRef.current) ambRef.current.intensity = ambI;
  });

  return (
    <>
      <ambientLight ref={ambRef} intensity={ambI} color="#4a5568" />
      <directionalLight
        ref={dirRef}
        position={[50, sunY, 30]}
        intensity={sunI}
        color={sunCol}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={200}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
      />
      <pointLight position={[0, 15, 0]} intensity={0.2} color="#00B4A6" distance={60} />
      <pointLight position={[-80, 8, 96]} color="#ffcc88" intensity={0.5} distance={30} />
      <pointLight position={[0, 16, 83]} color="#C00000" intensity={0.8} distance={20} />
    </>
  );
}
