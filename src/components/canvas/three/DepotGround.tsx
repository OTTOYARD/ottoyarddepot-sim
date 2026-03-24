import { useMemo } from 'react';
import { MATERIALS } from './materials';

export function DepotGround() {
  const mats = useMemo(() => ({
    grass: MATERIALS.grass(),
    asphalt: MATERIALS.asphalt(),
    concrete: MATERIALS.polishedConcrete(),
    epoxy: MATERIALS.epoxyFloor(),
    curb: MATERIALS.curbing(),
    gravel: MATERIALS.gravel(),
    whiteLine: MATERIALS.laneMarkingWhite(),
    tealLine: MATERIALS.laneMarkingTeal(),
  }), []);

  return (
    <group>
      {/* Outer grass */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <primitive object={mats.grass} attach="material" />
      </mesh>

      {/* Full asphalt pad */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[300, 220]} />
        <primitive object={mats.asphalt} attach="material" />
      </mesh>

      {/* Polished concrete depot floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 10]} receiveShadow>
        <planeGeometry args={[220, 140]} />
        <primitive object={mats.concrete} attach="material" />
      </mesh>

      {/* Epoxy floor strips at charging bays */}
      {Array.from({ length: 20 }, (_, i) => (
        <mesh key={`epoxy${i}`} rotation-x={-Math.PI / 2}
          position={[-95 + i * 10, 0.02, 20]} receiveShadow>
          <planeGeometry args={[3.2, 6]} />
          <primitive object={mats.epoxy} attach="material" />
        </mesh>
      ))}

      {/* Gravel border strips */}
      {[-145, 145].map((x, i) => (
        <mesh key={`gv${i}`} rotation-x={-Math.PI / 2} position={[x, 0.005, 0]} receiveShadow>
          <planeGeometry args={[10, 220]} />
          <primitive object={mats.gravel} attach="material" />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, -105]} receiveShadow>
        <planeGeometry args={[300, 10]} />
        <primitive object={mats.gravel} attach="material" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 105]} receiveShadow>
        <planeGeometry args={[300, 10]} />
        <primitive object={mats.gravel} attach="material" />
      </mesh>

      {/* Concrete curbing — 3D boxes */}
      {[-140, 140].map((x, i) => (
        <mesh key={`curbV${i}`} position={[x, 0.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.2, 220]} />
          <primitive object={mats.curb} attach="material" />
        </mesh>
      ))}
      <mesh position={[0, 0.1, -100]} castShadow receiveShadow>
        <boxGeometry args={[280, 0.2, 0.3]} />
        <primitive object={mats.curb} attach="material" />
      </mesh>
      <mesh position={[0, 0.1, 100]} castShadow receiveShadow>
        <boxGeometry args={[280, 0.2, 0.3]} />
        <primitive object={mats.curb} attach="material" />
      </mesh>

      {/* White lane marking lines between stalls */}
      {Array.from({ length: 21 }, (_, i) => (
        <mesh key={`wl${i}`} rotation-x={-Math.PI / 2}
          position={[-100 + i * 10, 0.025, 20]} receiveShadow>
          <planeGeometry args={[0.08, 6]} />
          <primitive object={mats.whiteLine} attach="material" />
        </mesh>
      ))}

      {/* Teal center-line stripe */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]} receiveShadow>
        <planeGeometry args={[220, 0.15]} />
        <primitive object={mats.tealLine} attach="material" />
      </mesh>

      {/* Expansion joints on concrete */}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={`ej${i}`} rotation-x={-Math.PI / 2} position={[-100 + i * 20, 0.015, 10]}>
          <planeGeometry args={[0.08, 140]} />
          <meshPhysicalMaterial color="#2a2a30" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}
