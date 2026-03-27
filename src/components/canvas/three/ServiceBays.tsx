import { Html } from '@react-three/drei';
import { MATERIALS } from './materials';

export function ServiceBays() {
  const bays = [
    { x: 35, label: 'BAY 1' },
    { x: 55, label: 'BAY 2' },
  ];

  return (
    <group position={[0, 0, -80]}>
      {bays.map((bay, i) => (
        <group key={i} position={[bay.x, 0, 0]}>
          {/* Structure walls — dark cladding, attached to building */}
          <mesh position={[0, 3, -3]} castShadow receiveShadow>
            <boxGeometry args={[14, 6, 12]} />
            <primitive object={MATERIALS.darkCladding()} attach="material" />
          </mesh>

          {/* Steel frame edges */}
          {[[-7, 3, -3], [7, 3, -3]].map(([x, y, z], j) => (
            <mesh key={`frame${j}`} position={[x, y, z]} castShadow>
              <boxGeometry args={[0.15, 6, 12.2]} />
              <primitive object={MATERIALS.structuralSteel()} attach="material" />
            </mesh>
          ))}

          {/* Entrance pillars */}
          {[-5.5, 5.5].map((x, j) => (
            <mesh key={`pil${j}`} position={[x, 1.5, 3.5]} castShadow>
              <boxGeometry args={[1, 3, 1]} />
              <primitive object={MATERIALS.brushedAluminum()} attach="material" />
            </mesh>
          ))}

          {/* Roll-up door frame — top bar */}
          <mesh position={[0, 5.5, 3.1]}>
            <boxGeometry args={[11, 0.3, 0.15]} />
            <primitive object={MATERIALS.brushedAluminum()} attach="material" />
          </mesh>

          {/* Interior dark opening */}
          <mesh position={[0, 1.5, 3.1]}>
            <planeGeometry args={[10, 3]} />
            <meshPhysicalMaterial color="#050508" roughness={0.9} metalness={0.1} envMapIntensity={0.1} />
          </mesh>

          {/* Concrete floor pad */}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow>
            <planeGeometry args={[13, 11]} />
            <primitive object={MATERIALS.polishedConcrete()} attach="material" />
          </mesh>

          {/* Teal LED strip above door */}
          <mesh position={[0, 5.8, 3.1]}>
            <boxGeometry args={[10.5, 0.04, 0.02]} />
            <primitive object={MATERIALS.tealLED(2.0)} attach="material" />
          </mesh>

          {/* Interior light — emissive mesh */}
          <mesh position={[0, 5.5, -2]}>
            <boxGeometry args={[1.5, 0.05, 0.3]} />
            <primitive object={MATERIALS.whiteLED(2.0)} attach="material" />
          </mesh>

          {/* Bay label */}
          <Html position={[0, 7, 3]} center>
            <span className="text-[8px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
              {bay.label}
            </span>
          </Html>
        </group>
      ))}

      {/* Overall label */}
      <Html position={[45, 9, 3]} center>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
          SERVICE / MAINTENANCE
        </span>
      </Html>
    </group>
  );
}
