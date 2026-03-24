import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { MATERIALS } from './materials';

export function DepotBuilding() {
  const mullionCount = 15;

  return (
    <group>
      {/* Main body — dark cladding */}
      <mesh position={[0, 4, -90]} castShadow receiveShadow>
        <boxGeometry args={[120, 8, 35]} />
        <meshPhysicalMaterial {...MATERIALS.darkCladding()} />
      </mesh>

      {/* Two-story corner wing */}
      <mesh position={[-52, 4.5, -90]} castShadow receiveShadow>
        <boxGeometry args={[15, 9, 12]} />
        <meshPhysicalMaterial {...MATERIALS.darkCladding()} />
      </mesh>

      {/* Roof overhang slab */}
      <mesh position={[0, 8.05, -90]} castShadow receiveShadow>
        <boxGeometry args={[121.5, 0.15, 36.5]} />
        <meshPhysicalMaterial {...MATERIALS.darkCladding()} />
      </mesh>

      {/* Glass curtain wall — front facade */}
      <mesh position={[0, 4, -72.3]}>
        <planeGeometry args={[118, 7.5]} />
        <meshPhysicalMaterial {...MATERIALS.architecturalGlass()} />
      </mesh>

      {/* Side glass */}
      <mesh position={[60, 4, -90]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[33, 7.5]} />
        <meshPhysicalMaterial {...MATERIALS.architecturalGlass()} />
      </mesh>

      {/* Glass mullions — vertical */}
      {Array.from({ length: mullionCount }, (_, i) => (
        <mesh key={`mul${i}`} position={[-56 + i * 8, 4, -72.2]}>
          <boxGeometry args={[0.04, 7.5, 0.04]} />
          <meshPhysicalMaterial {...MATERIALS.brushedAluminum()} />
        </mesh>
      ))}
      {/* Horizontal mullion at 60% height */}
      <mesh position={[0, 4.8, -72.2]}>
        <boxGeometry args={[118, 0.04, 0.04]} />
        <meshPhysicalMaterial {...MATERIALS.brushedAluminum()} />
      </mesh>

      {/* Entrance canopy */}
      <mesh position={[0, 3.2, -72]} castShadow>
        <boxGeometry args={[4, 0.08, 3]} />
        <meshPhysicalMaterial {...MATERIALS.structuralSteel()} />
      </mesh>

      {/* Wood accent panel at entrance */}
      <mesh position={[0, 1.5, -72.15]}>
        <boxGeometry args={[3, 3, 0.04]} />
        <meshPhysicalMaterial {...MATERIALS.woodAccent()} />
      </mesh>

      {/* Teal LED roofline strip */}
      <mesh position={[0, 8.15, -72.3]}>
        <boxGeometry args={[120, 0.03, 0.03]} />
        <meshPhysicalMaterial {...MATERIALS.tealLED(2.0)} />
      </mesh>

      {/* Service bay doors */}
      {[-20, 10].map((x, i) => (
        <group key={`bay${i}`}>
          <mesh position={[x, 2.5, -72.15]}>
            <boxGeometry args={[9, 5.5, 0.3]} />
            <meshPhysicalMaterial {...MATERIALS.chargerHousing()} />
          </mesh>
          <mesh position={[x, 2.5, -72.1]}>
            <boxGeometry args={[9.5, 6, 0.08]} />
            <meshPhysicalMaterial {...MATERIALS.brushedAluminum()} />
          </mesh>
        </group>
      ))}

      {/* Interior warm glow */}
      <pointLight position={[0, 5, -82]} color="#FFE8CC" intensity={3} distance={15} />
      <pointLight position={[-30, 3, -82]} color="#ffeebb" intensity={1} distance={12} />
      <pointLight position={[30, 3, -82]} color="#ffeebb" intensity={1} distance={12} />

      {/* OTTOYARD backlit signage */}
      <mesh position={[0, 9.2, -90]}>
        <boxGeometry args={[22, 1.8, 0.4]} />
        <meshPhysicalMaterial {...MATERIALS.chargerHousing()} />
      </mesh>
      <mesh position={[0, 9.2, -89.7]}>
        <boxGeometry args={[20, 1.4, 0.05]} />
        <meshPhysicalMaterial color="#C00000" emissive="#C00000" emissiveIntensity={1.5} roughness={0.3} metalness={0} toneMapped={false} />
      </mesh>

      <Html position={[0, 11, -89]} center>
        <span className="text-[8px] text-white/40 font-mono tracking-[0.3em]">
          OPERATIONS CENTER
        </span>
      </Html>
    </group>
  );
}
