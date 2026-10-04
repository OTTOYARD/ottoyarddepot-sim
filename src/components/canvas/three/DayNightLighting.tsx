import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { calcLighting, nightFromSun, DAY_SKY, NIGHT_SKY } from './dayNight';

/**
 * Consolidated site lighting rig driven by sim time.
 * One shadow-casting sun (full-lot coverage), sky/ground hemisphere,
 * cool fill, and a soft front kick. Pole fixtures live in UtilityEquipment.
 * The keyframes live in dayNight.ts.
 */

const DAY_FOG = new THREE.Color(DAY_SKY.fog), NIGHT_FOG = new THREE.Color(NIGHT_SKY.fog);

/**
 * `shadows` / `shadowMapSize` are the render tier's shadow budget
 * (quality/tiers.ts). High is the rig as it always was: 2048² over the lot.
 */
export function DayNightLighting({ simTime, shadows = true, shadowMapSize = 2048 }: {
  simTime: number; shadows?: boolean; shadowMapSize?: number;
}) {
  const l = useMemo(() => calcLighting(simTime), [simTime]);

  // the sky and the haze follow the sun (in fiftieths, so a running clock rarely touches them)
  const scene = useThree((s) => s.scene);
  const night = Math.round(nightFromSun(l.sunI) * 50) / 50;
  useEffect(() => {
    scene.backgroundIntensity = DAY_SKY.background + (NIGHT_SKY.background - DAY_SKY.background) * night;
    if (scene.fog) scene.fog.color.copy(DAY_FOG).lerp(NIGHT_FOG, night);
  }, [scene, night]);

  // sun sweeps east→west across the day; elevation from the curve
  const az = ((l.hour - 6) / 12) * Math.PI;
  const R = 420;
  const sunPos: [number, number, number] = [
    Math.cos(az) * R * 0.8,
    60 + l.elev * 300,
    Math.sin(az) * R * 0.45 + 80,
  ];

  return (
    <>
      <ambientLight intensity={l.ambI} color="#cdd8e6" />
      <hemisphereLight color={l.skyCol} groundColor={l.gndCol} intensity={l.hemiI} />

      {/* Sun — single shadow caster, covers the entire fenced lot */}
      <directionalLight
        key={shadowMapSize /* a new size needs a new shadow map */}
        position={sunPos}
        intensity={l.sunI}
        color={l.sunCol}
        castShadow={shadows}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={50}
        shadow-camera-far={900}
        shadow-camera-left={-185}
        shadow-camera-right={185}
        shadow-camera-top={185}
        shadow-camera-bottom={-185}
        shadow-bias={-0.0002}
        shadow-normalBias={0.03}
      />

      {/* Cool sky fill from the opposite side */}
      <directionalLight position={[-220, 160, -120]} intensity={l.sunI * 0.16} color="#bcd2ea" />
      {/* Soft front kick so south facades never go dead */}
      <directionalLight position={[40, 120, -260]} intensity={l.sunI * 0.10} color="#dde8f4" />
    </>
  );
}
