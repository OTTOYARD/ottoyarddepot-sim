import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useDepotStore } from '@/store/depotStore';
import * as THREE from 'three';
import { toWorld } from './coordUtils';

interface Props { type: 'dcfc' | 'l2'; count: number; }

const STATUS_COLORS: Record<string, string> = {
  available: '#333333',
  occupied: '#F59E0B',
  charging: '#00FF88',
  servicing: '#2196F3',
  offline: '#1a1a1a',
  reserved: '#9C27B0',
};

export function ChargingField({ type, count }: Props) {
  const stalls = useDepotStore(s =>
    s.stalls.filter(st => st.type === type));
  const isDCFC = type === 'dcfc';
  const baseCol = isDCFC ? '#C00000' : '#00B4A6';

  return (
    <group>
      {stalls.slice(0, count).map((stall) => {
        const [wx, , wz] = toWorld(stall.position);
        const isOcc = stall.status === 'occupied' || stall.status === 'charging'
          || stall.status === 'servicing';
        const isChrg = stall.status === 'charging';
        const isOff = stall.status === 'offline';
        const statusColor = STATUS_COLORS[stall.status] || '#333333';

        return (
          <group key={stall.id} position={[wx, 0, wz]}>
            {/* Charger pedestal */}
            <mesh position={[0, 1.5, 0]} castShadow>
              <boxGeometry args={[1.5, 3, 1]} />
              <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.3} />
            </mesh>
            {/* Type indicator strip */}
            <mesh position={[0, 3.1, 0]}>
              <boxGeometry args={[1.6, 0.3, 1.1]} />
              <meshStandardMaterial
                color={baseCol}
                emissive={baseCol}
                emissiveIntensity={isOcc ? 0.5 : 0.1}
              />
            </mesh>
            {/* Status glow sphere */}
            <mesh position={[0, 3.5, 0.6]}>
              <sphereGeometry args={[0.2, 8, 8]} />
              <meshStandardMaterial
                color={statusColor}
                emissive={isChrg ? '#00FF88' : statusColor}
                emissiveIntensity={isOcc ? 1 : 0.2}
              />
            </mesh>
            {isOff && <OfflineBeacon />}
          </group>
        );
      })}
      {/* Zone label */}
      <Html position={[stalls.length > 0 ? toWorld(stalls[0].position)[0] - 8 : 0, 6, 0]}
        center distanceFactor={80}>
        <div style={{
          background: 'rgba(0,0,0,0.7)', color: isDCFC ? '#C00000' : '#00B4A6',
          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
          whiteSpace: 'nowrap',
        }}>
          {isDCFC ? 'DCFC' : 'L2'}{' '}
          {stalls.filter(s => s.status !== 'available').length}/{count}
        </div>
      </Html>
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
      <mesh position={[0, 4, 0]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={1} />
      </mesh>
      <pointLight ref={ref} position={[0, 4, 0]} color="#ff0000" intensity={1} distance={5} />
    </>
  );
}
