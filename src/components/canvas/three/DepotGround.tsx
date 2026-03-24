export function DepotGround() {
  return (
    <group>
      {/* Main concrete pad */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[300, 220]} />
        <meshStandardMaterial color="#6a6e72" roughness={0.92} metalness={0} />
      </mesh>

      {/* Driving surface — slightly lighter */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.08, 10]} receiveShadow>
        <planeGeometry args={[220, 120]} />
        <meshStandardMaterial color="#787e84" roughness={0.86} metalness={0} />
      </mesh>

      {/* Expansion joints */}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={`hj${i}`} rotation-x={-Math.PI / 2} position={[-100 + i * 20, 0.12, 10]}>
          <planeGeometry args={[0.15, 120]} />
          <meshStandardMaterial color="#454a50" roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={`vj${i}`} rotation-x={-Math.PI / 2} position={[0, 0.12, -50 + i * 20]}>
          <planeGeometry args={[220, 0.15]} />
          <meshStandardMaterial color="#454a50" roughness={1} />
        </mesh>
      ))}

      {/* Perimeter landscaping strips */}
      {[-145, 145].map((x, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.15, 0]}>
          <planeGeometry args={[12, 220]} />
          <meshStandardMaterial color="#3a5a3a" roughness={0.95} metalness={0} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.15, -105]}>
        <planeGeometry args={[300, 12]} />
        <meshStandardMaterial color="#3a5a3a" roughness={0.95} metalness={0} />
      </mesh>

      {/* Perimeter road/curb */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, -115]}>
        <planeGeometry args={[320, 14]} />
        <meshStandardMaterial color="#5e6266" roughness={0.84} metalness={0} />
      </mesh>

      {/* Lane markings */}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={`lm${i}`} rotation-x={-Math.PI / 2} position={[0, 0.14, -50 + i * 10]}>
          <planeGeometry args={[0.3, 4]} />
          <meshStandardMaterial color="#d4ccb8" emissive="#faf4e8" emissiveIntensity={0.05} />
        </mesh>
      ))}

      {/* Curb edges */}
      {[-139, 139].map((x, i) => (
        <mesh key={`curb${i}`} position={[x, 0.2, 0]}>
          <boxGeometry args={[0.5, 0.3, 220]} />
          <meshStandardMaterial color="#969a9e" roughness={0.75} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}
