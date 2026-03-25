import * as THREE from 'three';
import { useMemo } from 'react';

function calcLighting(simTime: number) {
  const hour = simTime / 3600;
  let sunI = 0, ambI = 0.3, sunCol = '#556688', sunY = 12;
  let skyCol = '#141428', gndCol = '#333838', hemiI = 0.25;
  let fillI = 0.2;
  let frontFillI = 0.12;

  if (hour >= 6 && hour < 8) {
    const t = (hour - 6) / 2;
    sunI = t * 2.8; ambI = 0.55 + t * 0.45; sunCol = '#ffcc88'; sunY = 24 + t * 56;
    skyCol = '#ffaa77'; gndCol = '#554433'; hemiI = 0.55 + t * 0.7; fillI = 0.4 + t * 0.5; frontFillI = 0.2 + t * 0.3;
  } else if (hour >= 8 && hour < 17) {
    sunI = 3.5; ambI = 1.3; sunCol = '#fffaf0'; sunY = 84;
    skyCol = '#87CEEB'; gndCol = '#666666'; hemiI = 1.4; fillI = 1.0; frontFillI = 0.6;
  } else if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    sunI = 3.5 * (1 - t); ambI = 1.2 - t * 0.8; sunCol = '#ffaa66'; sunY = 84 - t * 58;
    skyCol = '#ff7744'; gndCol = '#443322'; hemiI = 1.3 - t * 1.0; fillI = 0.9 * (1 - t); frontFillI = 0.5 * (1 - t);
  }

  return { sunI, ambI, sunCol, sunY, skyCol, gndCol, hemiI, fillI, frontFillI, hour };
}

export function DayNightLighting({ simTime }: { simTime: number }) {
  const l = useMemo(() => calcLighting(simTime), [simTime]);

  return (
    <>
      <ambientLight intensity={l.ambI} color="#bccadd" />
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
        position={[-80, 65, -50]}
        intensity={l.fillI}
        color="#c8d8e8"
      />

      {/* Secondary fill from front */}
      <directionalLight
        position={[0, 50, 80]}
        intensity={l.frontFillI}
        color="#d8e4f0"
      />

      {/* Night pole lights — emissive mesh only, NO pointLights */}
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
          {/* Emissive fixture instead of pointLight */}
          <mesh position={[0, 11.9, 0]}>
            <boxGeometry args={[1.6, 0.08, 0.6]} />
            <meshStandardMaterial
              color="#ffeedd"
              emissive="#ffeedd"
              emissiveIntensity={l.hour < 6 || l.hour >= 20 ? 3.0 : 0}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}
