import * as THREE from 'three';
import { useMemo } from 'react';

function calcLighting(simTime: number) {
  const hour = simTime / 3600;
  let sunI = 0, ambI = 0.15, sunCol = '#334466', sunY = 10;
  let skyCol = '#0a0a1a', gndCol = '#222222', hemiI = 0.1;
  let fillI = 0.05;

  if (hour >= 6 && hour < 8) {
    const t = (hour - 6) / 2;
    sunI = t * 2.0; ambI = 0.2 + t * 0.5; sunCol = '#ffcc88'; sunY = 20 + t * 60;
    skyCol = '#ffaa77'; gndCol = '#443322'; hemiI = 0.2 + t * 0.5; fillI = 0.1 + t * 0.3;
  } else if (hour >= 8 && hour < 17) {
    sunI = 2.5; ambI = 0.7; sunCol = '#fffaf0'; sunY = 80;
    skyCol = '#87CEEB'; gndCol = '#444444'; hemiI = 0.7; fillI = 0.4;
  } else if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    sunI = 2.5 * (1 - t); ambI = 0.7 - t * 0.55; sunCol = '#ffaa66'; sunY = 80 - t * 60;
    skyCol = '#ff7744'; gndCol = '#332211'; hemiI = 0.7 - t * 0.6; fillI = 0.4 * (1 - t);
  }

  return { sunI, ambI, sunCol, sunY, skyCol, gndCol, hemiI, fillI, hour };
}

export function DayNightLighting({ simTime }: { simTime: number }) {
  const l = useMemo(() => calcLighting(simTime), [simTime]);

  return (
    <>
      <ambientLight intensity={l.ambI} color="#aabbcc" />
      <hemisphereLight color={l.skyCol} groundColor={l.gndCol} intensity={l.hemiI} />
      <directionalLight
        position={[50, l.sunY, 30]}
        intensity={l.sunI}
        color={l.sunCol}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={250}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
        shadow-bias={-0.001}
      />
      {/* Fill light from opposite side — no shadows, prevents black faces */}
      <directionalLight
        position={[-60, 50, -40]}
        intensity={l.fillI}
        color="#ccddee"
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
