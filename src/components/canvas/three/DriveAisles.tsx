import { toWorld } from './coordUtils';

export function DriveAisles() {
  // Left aisle: 2D x=20-40, y=40-200
  const [lx, , lz] = toWorld({ x: 30, y: 120 }, 0);
  // Right aisle: 2D x=265-285, y=40-200
  const [rx, , rz] = toWorld({ x: 275, y: 120 }, 0);

  return (
    <group>
      {/* Left aisle */}
      <mesh position={[lx, 0.02, lz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 160]} />
        <meshStandardMaterial color="#333333" opacity={0.5} transparent />
      </mesh>

      {/* Right aisle */}
      <mesh position={[rx, 0.02, rz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 160]} />
        <meshStandardMaterial color="#333333" opacity={0.5} transparent />
      </mesh>

      {/* Direction arrows - left aisle (down/south) */}
      {[60, 100, 140, 180].map((y2d) => {
        const [ax, , az] = toWorld({ x: 30, y: y2d }, 0);
        return (
          <mesh key={`al-${y2d}`} position={[ax, 0.1, az]} rotation={[-Math.PI / 2, 0, Math.PI]}>
            <coneGeometry args={[1.5, 3, 3]} />
            <meshStandardMaterial color="#ffffff" opacity={0.1} transparent />
          </mesh>
        );
      })}

      {/* Direction arrows - right aisle (up/north) */}
      {[60, 100, 140, 180].map((y2d) => {
        const [ax, , az] = toWorld({ x: 275, y: y2d }, 0);
        return (
          <mesh key={`ar-${y2d}`} position={[ax, 0.1, az]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[1.5, 3, 3]} />
            <meshStandardMaterial color="#ffffff" opacity={0.1} transparent />
          </mesh>
        );
      })}
    </group>
  );
}
