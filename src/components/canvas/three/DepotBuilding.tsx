import { Html } from '@react-three/drei';
import { MATERIALS } from './materials';

export function DepotBuilding() {
  const mullionCount = 15;

  return (
    <group>
      {/* Main body — dark cladding */}
      <mesh position={[0, 4, -90]} castShadow receiveShadow>
        <boxGeometry args={[120, 8, 35]} />
        <primitive object={MATERIALS.darkCladding()} attach="material" />
      </mesh>

      {/* Two-story corner wing */}
      <mesh position={[-52, 4.5, -90]} castShadow receiveShadow>
        <boxGeometry args={[15, 9, 12]} />
        <primitive object={MATERIALS.darkCladding()} attach="material" />
      </mesh>

      {/* Roof overhang slab */}
      <mesh position={[0, 8.05, -90]} castShadow receiveShadow>
        <boxGeometry args={[121.5, 0.15, 36.5]} />
        <primitive object={MATERIALS.darkCladding()} attach="material" />
      </mesh>

      {/* Glass curtain wall — front facade */}
      <mesh position={[0, 4, -72.3]}>
        <planeGeometry args={[118, 7.5]} />
        <primitive object={MATERIALS.architecturalGlass()} attach="material" />
      </mesh>

      {/* Side glass */}
      <mesh position={[60, 4, -90]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[33, 7.5]} />
        <primitive object={MATERIALS.architecturalGlass()} attach="material" />
      </mesh>

      {/* Glass mullions — vertical */}
      {Array.from({ length: mullionCount }, (_, i) => (
        <mesh key={`mul${i}`} position={[-56 + i * 8, 4, -72.2]}>
          <boxGeometry args={[0.04, 7.5, 0.04]} />
          <primitive object={MATERIALS.brushedAluminum()} attach="material" />
        </mesh>
      ))}
      {/* Horizontal mullion at 60% height */}
      <mesh position={[0, 4.8, -72.2]}>
        <boxGeometry args={[118, 0.04, 0.04]} />
        <primitive object={MATERIALS.brushedAluminum()} attach="material" />
      </mesh>

      {/* Entrance canopy */}
      <mesh position={[0, 3.2, -72]} castShadow>
        <boxGeometry args={[4, 0.08, 3]} />
        <primitive object={MATERIALS.structuralSteel()} attach="material" />
      </mesh>

      {/* Wood accent panel at entrance */}
      <mesh position={[0, 1.5, -72.15]}>
        <boxGeometry args={[3, 3, 0.04]} />
        <primitive object={MATERIALS.woodAccent()} attach="material" />
      </mesh>

      {/* Teal LED roofline strip */}
      <mesh position={[0, 8.15, -72.3]}>
        <boxGeometry args={[120, 0.03, 0.03]} />
        <primitive object={MATERIALS.tealLED(2.0)} attach="material" />
      </mesh>

      {/* Service bay doors */}
      {[-20, 10].map((x, i) => (
        <group key={`bay${i}`}>
          <mesh position={[x, 2.5, -72.15]}>
            <boxGeometry args={[9, 5.5, 0.3]} />
            <primitive object={MATERIALS.chargerHousing()} attach="material" />
          </mesh>
          <mesh position={[x, 2.5, -72.1]}>
            <boxGeometry args={[9.5, 6, 0.08]} />
            <primitive object={MATERIALS.brushedAluminum()} attach="material" />
          </mesh>
        </group>
      ))}

      {/* Interior warm glow — emissive mesh only, NO pointLights */}
      <mesh position={[0, 7.5, -82]}>
        <boxGeometry args={[40, 0.1, 10]} />
        <primitive object={MATERIALS.whiteLED(1.5)} attach="material" />
      </mesh>

      {/* OTTOYARD backlit signage */}
      <mesh position={[0, 9.2, -90]}>
        <boxGeometry args={[22, 1.8, 0.4]} />
        <primitive object={MATERIALS.chargerHousing()} attach="material" />
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
