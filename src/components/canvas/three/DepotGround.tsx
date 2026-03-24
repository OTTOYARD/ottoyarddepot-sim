export function DepotGround() {
  return (
    <group>
      {/* Main concrete pad */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[300, 220]} />
        <meshStandardMaterial color="hsl(220, 6%, 46%)" roughness={0.92} metalness={0} />
      </mesh>

      {/* Driving surface — slightly lighter */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.06, 10]} receiveShadow>
        <planeGeometry args={[220, 120]} />
        <meshStandardMaterial color="hsl(215, 8%, 52%)" roughness={0.86} metalness={0} />
      </mesh>

      {/* Expansion joints */}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={`hj${i}`} rotation-x={-Math.PI / 2} position={[-100 + i * 20, 0.075, 10]}>
          <planeGeometry args={[0.15, 120]} />
          <meshStandardMaterial color="hsl(220, 8%, 30%)" roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={`vj${i}`} rotation-x={-Math.PI / 2} position={[0, 0.075, -50 + i * 20]}>
          <planeGeometry args={[220, 0.15]} />
          <meshStandardMaterial color="hsl(220, 8%, 30%)" roughness={1} />
        </mesh>
      ))}

      {/* Perimeter landscaping strips */}
      {[-145, 145].map((x, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.1, 0]}>
          <planeGeometry args={[12, 220]} />
          <meshStandardMaterial color="hsl(120, 26%, 31%)" roughness={0.95} metalness={0} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.1, -105]}>
        <planeGeometry args={[300, 12]} />
        <meshStandardMaterial color="hsl(120, 26%, 31%)" roughness={0.95} metalness={0} />
      </mesh>

      {/* Perimeter road/curb */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.045, -115]}>
        <planeGeometry args={[320, 14]} />
        <meshStandardMaterial color="hsl(215, 7%, 40%)" roughness={0.84} metalness={0} />
      </mesh>

      {/* Lane markings */}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={`lm${i}`} rotation-x={-Math.PI / 2} position={[0, 0.09, -50 + i * 10]}>
          <planeGeometry args={[0.3, 4]} />
          <meshStandardMaterial color="hsl(45, 20%, 82%)" emissive="hsl(45, 35%, 96%)" emissiveIntensity={0.05} />
        </mesh>
      ))}

      {/* Curb edges */}
      {[-139, 139].map((x, i) => (
        <mesh key={`curb${i}`} position={[x, 0.18, 0]}>
          <boxGeometry args={[0.5, 0.3, 220]} />
          <meshStandardMaterial color="hsl(220, 6%, 62%)" roughness={0.75} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}
