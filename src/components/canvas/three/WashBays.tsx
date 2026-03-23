import { Html } from '@react-three/drei';

export function WashBays({ count }: { count: number }) {
  return (
    <group position={[80, 0, -60]}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} position={[i * 16, 0, 0]}>
          {/* Concrete enclosure */}
          <mesh position={[0, 3, 0]} castShadow>
            <boxGeometry args={[14, 6, 10]} />
            <meshPhysicalMaterial color="#2a2a30" roughness={0.55} metalness={0.15} />
          </mesh>

          {/* Entrance pillars */}
          {[-5.5, 5.5].map((x, j) => (
            <mesh key={j} position={[x, 1.5, 5.5]} castShadow>
              <boxGeometry args={[1, 3, 1]} />
              <meshPhysicalMaterial color="#3a3a44" roughness={0.35} metalness={0.4} />
            </mesh>
          ))}

          {/* Roller door opening — dark interior */}
          <mesh position={[0, 1.5, 5.1]}>
            <planeGeometry args={[10, 3]} />
            <meshPhysicalMaterial color="#080810" roughness={0.9} metalness={0.1} />
          </mesh>

          {/* Interior blue lighting */}
          <pointLight position={[0, 4, 0]} color="#2196F3" intensity={0.4} distance={8} />

          {/* Water drainage grate */}
          {Array.from({ length: 8 }, (_, g) => (
            <mesh key={`grate${g}`} rotation-x={-Math.PI / 2} position={[-3.5 + g * 1, 0.03, 5.5]}>
              <planeGeometry args={[0.15, 2]} />
              <meshPhysicalMaterial color="#444444" roughness={0.3} metalness={0.7} />
            </mesh>
          ))}
        </group>
      ))}
      <Html position={[((count - 1) * 16) / 2, 8, 0]} center>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(33,150,243,0.6)' }}>
          WASH BAYS
        </span>
      </Html>
    </group>
  );
}
