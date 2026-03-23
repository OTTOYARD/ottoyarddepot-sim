export function DriveAisles() {
  return (
    <group>
      {/* Main drive aisles */}
      {[[-110, 0.03, 0], [110, 0.03, 0]].map((pos, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={pos as any}>
          <planeGeometry args={[20, 180]} />
          <meshPhysicalMaterial color="#1e1e1e" roughness={0.7} metalness={0.05} />
        </mesh>
      ))}

      {/* White dashed lane markings */}
      {[-110, 110].map((x, ai) =>
        Array.from({ length: 12 }, (_, j) => (
          <mesh key={`dash${ai}${j}`} rotation-x={-Math.PI / 2}
            position={[x, 0.04, -55 + j * 10]}>
            <planeGeometry args={[0.25, 3.5]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
          </mesh>
        ))
      )}

      {/* Directional arrows */}
      {[-110, 110].map((x, ai) =>
        Array.from({ length: 3 }, (_, j) => (
          <mesh key={`arrow${ai}${j}`} rotation-x={-Math.PI / 2}
            rotation-z={ai === 0 ? 0 : Math.PI}
            position={[x, 0.045, -40 + j * 40]}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={3}
                array={new Float32Array([0, 1.5, 0, -1, -0.5, 0, 1, -0.5, 0])}
                itemSize={3}
              />
            </bufferGeometry>
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.15} side={2} />
          </mesh>
        ))
      )}

      {/* Entry/Exit gates — boom barriers */}
      {[
        { x: -110, z: -95, col: '#00B4A6', label: 'ENTRY' },
        { x: 110, z: -95, col: '#C00000', label: 'EXIT' },
      ].map((gate, i) => (
        <group key={i} position={[gate.x, 0, gate.z]}>
          {/* Gate posts */}
          {[-4, 4].map((px, j) => (
            <mesh key={j} position={[px, 2, 0]} castShadow>
              <boxGeometry args={[0.5, 4, 0.5]} />
              <meshPhysicalMaterial color={gate.col} roughness={0.3} metalness={0.6} />
            </mesh>
          ))}
          {/* Boom arm */}
          <mesh position={[0, 3.8, 0]}>
            <boxGeometry args={[8.5, 0.15, 0.15]} />
            <meshPhysicalMaterial color="#ffffff" roughness={0.3} metalness={0.4} />
          </mesh>
          {/* Red/green stripe on boom */}
          <mesh position={[0, 3.8, 0.1]}>
            <boxGeometry args={[8.5, 0.08, 0.02]} />
            <meshStandardMaterial color={gate.col} emissive={gate.col} emissiveIntensity={0.5} />
          </mesh>
          {/* Gate light */}
          <pointLight position={[0, 3, 0]} color={gate.col} intensity={0.4} distance={10} />
        </group>
      ))}
    </group>
  );
}
