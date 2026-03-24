import * as THREE from 'three';
import { useMemo } from 'react';

function calcLighting(simTime: number) {
  const hour = simTime / 3600;
  let sunI = 0, ambI = 0.2, sunCol = '#334466', sunY = 10;
  let skyCol = '#0a0a1a', gndCol = '#222222', hemiI = 0.15;
  let fillI = 0.1;

  if (hour >= 6 && hour < 8) {
    const t = (hour - 6) / 2;
    sunI = t * 3.0; ambI = 0.3 + t * 0.7; sunCol = '#ffcc88'; sunY = 20 + t * 60;
    skyCol = '#ffaa77'; gndCol = '#443322'; hemiI = 0.3 + t * 0.9; fillI = 0.2 + t * 0.6;
  } else if (hour >= 8 && hour < 17) {
    sunI = 4.0; ambI = 1.0; sunCol = '#fffaf0'; sunY = 80;
    skyCol = '#87CEEB'; gndCol = '#555555'; hemiI = 1.2; fillI = 0.8;
  } else if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    sunI = 4.0 * (1 - t); ambI = 1.0 - t * 0.8; sunCol = '#ffaa66'; sunY = 80 - t * 60;
    skyCol = '#ff7744'; gndCol = '#332211'; hemiI = 1.2 - t * 1.05; fillI = 0.8 * (1 - t);
  }

  return { sunI, ambI, sunCol, sunY, skyCol, gndCol, hemiI, fillI, hour };
}

export function DayNightLighting({ simTime }: { simTime: number }) {
  const l = useMemo(() => calcLighting(simTime), [simTime]);

  return (
    <>
      <ambientLight intensity={l.ambI} color="#aabbcc" />
      <hemisphereLight color={l.skyCol} groundColor={l.gndCol} intensity={l.hemiI} />

      {/* Main sun — shadow-casting, targeted at depot center */}
      <directionalLight
        position={[50, l.sunY, 30]}
        intensity={l.sunI}
        color={l.sunCol}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-far={600}
        shadow-camera-near={0.5}
        shadow-camera-left={-160}
        shadow-camera-right={160}
        shadow-camera-top={160}
        shadow-camera-bottom={-160}
        shadow-bias={0.0005}
        shadow-normalBias={0.05}
        target-position={[0, 0, -20]}
      />

      {/* Fill light from opposite side — no shadows */}
      <directionalLight
        position={[-60, 50, -40]}
        intensity={l.fillI}
        color="#ccddee"
      />

      {/* Secondary fill from front */}
      <directionalLight
        position={[0, 40, 60]}
        intensity={l.fillI * 0.5}
        color="#ddeeff"
      />

      {/* Teal accent fill */}
      <pointLight position={[0, 15, 0]} intensity={0.15} color="#00B4A6" distance={60} />
      {/* Warm fill from building */}
      <pointLight position={[-80, 8, 96]} color="#ffcc88" intensity={0.3} distance={30} />
      {/* OTTOYARD signage glow */}
      <pointLight position={[0, 16, 83]} color="#C00000" intensity={0.5} distance={20} />

      {/* Night pole lights */}
      {[[-80, 0, -40], [80, 0, -40], [-80, 0, 40], [80, 0, 40]].map((pos, i) => (
        <group key={`pole${i}`} position={pos as [number, number, number]}>
          <mesh position={[0, 6, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.25, 12, 6]} />
            <meshStandardMaterial color="#4a4a4a" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[0, 12.2, 0]}>
            <boxGeometry args={[2, 0.3, 1]} />
            <meshStandardMaterial color="#555" roughness={0.4} metalness={0.3} />
          </mesh>
          <pointLight
            position={[0, 12, 0]}
            color="#ffeedd"
            intensity={l.hour < 6 || l.hour >= 20 ? 1.5 : 0}
            distance={40}
            decay={2}
          />
        </group>
      ))}
    </>
  );
}
