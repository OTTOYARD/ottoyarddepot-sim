import { forwardRef } from 'react';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { useKPIStore } from '@/store/kpiStore';

interface UtilityEquipmentProps {
  bessCapacity: number;
  bessPower: number;
}

export const UtilityEquipment = forwardRef<Group, UtilityEquipmentProps>(function UtilityEquipment(
  { bessCapacity, bessPower },
  ref,
) {
  const soc = useKPIStore(s => s.bessSOC);
  const socCol = soc > 20 ? '#00ff88' : soc > 10 ? '#ffaa00' : '#ff4444';

  return (
    <group ref={ref} position={[120, 0, -80]}>
      <mesh position={[0, 4, 0]} castShadow>
        <boxGeometry args={[12, 8, 8]} />
        <meshStandardMaterial color="#666666" roughness={0.6} metalness={0.2} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`fin${i}`} position={[6.15, 2 + i * 1, 0]}>
          <boxGeometry args={[0.15, 0.6, 7]} />
          <meshStandardMaterial color="#555555" roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
      <Html position={[0, 9, 0]} center>
        <span className="text-[7px] font-mono" style={{ color: '#666' }}>XFMR</span>
      </Html>

      <mesh position={[18, 3.5, 0]} castShadow>
        <boxGeometry args={[10, 7, 6]} />
        <meshStandardMaterial color="#555555" roughness={0.6} metalness={0.2} />
      </mesh>
      {Array.from({ length: 4 }, (_, i) => (
        <mesh key={`louver${i}`} position={[18, 2 + i * 1.2, 3.05]}>
          <boxGeometry args={[8, 0.2, 0.1]} />
          <meshStandardMaterial color="#444444" roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      <Html position={[18, 8, 0]} center>
        <span className="text-[7px] font-mono" style={{ color: '#666' }}>SWGR</span>
      </Html>

      <mesh position={[0, 4, 14]} castShadow>
        <boxGeometry args={[14 * Math.min(bessCapacity, 4), 8, 8]} />
        <meshStandardMaterial color="#4a4a4a" roughness={0.5} metalness={0.2} />
      </mesh>
      {Array.from({ length: Math.min(bessCapacity, 4) * 7 }, (_, i) => (
        <mesh key={`ridge${i}`} position={[-7 * Math.min(bessCapacity, 4) + 1 + i * 2, 4, 18.05]}>
          <boxGeometry args={[0.3, 7, 0.1]} />
          <meshStandardMaterial color="#555555" roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
      <mesh position={[-4, 3, 18.1]}>
        <boxGeometry args={[3, 5, 0.05]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1, 18.5]}>
        <boxGeometry args={[14 * Math.min(bessCapacity, 4) * (soc / 100), 2, 0.3]} />
        <meshStandardMaterial color={socCol} emissive={socCol} emissiveIntensity={0.7} />
      </mesh>
      <Html position={[0, 9, 14]} center>
        <span className="text-[7px] font-mono" style={{ color: '#666' }}>
          BESS {bessCapacity}MWh | {Math.round(soc)}%
        </span>
      </Html>

      {[[0, 0.5, 9, '#C00000'], [18, 0.5, 5, '#00B4A6'], [9, 0.5, -2, '#F59E0B']].map(([x, y, z, c], i) => (
        <mesh key={`conduit${i}`} position={[x as number, y as number, z as number]}>
          <cylinderGeometry args={[0.08, 0.08, 10, 6]} />
          <meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={0.2} />
        </mesh>
      ))}

      {[0, 8, 16].map((x, i) => (
        <mesh key={`inv${i}`} position={[-10 + x, 2, -10]} castShadow>
          <boxGeometry args={[3, 4, 2]} />
          <meshStandardMaterial color="#3a3a3a" roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
});
