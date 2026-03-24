import { useMemo, useRef } from 'react';
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
  const allStalls = useDepotStore((s) => s.stalls);
  const stalls = useMemo(
    () => allStalls.filter((st) => st.type === type),
    [allStalls, type],
  );
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
            {/* Charger pedestal — sleek rounded form */}
            <mesh position={[0, 1.8, 0]} castShadow>
              <cylinderGeometry args={[0.6, 0.7, 3.6, 16]} />
              <meshPhysicalMaterial
                color="hsl(0, 0%, 91%)"
                roughness={0.45}
                metalness={0.08}
                clearcoat={0.3}
                clearcoatRoughness={0.32}
              />
            </mesh>

            {/* Dark screen face */}
            <mesh position={[0, 2.4, 0.62]}>
              <planeGeometry args={[0.8, 1.2]} />
              <meshPhysicalMaterial color="hsl(220, 18%, 12%)" roughness={0.18} metalness={0.08} />
            </mesh>

            {/* Status LED ring on top */}
            <mesh position={[0, 3.65, 0]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.5, 0.06, 8, 24]} />
              <meshStandardMaterial
                color={isChrg ? '#00FF88' : statusColor}
                emissive={isChrg ? '#00FF88' : statusColor}
                emissiveIntensity={isOcc ? 1.5 : 0.3}
              />
            </mesh>

            {/* Type indicator base strip */}
            <mesh position={[0, 0.15, 0]}>
              <cylinderGeometry args={[0.85, 0.85, 0.3, 16]} />
              <meshStandardMaterial
                color={baseCol}
                emissive={baseCol}
                emissiveIntensity={isOcc ? 0.6 : 0.15}
              />
            </mesh>

            {/* Cable arm */}
            <mesh position={[0.7, 2.5, 0]} rotation-z={0.3}>
              <cylinderGeometry args={[0.04, 0.04, 1.5, 6]} />
              <meshPhysicalMaterial color="hsl(220, 6%, 22%)" roughness={0.75} metalness={0.05} />
            </mesh>

            {/* Ground bollard */}
            <mesh position={[1.2, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.15, 0.18, 0.6, 8]} />
              <meshPhysicalMaterial color="hsl(38, 90%, 52%)" roughness={0.65} metalness={0.08} />
            </mesh>

            {isOff && <OfflineBeacon />}
          </group>
        );
      })}

      {/* Zone label */}
      <Html position={[stalls.length > 0 ? toWorld(stalls[0].position)[0] - 8 : 0, 6, 0]}
        center distanceFactor={80}>
        <div style={{
          background: 'rgba(0,0,0,0.75)', color: isDCFC ? '#C00000' : '#00B4A6',
          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
          whiteSpace: 'nowrap', backdropFilter: 'blur(4px)',
          border: `1px solid ${isDCFC ? 'rgba(192,0,0,0.3)' : 'rgba(0,180,166,0.3)'}`,
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
      <mesh position={[0, 4.2, 0]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={1.5} />
      </mesh>
      <pointLight ref={ref} position={[0, 4.2, 0]} color="#ff0000" intensity={1} distance={5} />
    </>
  );
}
