export function DepotGround() {
  return (
    <group>
      {/* Main concrete pad */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[300, 220]} />
        <meshPhysicalMaterial
          color="#2a2a2a"
          roughness={0.55}
          metalness={0.08}
          clearcoat={0.25}
          clearcoatRoughness={0.4}
        />
      </mesh>

      {/* Driving surface — slightly lighter */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 10]} receiveShadow>
        <planeGeometry args={[220, 120]} />
        <meshPhysicalMaterial
          color="#303030"
          roughness={0.5}
          metalness={0.05}
          clearcoat={0.15}
          clearcoatRoughness={0.5}
        />
      </mesh>

      {/* Expansion joints — subtle grid lines */}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={`hj${i}`} rotation-x={-Math.PI / 2} position={[-100 + i * 20, 0.025, 10]}>
          <planeGeometry args={[0.15, 120]} />
          <meshStandardMaterial color="#1a1a1a" roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={`vj${i}`} rotation-x={-Math.PI / 2} position={[0, 0.025, -50 + i * 20]}>
          <planeGeometry args={[220, 0.15]} />
          <meshStandardMaterial color="#1a1a1a" roughness={1} />
        </mesh>
      ))}

      {/* Perimeter landscaping strips */}
      {[-145, 145].map((x, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.04, 0]}>
          <planeGeometry args={[12, 220]} />
          <meshPhysicalMaterial color="#1a3a1a" roughness={0.95} metalness={0} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, -105]}>
        <planeGeometry args={[300, 12]} />
        <meshPhysicalMaterial color="#1a3a1a" roughness={0.95} metalness={0} />
      </mesh>

      {/* Perimeter road/curb */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, -115]}>
        <planeGeometry args={[320, 14]} />
        <meshPhysicalMaterial color="#383838" roughness={0.7} metalness={0.05} />
      </mesh>

      {/* Lane markings — white dashed center lines */}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={`lm${i}`} rotation-x={-Math.PI / 2} position={[0, 0.035, -50 + i * 10]}>
          <planeGeometry args={[0.3, 4]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.15} />
        </mesh>
      ))}

      {/* Curb edges — subtle raised strips */}
      {[-139, 139].map((x, i) => (
        <mesh key={`curb${i}`} position={[x, 0.15, 0]}>
          <boxGeometry args={[0.5, 0.3, 220]} />
          <meshPhysicalMaterial color="#555555" roughness={0.6} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}
