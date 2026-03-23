import { Html } from '@react-three/drei';
import { useKPIStore } from '@/store/kpiStore';

export function UtilityEquipment({ bessCapacity, bessPower }:
  { bessCapacity: number; bessPower: number }) {
  const soc = useKPIStore(s => s.bessSOC);
  const socCol = soc > 20 ? '#00ff88' : soc > 10 ? '#ffaa00' : '#ff4444';

  return (
    <group position={[120, 0, -80]}>
      {/* Transformer with cooling fins */}
      <mesh position={[0, 4, 0]} castShadow>
        <boxGeometry args={[12, 8, 8]} />
        <meshPhysicalMaterial color="#5a5a5a" roughness={0.35} metalness={0.65} />
      </mesh>
      {/* Cooling fins */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`fin${i}`} position={[6.15, 2 + i * 1, 0]}>
          <boxGeometry args={[0.15, 0.6, 7]} />
          <meshPhysicalMaterial color="#4a4a4a" roughness={0.3} metalness={0.7} />
        </mesh>
      ))}
      <Html position={[0, 9, 0]} center>
        <span className="text-[7px] font-mono" style={{ color: '#666' }}>XFMR</span>
      </Html>

      {/* Switchgear */}
      <mesh position={[18, 3.5, 0]} castShadow>
        <boxGeometry args={[10, 7, 6]} />
        <meshPhysicalMaterial color="#4a4a4a" roughness={0.4} metalness={0.55} />
      </mesh>
      {/* Ventilation louvers */}
      {Array.from({ length: 4 }, (_, i) => (
        <mesh key={`louver${i}`} position={[18, 2 + i * 1.2, 3.05]}>
          <boxGeometry args={[8, 0.2, 0.1]} />
          <meshPhysicalMaterial color="#333" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
      <Html position={[18, 8, 0]} center>
        <span className="text-[7px] font-mono" style={{ color: '#666' }}>SWGR</span>
      </Html>

      {/* BESS containers — corrugated texture */}
      <mesh position={[0, 4, 14]} castShadow>
        <boxGeometry args={[14 * Math.min(bessCapacity, 4), 8, 8]} />
        <meshPhysicalMaterial color="#353535" roughness={0.25} metalness={0.7} />
      </mesh>
      {/* Corrugated ridges */}
      {Array.from({ length: Math.min(bessCapacity, 4) * 7 }, (_, i) => (
        <mesh key={`ridge${i}`} position={[-7 * Math.min(bessCapacity, 4) + 1 + i * 2, 4, 18.05]}>
          <boxGeometry args={[0.3, 7, 0.1]} />
          <meshPhysicalMaterial color="#3d3d3d" roughness={0.3} metalness={0.6} />
        </mesh>
      ))}
      {/* BESS door detail */}
      <mesh position={[-4, 3, 18.1]}>
        <boxGeometry args={[3, 5, 0.05]} />
        <meshPhysicalMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* SoC bar */}
      <mesh position={[0, 1, 18.5]}>
        <boxGeometry args={[14 * Math.min(bessCapacity, 4) * (soc / 100), 2, 0.3]} />
        <meshStandardMaterial color={socCol} emissive={socCol} emissiveIntensity={0.7} />
      </mesh>
      <Html position={[0, 9, 14]} center>
        <span className="text-[7px] font-mono" style={{ color: '#666' }}>
          BESS {bessCapacity}MWh | {Math.round(soc)}%
        </span>
      </Html>

      {/* Conduit runs */}
      {[[0, 0.5, 9, '#C00000'], [18, 0.5, 5, '#00B4A6'], [9, 0.5, -2, '#F59E0B']].map(([x, y, z, c], i) => (
        <mesh key={`conduit${i}`} position={[x as number, y as number, z as number]}>
          <cylinderGeometry args={[0.08, 0.08, 10, 6]} />
          <meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={0.2} />
        </mesh>
      ))}

      {/* Solar inverters */}
      {[0, 8, 16].map((x, i) => (
        <mesh key={`inv${i}`} position={[-10 + x, 2, -10]} castShadow>
          <boxGeometry args={[3, 4, 2]} />
          <meshPhysicalMaterial color="#2a2a2a" roughness={0.35} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
