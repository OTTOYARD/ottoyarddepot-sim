import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useDepotStore } from '@/store/depotStore';
import * as THREE from 'three';
import { toWorld } from './coordUtils';
import { MATERIALS } from './materials';

interface Props { type: 'dcfc' | 'l2'; count: number; }

// Cable curve
const cablePts = [
  new THREE.Vector3(0.23, 0.5, 0.1),
  new THREE.Vector3(0.35, 0.45, 0.15),
  new THREE.Vector3(0.4, 0.25, 0.2),
  new THREE.Vector3(0.35, 0.1, 0.25),
  new THREE.Vector3(0.25, 0.05, 0.3),
];
const cableCurve = new THREE.CatmullRomCurve3(cablePts);

export function ChargingField({ type, count }: Props) {
  const allStalls = useDepotStore((s) => s.stalls);
  const stalls = useMemo(
    () => allStalls.filter((st) => st.type === type),
    [allStalls, type],
  );
  const isDCFC = type === 'dcfc';

  // Batch LED animation — single useFrame for all chargers
  const ledRefs = useRef<(THREE.Mesh | null)[]>([]);
  const chargingFlags = useRef<boolean[]>([]);

  useFrame(({ clock }) => {
    const intensity = 2.0 + Math.sin(clock.elapsedTime * 3) * 2.0;
    for (let i = 0; i < ledRefs.current.length; i++) {
      const mesh = ledRefs.current[i];
      if (mesh && chargingFlags.current[i]) {
        (mesh.material as THREE.MeshPhysicalMaterial).emissiveIntensity = intensity;
      }
    }
  });

  return (
    <group>
      {stalls.slice(0, count).map((stall, idx) => {
        const [wx, , wz] = toWorld(stall.position);
        const isChrg = stall.status === 'charging';
        const isOcc = stall.status === 'occupied' || isChrg || stall.status === 'servicing';
        const isOff = stall.status === 'offline';

        // Track charging state for batched animation
        chargingFlags.current[idx] = isChrg;

        return (
          <group key={stall.id} position={[wx, 0, wz]}>
            <ChargerPedestal
              isChrg={isChrg}
              isOcc={isOcc}
              ledRef={(el) => { ledRefs.current[idx] = el; }}
            />
            {isOff && <OfflineBeacon />}
          </group>
        );
      })}

      {/* Zone label */}
      <Html position={[stalls.length > 0 ? toWorld(stalls[0].position)[0] - 8 : 0, 6, 0]}
        center distanceFactor={80}>
        <div style={{
          background: 'rgba(0,0,0,0.75)', color: isDCFC ? '#C00000' : '#00D4AA',
          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
          whiteSpace: 'nowrap', backdropFilter: 'blur(4px)',
          border: `1px solid ${isDCFC ? 'rgba(192,0,0,0.3)' : 'rgba(0,212,170,0.3)'}`,
        }}>
          {isDCFC ? 'DCFC' : 'L2'}{' '}
          {stalls.filter(s => s.status !== 'available').length}/{count}
        </div>
      </Html>
    </group>
  );
}

function ChargerPedestal({ isChrg, isOcc, ledRef }: {
  isChrg: boolean;
  isOcc: boolean;
  ledRef: (el: THREE.Mesh | null) => void;
}) {
  return (
    <group>
      {/* Base plate */}
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.04, 0.5]} />
        <primitive object={MATERIALS.brushedAluminum()} attach="material" />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.45, 1.36, 0.3]} />
        <primitive object={MATERIALS.chargerHousing()} attach="material" />
      </mesh>

      {/* Top cap */}
      <mesh position={[0, 1.4, 0]} castShadow>
        <boxGeometry args={[0.5, 0.04, 0.35]} />
        <primitive object={MATERIALS.brushedAluminum()} attach="material" />
      </mesh>

      {/* Screen */}
      <mesh position={[0, 1.05, 0.16]}>
        <boxGeometry args={[0.32, 0.5, 0.01]} />
        <primitive object={MATERIALS.screenGlass()} attach="material" />
      </mesh>
      {/* Screen backlight */}
      <mesh position={[0, 1.05, 0.165]}>
        <planeGeometry args={[0.28, 0.46]} />
        <primitive object={MATERIALS.tealLED(1.5)} attach="material" />
      </mesh>

      {/* Status LED — reduced segments */}
      <mesh ref={ledRef} position={[0, 1.32, 0.16]}>
        <cylinderGeometry args={[0.04, 0.04, 0.02, 8]} />
        <primitive object={isChrg || isOcc ? MATERIALS.greenIndicator() : MATERIALS.amberIndicator()} attach="material" />
      </mesh>

      {/* Teal accent strips on front edges */}
      {[-0.225, 0.225].map((x, i) => (
        <mesh key={`acc${i}`} position={[x, 0.7, 0.151]}>
          <boxGeometry args={[0.015, 1.0, 0.005]} />
          <primitive object={MATERIALS.tealLED(2.0)} attach="material" />
        </mesh>
      ))}

      {/* Charging cable — reduced segments */}
      <mesh>
        <tubeGeometry args={[cableCurve, 12, 0.02, 6, false]} />
        <primitive object={MATERIALS.chargerCable()} attach="material" />
      </mesh>

      {/* Cable connector head — reduced segments */}
      <mesh position={[0.25, 0.05, 0.3]}>
        <cylinderGeometry args={[0.025, 0.03, 0.08, 6]} />
        <primitive object={MATERIALS.chargerConnector()} attach="material" />
      </mesh>

      {/* Bollards — reduced segments, no castShadow */}
      {[-0.5, 0.5].map((x, i) => (
        <group key={`boll${i}`} position={[x, 0, 0.3]}>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.7, 6]} />
            <primitive object={MATERIALS.chargerHousing()} attach="material" />
          </mesh>
          <mesh position={[0, 0.715, 0]}>
            <cylinderGeometry args={[0.065, 0.065, 0.03, 6]} />
            <primitive object={MATERIALS.tealLED(2.0)} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function OfflineBeacon() {
  return (
    <mesh position={[0, 1.6, 0]}>
      <sphereGeometry args={[0.08, 6, 6]} />
      <meshPhysicalMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={3} toneMapped={false} roughness={0.2} metalness={0} />
    </mesh>
  );
}
