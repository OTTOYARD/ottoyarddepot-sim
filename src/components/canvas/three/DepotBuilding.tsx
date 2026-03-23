import { Html } from '@react-three/drei';

export function DepotBuilding() {
  return (
    <group>
      {/* Main steel frame structure */}
      <mesh position={[0, 4, -90]} castShadow receiveShadow>
        <boxGeometry args={[120, 8, 35]} />
        <meshPhysicalMaterial color="#2a2a2a" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Two-story corner wing */}
      <mesh position={[-52, 4.5, -90]} castShadow receiveShadow>
        <boxGeometry args={[15, 9, 12]} />
        <meshPhysicalMaterial color="#252525" roughness={0.25} metalness={0.85} />
      </mesh>

      {/* Glass curtain wall — front facade */}
      <mesh position={[0, 4, -72.3]}>
        <planeGeometry args={[118, 7.5]} />
        <meshPhysicalMaterial
          color="#88bbdd"
          roughness={0.05}
          metalness={0.1}
          transmission={0.85}
          ior={1.5}
          thickness={0.5}
          transparent
          opacity={0.35}
        />
      </mesh>

      {/* Glass mullions — vertical steel dividers */}
      {Array.from({ length: 15 }, (_, i) => (
        <mesh key={`mul${i}`} position={[-56 + i * 8, 4, -72.2]}>
          <boxGeometry args={[0.15, 7.5, 0.1]} />
          <meshPhysicalMaterial color="#1a1a1a" roughness={0.3} metalness={0.9} />
        </mesh>
      ))}
      {/* Horizontal transom */}
      <mesh position={[0, 7.8, -72.2]}>
        <boxGeometry args={[118, 0.12, 0.1]} />
        <meshPhysicalMaterial color="#1a1a1a" roughness={0.3} metalness={0.9} />
      </mesh>

      {/* Interior warm glow visible through glass */}
      <pointLight position={[0, 4, -80]} color="#ffddaa" intensity={0.6} distance={25} />
      <pointLight position={[-30, 3, -82]} color="#ffeebb" intensity={0.3} distance={15} />
      <pointLight position={[30, 3, -82]} color="#ffeebb" intensity={0.3} distance={15} />

      {/* Roof parapet with teal LED accent strip */}
      <mesh position={[0, 8.15, -72.5]}>
        <boxGeometry args={[120, 0.3, 0.3]} />
        <meshStandardMaterial color="#00B4A6" emissive="#00B4A6" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 8.15, -107.5]}>
        <boxGeometry args={[120, 0.3, 0.3]} />
        <meshStandardMaterial color="#00B4A6" emissive="#00B4A6" emissiveIntensity={0.4} />
      </mesh>

      {/* Service bay doors — dark recessed panels */}
      {[-20, 10].map((x, i) => (
        <group key={`bay${i}`}>
          <mesh position={[x, 2.5, -72.15]}>
            <boxGeometry args={[9, 5.5, 0.3]} />
            <meshPhysicalMaterial color="#0a0a0a" roughness={0.8} metalness={0.2} />
          </mesh>
          {/* Door frame */}
          <mesh position={[x, 2.5, -72.1]}>
            <boxGeometry args={[9.5, 6, 0.08]} />
            <meshPhysicalMaterial color="#333333" roughness={0.3} metalness={0.7} />
          </mesh>
        </group>
      ))}

      {/* OTTOYARD backlit signage */}
      <mesh position={[0, 9.2, -90]}>
        <boxGeometry args={[22, 1.8, 0.4]} />
        <meshPhysicalMaterial color="#1a0000" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh position={[0, 9.2, -89.7]}>
        <boxGeometry args={[20, 1.4, 0.05]} />
        <meshStandardMaterial
          color="#C00000"
          emissive="#C00000"
          emissiveIntensity={1.2}
        />
      </mesh>

      <Html position={[0, 11, -89]} center>
        <span className="text-[8px] text-white/40 font-mono tracking-[0.3em]">
          OPERATIONS CENTER
        </span>
      </Html>
    </group>
  );
}
