import { useDepotStore } from '@/store/depotStore';
import { toWorld } from './coordUtils';

const STATUS_COLORS: Record<string, string> = {
  available: '#333333',
  occupied: '#F59E0B',
  charging: '#00FF88',
  servicing: '#2196F3',
  offline: '#1a1a1a',
  reserved: '#9C27B0',
};

function StallBox({ position, type, status }: { position: [number, number, number]; type: 'dcfc' | 'l2'; status: string }) {
  const accentColor = type === 'dcfc' ? '#C00000' : '#00B4A6';
  const statusColor = STATUS_COLORS[status] || '#333333';
  const isActive = status === 'charging' || status === 'occupied';

  return (
    <group position={position}>
      {/* Charger pedestal */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[1.5, 3, 1]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Type indicator on top */}
      <mesh position={[0, 3.1, 0]}>
        <boxGeometry args={[1.6, 0.3, 1.1]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={isActive ? 0.5 : 0.1}
        />
      </mesh>
      {/* Status light */}
      <mesh position={[0, 3.5, 0.6]}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshStandardMaterial
          color={statusColor}
          emissive={statusColor}
          emissiveIntensity={isActive ? 1 : 0.2}
        />
      </mesh>
    </group>
  );
}

export function ChargingField() {
  const stalls = useDepotStore((s) => s.stalls);
  const chargers = stalls.filter((s) => s.type === 'dcfc' || s.type === 'l2');

  return (
    <group>
      {chargers.map((stall) => {
        const [x, , z] = toWorld(stall.position);
        return (
          <StallBox
            key={stall.id}
            position={[x, 0, z]}
            type={stall.type as 'dcfc' | 'l2'}
            status={stall.status}
          />
        );
      })}
    </group>
  );
}
