import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useDepotStore } from '@/store/depotStore';
import * as THREE from 'three';
import { toWorld } from './coordUtils';
import { MATERIALS } from './materials';

interface Props { type: 'dcfc' | 'l2'; count: number; }

const STATUS_COLORS: Record<string, string> = {
  available: '#333333',
  occupied: '#F59E0B',
  charging: '#00FF88',
  servicing: '#2196F3',
  offline: '#1a1a1a',
  reserved: '#9C27B0',
};

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

  return (
    <group>
      {stalls.slice(0, count).map((stall) => {
        const [wx, , wz] = toWorld(stall.position);
        const isChrg = stall.status === 'charging';
        const isOcc = stall.status === 'occupied' || isChrg || stall.status === 'servicing';
        const isOff = stall.status === 'offline';

        return (
          <group key={stall.id} position={[wx, 0, wz]}>
            <ChargerPedestal isChrg={isChrg} isOcc={isOcc} stall={stall} />
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

function ChargerPedestal({ isChrg, isOcc, stall }: { isChrg: boolean; isOcc: boolean; stall: any }) {
  const ledRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ledRef.current && isChrg) {
      (ledRef.current.material as THREE.MeshPhysicalMaterial).emissiveIntensity =
        2.0 + Math.sin(clock.elapsedTime * 3) * 2.0;
    }
  });

  return (
    <group>
      {/* Base plate */}
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.04, 0.5]} />
        <meshPhysicalMaterial {...MATERIALS.brushedAluminum()} />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.45, 1.36, 0.3]} />
        <meshPhysicalMaterial {...MATERIALS.chargerHousing()} />
      </mesh>

      {/* Top cap */}
      <mesh position={[0, 1.4, 0]} castShadow>
        <boxGeometry args={[0.5, 0.04, 0.35]} />
        <meshPhysicalMaterial {...MATERIALS.brushedAluminum()} />
      </mesh>

      {/* Screen */}
      <mesh position={[0, 1.05, 0.16]}>
        <boxGeometry args={[0.32, 0.5, 0.01]} />
        <meshPhysicalMaterial {...MATERIALS.screenGlass()} />
      </mesh>
      {/* Screen backlight */}
      <mesh position={[0, 1.05, 0.165]}>
        <planeGeometry args={[0.28, 0.46]} />
        <meshPhysicalMaterial {...MATERIALS.tealLED(1.5)} />
      </mesh>

      {/* Status LED */}
      <mesh ref={ledRef} position={[0, 1.32, 0.16]}>
        <cylinderGeometry args={[0.04, 0.04, 0.02, 16]} />
        <meshPhysicalMaterial {...(isChrg || isOcc ? MATERIALS.greenIndicator() : MATERIALS.amberIndicator())} />
      </mesh>

      {/* Teal accent strips on front edges */}
      {[-0.225, 0.225].map((x, i) => (
        <mesh key={`acc${i}`} position={[x, 0.7, 0.151]}>
          <boxGeometry args={[0.015, 1.0, 0.005]} />
          <meshPhysicalMaterial {...MATERIALS.tealLED(2.0)} />
        </mesh>
      ))}

      {/* Charging cable via TubeGeometry */}
      <mesh castShadow>
        <tubeGeometry args={[cableCurve, 20, 0.02, 8, false]} />
        <meshPhysicalMaterial {...MATERIALS.chargerCable()} />
      </mesh>

      {/* Cable connector head */}
      <mesh position={[0.25, 0.05, 0.3]} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 0.08, 12]} />
        <meshPhysicalMaterial {...MATERIALS.chargerConnector()} />
      </mesh>

      {/* Bollards */}
      {[-0.5, 0.5].map((x, i) => (
        <group key={`boll${i}`} position={[x, 0, 0.3]}>
          <mesh position={[0, 0.35, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 0.7, 12]} />
            <meshPhysicalMaterial {...MATERIALS.chargerHousing()} />
          </mesh>
          {/* Teal cap */}
          <mesh position={[0, 0.715, 0]}>
            <cylinderGeometry args={[0.065, 0.065, 0.03, 12]} />
            <meshPhysicalMaterial {...MATERIALS.tealLED(2.0)} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function OfflineBeacon() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.intensity = Math.sin(clock.elapsedTime * 6) > 0 ? 2 : 0.1;
  });
  return (
    <>
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshPhysicalMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={3} toneMapped={false} roughness={0.2} metalness={0} />
      </mesh>
      <pointLight ref={ref} position={[0, 1.6, 0]} color="#ff0000" intensity={1} distance={5} />
    </>
  );
}
