import { MATERIALS } from './materials';

export function DriveAisles() {
  return (
    <group>
      {/* Main drive aisles — asphalt */}
      {[[-110, 0.03, 0], [110, 0.03, 0]].map((pos, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={pos as any} receiveShadow>
          <planeGeometry args={[20, 180]} />
          <primitive object={MATERIALS.asphalt()} attach="material" />
        </mesh>
      ))}

      {/* White dashed lane markings */}
      {[-110, 110].map((x, ai) =>
        Array.from({ length: 12 }, (_, j) => (
          <mesh key={`dash${ai}${j}`} rotation-x={-Math.PI / 2}
            position={[x, 0.04, -55 + j * 10]} receiveShadow>
            <planeGeometry args={[0.08, 3.5]} />
            <primitive object={MATERIALS.laneMarkingWhite()} attach="material" />
          </mesh>
        ))
      )}

      {/* Teal directional arrows */}
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
            <meshPhysicalMaterial
              color="#00D4AA"
              emissive="#00D4AA"
              emissiveIntensity={0.3}
              roughness={0.5}
              metalness={0}
              side={2}
              toneMapped={false}
            />
          </mesh>
        ))
      )}

      {/* Entry/Exit gates — emissive strips only, NO pointLights */}
      {[
        { x: -110, z: -95, col: '#00D4AA', label: 'ENTRY' },
        { x: 110, z: -95, col: '#C00000', label: 'EXIT' },
      ].map((gate, i) => (
        <group key={i} position={[gate.x, 0, gate.z]}>
          {[-4, 4].map((px, j) => (
            <mesh key={j} position={[px, 2, 0]} castShadow>
              <boxGeometry args={[0.5, 4, 0.5]} />
              <primitive object={MATERIALS.structuralSteel()} attach="material" />
            </mesh>
          ))}
          <mesh position={[0, 3.8, 0]}>
            <boxGeometry args={[8.5, 0.15, 0.15]} />
            <primitive object={MATERIALS.brushedAluminum()} attach="material" />
          </mesh>
          <mesh position={[0, 3.8, 0.1]}>
            <boxGeometry args={[8.5, 0.08, 0.02]} />
            <meshPhysicalMaterial
              color={gate.col}
              emissive={gate.col}
              emissiveIntensity={1.5}
              roughness={0.3}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
