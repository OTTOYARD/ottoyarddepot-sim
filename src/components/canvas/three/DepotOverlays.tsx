import { Html } from '@react-three/drei';
import { toWorld } from './coordUtils';

interface ZoneLabel {
  text: string;
  pos2d: { x: number; y: number };
  color: string;
}

const labels: ZoneLabel[] = [
  { text: 'DCFC CHARGING', pos2d: { x: 140, y: 50 }, color: '#C00000' },
  { text: 'L2 CHARGING', pos2d: { x: 150, y: 80 }, color: '#00B4A6' },
  { text: 'STAGING', pos2d: { x: 150, y: 167 }, color: '#F59E0B' },
  { text: 'WASH', pos2d: { x: 215, y: 28 }, color: '#2196F3' },
  { text: 'OPERATIONS', pos2d: { x: 120, y: 3 }, color: '#ffffff' },
];

export function DepotOverlays() {
  // Zone boundary for L2 area: 2D (40,75) to (260,155)
  const [bx, , bz] = toWorld({ x: 150, y: 115 }, 0);

  return (
    <group>
      {/* Zone boundary outline */}
      <mesh position={[bx, 0.05, bz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[220, 80]} />
        <meshStandardMaterial color="#00B4A6" opacity={0.03} transparent />
      </mesh>

      {/* Zone labels */}
      {labels.map((label) => {
        const [lx, , lz] = toWorld(label.pos2d);
        return (
          <Html key={label.text} position={[lx, 5, lz]} center>
            <span
              className="text-[10px] font-bold tracking-widest"
              style={{ color: label.color, opacity: 0.6 }}
            >
              {label.text}
            </span>
          </Html>
        );
      })}
    </group>
  );
}
