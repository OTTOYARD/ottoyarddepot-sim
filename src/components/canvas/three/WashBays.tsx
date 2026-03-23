import { Html } from '@react-three/drei';

export function WashBays({ count }: { count: number }) {
  return (
    <group position={[80, 0, -60]}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} position={[i * 16, 0, 0]}>
          <mesh position={[0, 3, 0]} castShadow>
            <boxGeometry args={[14, 6, 10]} />
            <meshStandardMaterial color="#2a2a3a" roughness={0.6} metalness={0.2} />
          </mesh>
          {[-5.5, 5.5].map((x, j) => (
            <mesh key={j} position={[x, 1.5, 5.5]}>
              <boxGeometry args={[1, 3, 1]} />
              <meshStandardMaterial color="#3a3a4a" roughness={0.5} metalness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 1.5, 5.1]}>
            <planeGeometry args={[10, 3]} />
            <meshStandardMaterial color="#111122" />
          </mesh>
        </group>
      ))}
      <Html position={[((count - 1) * 16) / 2, 8, 0]} center>
        <span className="text-[9px] font-bold text-[#2196F3]/60 tracking-wider">
          WASH BAYS
        </span>
      </Html>
    </group>
  );
}
