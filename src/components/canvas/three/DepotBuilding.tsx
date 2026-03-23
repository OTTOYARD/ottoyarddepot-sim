import { Html } from '@react-three/drei';

export function DepotBuilding() {
  return (
    <group>
      {/* Service wing */}
      <mesh position={[0, 4, -90]} castShadow receiveShadow>
        <boxGeometry args={[120, 8, 35]} />
        <meshStandardMaterial color="#2D2D2D" roughness={0.7} />
      </mesh>
      {/* Two-story lounge corner */}
      <mesh position={[-52, 4.5, -90]} castShadow receiveShadow>
        <boxGeometry args={[15, 9, 12]} />
        <meshStandardMaterial color="#2D2D2D" roughness={0.6} />
      </mesh>
      {/* Glass facade */}
      <mesh position={[0, 4, -72.4]}>
        <planeGeometry args={[118, 7]} />
        <meshStandardMaterial color="#87CEEB" opacity={0.25} transparent />
      </mesh>
      {/* Green wall */}
      <mesh position={[0, 8.2, -90]}>
        <boxGeometry args={[122, 0.4, 0.4]} />
        <meshStandardMaterial color="#00B4A6" opacity={0.4} transparent />
      </mesh>
      {/* Service bay doors */}
      {[5, 30].map((x, i) => (
        <mesh key={i} position={[-40 + x * 2, 2.5, -72.3]}>
          <planeGeometry args={[8, 5]} />
          <meshStandardMaterial color="#111111" />
        </mesh>
      ))}
      {/* OTTOYARD sign */}
      <mesh position={[0, 9, -90]}>
        <boxGeometry args={[20, 1.5, 0.3]} />
        <meshStandardMaterial color="#C00000" emissive="#C00000" emissiveIntensity={0.3} />
      </mesh>
      <Html position={[0, 10.5, -89]} center>
        <span className="text-[8px] text-white/50 font-mono">
          OPERATIONS BUILDING
        </span>
      </Html>
    </group>
  );
}
