import { useDepotStore } from '@/store/depotStore';
import { toWorld } from './coordUtils';

export function StagingZone() {
  const stalls = useDepotStore((s) => s.stalls);
  const stagingStalls = stalls.filter((s) => s.type === 'staging');

  return (
    <group>
      {stagingStalls.map((stall) => {
        const [x, , z] = toWorld(stall.position);
        const isOccupied = stall.status !== 'available';

        return (
          <group key={stall.id} position={[x, 0.02, z]}>
            {/* Parking space marking */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[4, 6]} />
              <meshStandardMaterial
                color="#F59E0B"
                opacity={isOccupied ? 0.3 : 0.12}
                transparent
              />
            </mesh>
            {/* Border lines */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
              <ringGeometry args={[2.8, 3, 4]} />
              <meshStandardMaterial color="#F59E0B" opacity={0.2} transparent />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
