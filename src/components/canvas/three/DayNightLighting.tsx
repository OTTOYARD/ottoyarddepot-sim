import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function DayNightLighting({ simTime }: { simTime: number }) {
  const dirRef = useRef<THREE.DirectionalLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const hour = simTime / 3600;

  let sunI = 0, ambI = 0.08, sunCol = '#334466', sunY = 10;
  let skyCol = '#0a0a1a', gndCol = '#111111', hemiI = 0.05;

  if (hour >= 6 && hour < 8) {
    const t = (hour - 6) / 2;
    sunI = t * 1.4; ambI = 0.1 + t * 0.4; sunCol = '#ffaa66'; sunY = 20 + t * 60;
    skyCol = '#ff8855'; gndCol = '#221111'; hemiI = 0.1 + t * 0.4;
  } else if (hour >= 8 && hour < 17) {
    sunI = 1.8; ambI = 0.5; sunCol = '#fff5e6'; sunY = 80;
    skyCol = '#87CEEB'; gndCol = '#2a2a2a'; hemiI = 0.5;
  } else if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    sunI = 1.8 * (1 - t); ambI = 0.5 - t * 0.42; sunCol = '#ff8844'; sunY = 80 - t * 60;
    skyCol = '#ff6633'; gndCol = '#1a0a0a'; hemiI = 0.5 - t * 0.45;
  }

  useFrame(() => {
    if (dirRef.current) {
      dirRef.current.intensity = sunI;
      dirRef.current.color.set(sunCol);
      dirRef.current.position.y = sunY;
    }
    if (ambRef.current) ambRef.current.intensity = ambI;
    if (hemiRef.current) {
      hemiRef.current.intensity = hemiI;
      hemiRef.current.color.set(skyCol);
      hemiRef.current.groundColor.set(gndCol);
    }
  });

  return (
    <>
      <ambientLight ref={ambRef} intensity={ambI} color="#4a5568" />
      <hemisphereLight ref={hemiRef} color={skyCol} groundColor={gndCol} intensity={hemiI} />
      <directionalLight
        ref={dirRef}
        position={[50, sunY, 30]}
        intensity={sunI}
        color={sunCol}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-far={250}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
        shadow-bias={-0.0005}
      />
      {/* Teal accent fill */}
      <pointLight position={[0, 15, 0]} intensity={0.15} color="#00B4A6" distance={60} />
      {/* Warm fill from building */}
      <pointLight position={[-80, 8, 96]} color="#ffcc88" intensity={0.4} distance={30} />
      {/* OTTOYARD signage glow */}
      <pointLight position={[0, 16, 83]} color="#C00000" intensity={0.6} distance={20} />

      {/* Night pole lights — activated when dark */}
      {[[-80, 0, -40], [80, 0, -40], [-80, 0, 40], [80, 0, 40]].map((pos, i) => (
        <group key={`pole${i}`} position={pos as [number, number, number]}>
          <mesh position={[0, 6, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.25, 12, 6]} />
            <meshPhysicalMaterial color="#4a4a4a" roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0, 12.2, 0]}>
            <boxGeometry args={[2, 0.3, 1]} />
            <meshPhysicalMaterial color="#555" roughness={0.3} metalness={0.5} />
          </mesh>
          <pointLight
            position={[0, 12, 0]}
            color="#ffeedd"
            intensity={hour < 6 || hour >= 20 ? 1.5 : 0}
            distance={40}
            decay={2}
          />
        </group>
      ))}
    </>
  );
}
