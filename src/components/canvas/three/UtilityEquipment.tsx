import { toWorld } from './coordUtils';
import { Html } from '@react-three/drei';

interface EquipBox {
  label: string;
  pos2d: { x: number; y: number };
  size: [number, number, number];
}

const equipment: EquipBox[] = [
  { label: 'BESS', pos2d: { x: 255, y: 10 }, size: [20, 5, 10] },
  { label: 'XFMR', pos2d: { x: 255, y: 21 }, size: [20, 4, 8] },
  { label: 'SWGR', pos2d: { x: 279, y: 9 }, size: [18, 4, 8] },
];

export function UtilityEquipment() {
  return (
    <group>
      {equipment.map((eq) => {
        const [x, , z] = toWorld(eq.pos2d);
        return (
          <group key={eq.label} position={[x, 0, z]}>
            <mesh position={[0, eq.size[1] / 2, 0]} castShadow>
              <boxGeometry args={eq.size} />
              <meshStandardMaterial color="#9E9E9E" roughness={0.4} metalness={0.5} opacity={0.6} transparent />
            </mesh>
            <Html position={[0, eq.size[1] + 1, 0]} center>
              <span className="text-[7px] text-[#9E9E9E] font-mono">{eq.label}</span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
