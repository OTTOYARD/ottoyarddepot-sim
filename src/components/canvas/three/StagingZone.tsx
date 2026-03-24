import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { MATERIALS } from './materials';

export function StagingZone({ count }: { count: number }) {
  return (
    <group position={[-80, 0, 60]}>
      {/* Epoxy pad under staging area */}
      <mesh rotation-x={-Math.PI / 2} position={[((count - 1) * 5) / 2, 0.015, 0]} receiveShadow>
        <planeGeometry args={[count * 5 + 2, 8]} />
        <meshPhysicalMaterial {...MATERIALS.epoxyFloor()} />
      </mesh>

      {Array.from({ length: count }, (_, i) => (
        <group key={i} position={[i * 5, 0, 0]}>
          {/* Glowing ring */}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.016, 0]}>
            <torusGeometry args={[1.5, 0.06, 8, 32]} />
            <meshPhysicalMaterial
              color="#00D4AA"
              emissive={new THREE.Color('#00D4AA')}
              emissiveIntensity={0.8}
              roughness={0.5}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
          {/* Center dot */}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.017, 0]}>
            <circleGeometry args={[0.3, 16]} />
            <meshPhysicalMaterial
              color="#00D4AA"
              emissive={new THREE.Color('#00D4AA')}
              emissiveIntensity={1.2}
              roughness={0.5}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* Teal label strip across front */}
      <mesh rotation-x={-Math.PI / 2} position={[((count - 1) * 5) / 2, 0.02, 4.5]}>
        <planeGeometry args={[count * 5, 0.1]} />
        <meshPhysicalMaterial {...MATERIALS.laneMarkingTeal()} />
      </mesh>

      <Html position={[((count - 1) * 5) / 2, 4, 0]} center>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
          STAGING / QUEUE
        </span>
      </Html>
    </group>
  );
}
