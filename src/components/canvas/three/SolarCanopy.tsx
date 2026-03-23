import { useSimulationStore } from '@/store/simulationStore';
import { toWorld } from './coordUtils';

export function SolarCanopy() {
  const simTime = useSimulationStore((s) => s.simTime);
  const isDaytime = simTime >= 21600 && simTime < 64800;

  const [cx, , cz] = toWorld({ x: 150, y: 195 }, 0);
  const canopyHeight = 6;

  return (
    <group>
      {/* Canopy panel */}
      <mesh position={[cx, canopyHeight, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[300, 10]} />
        <meshStandardMaterial
          color="#2D5A2D"
          opacity={isDaytime ? 0.5 : 0.3}
          transparent
          side={2}
          emissive={isDaytime ? '#2D5A2D' : '#000000'}
          emissiveIntensity={isDaytime ? 0.2 : 0}
        />
      </mesh>

      {/* Support poles */}
      {[-130, -60, 0, 60, 130].map((xOff) => (
        <mesh key={`pole-${xOff}`} position={[xOff, canopyHeight / 2, cz]}>
          <cylinderGeometry args={[0.3, 0.3, canopyHeight, 6]} />
          <meshStandardMaterial color="#555555" metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
