export function DepotGround() {
  return (
    <group>
      {/* Main concrete pad */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[300, 220]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.85} metalness={0} />
      </mesh>

      {/* Driving surface — slightly lighter */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 10]} receiveShadow>
        <planeGeometry args={[220, 120]} />
        <meshStandardMaterial color="#444444" roughness={0.8} metalness={0} />
      </mesh>

      {/* Expansion joints */}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={`hj${i}`} rotation-x={-Math.PI / 2} position={[-100 + i * 20, 0.025, 10]}>
          <planeGeometry args={[0.15, 120]} />
          <meshStandardMaterial color="#2a2a2a" roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={`vj${i}`} rotation-x={-Math.PI / 2} position={[0, 0.025, -50 + i * 20]}>
          <planeGeometry args={[220, 0.15]} />
          <meshStandardMaterial color="#2a2a2a" roughness={1} />
        </mesh>
      ))}

      {/* Perimeter landscaping strips */}
      {[-145, 145].map((x, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.04, 0]}>
          <planeGeometry args={[12, 220]} />
          <meshStandardMaterial color="#2a4a2a" roughness={0.95} metalness={0} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, -105]}>
        <planeGeometry args={[300, 12]} />
        <meshStandardMaterial color="#2a4a2a" roughness={0.95} metalness={0} />
      </mesh>

      {/* Perimeter road/curb */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, -115]}>
        <planeGeometry args={[320, 14]} />
        <meshStandardMaterial color="#4a4a4a" roughness={0.8} metalness={0} />
      </mesh>

      {/* Lane markings */}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={`lm${i}`} rotation-x={-Math.PI / 2} position={[0, 0.035, -50 + i * 10]}>
          <planeGeometry args={[0.3, 4]} />
          <meshStandardMaterial color="#cccccc" emissive="#ffffff" emissiveIntensity={0.1} />
        </mesh>
      ))}

      {/* Curb edges */}
      {[-139, 139].map((x, i) => (
        <mesh key={`curb${i}`} position={[x, 0.15, 0]}>
          <boxGeometry args={[0.5, 0.3, 220]} />
          <meshStandardMaterial color="#666666" roughness={0.7} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}
