import { Html } from '@react-three/drei';
import { useKPIStore } from '@/store/kpiStore';

export function UtilityEquipment({ bessCapacity, bessPower }:
  { bessCapacity: number; bessPower: number }) {
  const soc = useKPIStore(s => s.bessSOC);
  const socCol = soc > 20 ? '#00ff88' : soc > 10 ? '#ffaa00' : '#ff4444';

  return (
    <group position={[120, 0, -80]}>
      {/* Transformer */}
      <mesh position={[0, 4, 0]} castShadow>
        <boxGeometry args={[12, 8, 8]} />
        <meshStandardMaterial color="#5a5a5a" roughness={0.4} metalness={0.6} />
      </mesh>
      <Html position={[0, 9, 0]} center>
        <span className="text-[7px] text-otto-gray font-mono">XFMR</span>
      </Html>
      {/* Switchgear */}
      <mesh position={[18, 3.5, 0]} castShadow>
        <boxGeometry args={[10, 7, 6]} />
        <meshStandardMaterial color="#4a4a4a" roughness={0.5} metalness={0.5} />
      </mesh>
      <Html position={[18, 8, 0]} center>
        <span className="text-[7px] text-otto-gray font-mono">SWGR</span>
      </Html>
      {/* BESS - size scales with slider */}
      <mesh position={[0, 4, 14]} castShadow>
        <boxGeometry args={[14 * Math.min(bessCapacity, 4), 8, 8]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 1, 18.5]}>
        <boxGeometry args={[14 * Math.min(bessCapacity, 4) * (soc / 100), 2, 0.3]} />
        <meshStandardMaterial color={socCol} emissive={socCol} emissiveIntensity={0.5} />
      </mesh>
      <Html position={[0, 9, 14]} center>
        <span className="text-[7px] text-otto-gray font-mono">
          BESS {bessCapacity}MWh | {Math.round(soc)}%
        </span>
      </Html>
      {/* Solar inverters */}
      {[0, 8, 16].map((x, i) => (
        <mesh key={i} position={[-10 + x, 2, -10]} castShadow>
          <boxGeometry args={[3, 4, 2]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
