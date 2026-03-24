import * as THREE from 'three';
import { useMemo } from 'react';

function calcLighting(simTime: number) {
  const hour = simTime / 3600;
  let sunI = 0, ambI = 0.28, sunCol = 'hsl(220, 24%, 42%)', sunY = 12;
  let skyCol = 'hsl(224, 50%, 16%)', gndCol = 'hsl(220, 16%, 22%)', hemiI = 0.25;
  let fillI = 0.18;
  let frontFillI = 0.1;

  if (hour >= 6 && hour < 8) {
    const t = (hour - 6) / 2;
    sunI = t * 2.6; ambI = 0.55 + t * 0.4; sunCol = 'hsl(34, 92%, 76%)'; sunY = 24 + t * 56;
    skyCol = 'hsl(28, 94%, 72%)'; gndCol = 'hsl(24, 24%, 34%)'; hemiI = 0.55 + t * 0.65; fillI = 0.35 + t * 0.55; frontFillI = 0.2 + t * 0.25;
  } else if (hour >= 8 && hour < 17) {
    sunI = 3.2; ambI = 1.2; sunCol = 'hsl(45, 100%, 95%)'; sunY = 84;
    skyCol = 'hsl(199, 72%, 73%)'; gndCol = 'hsl(214, 10%, 48%)'; hemiI = 1.35; fillI = 1.0; frontFillI = 0.55;
  } else if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    sunI = 3.2 * (1 - t); ambI = 1.1 - t * 0.72; sunCol = 'hsl(26, 95%, 68%)'; sunY = 84 - t * 58;
    skyCol = 'hsl(18, 90%, 62%)'; gndCol = 'hsl(24, 28%, 28%)'; hemiI = 1.2 - t * 0.9; fillI = 0.9 * (1 - t); frontFillI = 0.5 * (1 - t);
  }

  return { sunI, ambI, sunCol, sunY, skyCol, gndCol, hemiI, fillI, frontFillI, hour };
}

export function DayNightLighting({ simTime }: { simTime: number }) {
  const l = useMemo(() => calcLighting(simTime), [simTime]);

  return (
    <>
      <ambientLight intensity={l.ambI} color="hsl(210, 32%, 90%)" />
      <hemisphereLight color={l.skyCol} groundColor={l.gndCol} intensity={l.hemiI} />

      {/* Main sun — shadow-casting, targeted at depot center */}
      <directionalLight
        position={[64, l.sunY, 42]}
        intensity={l.sunI}
        color={l.sunCol}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={280}
        shadow-camera-near={20}
        shadow-camera-left={-140}
        shadow-camera-right={140}
        shadow-camera-top={140}
        shadow-camera-bottom={-140}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        target-position={[0, 0, 0]}
      />

      {/* Fill light from opposite side — no shadows */}
      <directionalLight
        position={[-90, 70, -50]}
        intensity={l.fillI}
        color="hsl(204, 36%, 84%)"
      />

      {/* Secondary fill from front */}
      <directionalLight
        position={[0, 52, 90]}
        intensity={l.frontFillI}
        color="hsl(202, 58%, 88%)"
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
