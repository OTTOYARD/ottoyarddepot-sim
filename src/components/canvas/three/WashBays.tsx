import { Html } from '@react-three/drei';
import { MATERIALS } from './materials';

export function WashBays({ count }: { count: number }) {
  return (
    <group position={[-110, 0, -80]}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} position={[i * 16, 0, 0]}>
          {/* Structure walls — dark cladding */}
          <mesh position={[0, 3, 0]} castShadow receiveShadow>
            <boxGeometry args={[14, 6, 10]} />
            <primitive object={MATERIALS.darkCladding()} attach="material" />
          </mesh>

          {/* Steel frame edges */}
          {[[-7, 3, 0], [7, 3, 0]].map(([x, y, z], j) => (
            <mesh key={`frame${j}`} position={[x, y, z]} castShadow>
              <boxGeometry args={[0.15, 6, 10.2]} />
              <primitive object={MATERIALS.structuralSteel()} attach="material" />
            </mesh>
          ))}

          {/* Entrance pillars */}
          {[-5.5, 5.5].map((x, j) => (
            <mesh key={`pil${j}`} position={[x, 1.5, 5.5]} castShadow>
              <boxGeometry args={[1, 3, 1]} />
              <primitive object={MATERIALS.brushedAluminum()} attach="material" />
            </mesh>
          ))}

          {/* Roll-up door frame */}
          <mesh position={[0, 5.5, 5.1]}>
            <boxGeometry args={[11, 0.3, 0.15]} />
            <primitive object={MATERIALS.brushedAluminum()} attach="material" />
          </mesh>

          {/* Interior opening */}
          <mesh position={[0, 1.5, 5.1]}>
            <planeGeometry args={[10, 3]} />
            <meshPhysicalMaterial color="#050508" roughness={0.9} metalness={0.1} envMapIntensity={0.1} />
          </mesh>

          {/* Wet concrete floor */}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow>
            <planeGeometry args={[13, 9]} />
            <primitive object={MATERIALS.polishedConcrete()} attach="material" />
          </mesh>

          {/* Teal LED strip along bay opening top */}
          <mesh position={[0, 5.8, 5.1]}>
            <boxGeometry args={[10.5, 0.04, 0.02]} />
            <primitive object={MATERIALS.tealLED(2.0)} attach="material" />
          </mesh>

          {/* Interior light — emissive mesh only, NO pointLight */}
          <mesh position={[0, 5.5, 0]}>
            <boxGeometry args={[1, 0.05, 0.3]} />
            <primitive object={MATERIALS.whiteLED(2.0)} attach="material" />
          </mesh>

          {/* Water drainage grate */}
          {Array.from({ length: 8 }, (_, g) => (
            <mesh key={`grate${g}`} rotation-x={-Math.PI / 2} position={[-3.5 + g * 1, 0.03, 5.5]}>
              <planeGeometry args={[0.15, 2]} />
              <meshPhysicalMaterial color="#444444" roughness={0.3} metalness={0.7} envMapIntensity={0.5} />
            </mesh>
          ))}
        </group>
      ))}
      <Html position={[((count - 1) * 16) / 2, 8, 0]} center>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
          WASH BAYS
        </span>
      </Html>
    </group>
  );
}
