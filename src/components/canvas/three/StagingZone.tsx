import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { MATERIALS } from './materials';

interface SpaceRow {
  origin: [number, number, number];
  rotation: number; // Y-axis rotation for the whole row
  count: number;
  spacing: number;
  direction: 'x' | 'z'; // which axis spaces are laid out along
}

export function StagingZone({ count = 50 }: { count?: number }) {
  const rows = useMemo<SpaceRow[]>(() => {
    // Distribute count proportionally: 40% left, 40% right, 20% front
    const left = Math.round(count * 0.4);
    const right = Math.round(count * 0.4);
    const front = count - left - right;

    return [
      // Left side — along Z axis
      { origin: [-120, 0, -50], rotation: 0, count: left, spacing: 5.5, direction: 'z' },
      // Right side — along Z axis
      { origin: [120, 0, -50], rotation: Math.PI, count: right, spacing: 5.5, direction: 'z' },
      // Front/south edge — along X axis
      { origin: [-((front - 1) * 5.5) / 2, 0, 85], rotation: 0, count: front, spacing: 5.5, direction: 'x' },
    ];
  }, [count]);

  return (
    <group>
      {rows.map((row, ri) => (
        <group key={ri} position={row.origin} rotation-y={row.rotation}>
          {/* Shared asphalt pad for entire row */}
          {row.direction === 'z' ? (
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, (row.count - 1) * row.spacing / 2]} receiveShadow>
              <planeGeometry args={[5, row.count * row.spacing + 2]} />
              <primitive object={MATERIALS.asphalt()} attach="material" />
            </mesh>
          ) : (
            <mesh rotation-x={-Math.PI / 2} position={[(row.count - 1) * row.spacing / 2, 0.01, 0]} receiveShadow>
              <planeGeometry args={[row.count * row.spacing + 2, 5]} />
              <primitive object={MATERIALS.asphalt()} attach="material" />
            </mesh>
          )}

          {/* Individual parking spaces */}
          {Array.from({ length: row.count }, (_, i) => {
            const offset: [number, number, number] = row.direction === 'z'
              ? [0, 0, i * row.spacing]
              : [i * row.spacing, 0, 0];

            const globalIdx = ri === 0 ? i + 1
              : ri === 1 ? rows[0].count + i + 1
              : rows[0].count + rows[1].count + i + 1;

            return (
              <group key={i} position={offset}>
                {/* White lane marking — left line */}
                <mesh rotation-x={-Math.PI / 2} position={row.direction === 'z' ? [-2, 0.02, 0] : [0, 0.02, -2]}>
                  <planeGeometry args={row.direction === 'z' ? [0.08, 4.5] : [4.5, 0.08]} />
                  <primitive object={MATERIALS.laneMarkingWhite()} attach="material" />
                </mesh>
                {/* White lane marking — right line */}
                <mesh rotation-x={-Math.PI / 2} position={row.direction === 'z' ? [2, 0.02, 0] : [0, 0.02, 2]}>
                  <planeGeometry args={row.direction === 'z' ? [0.08, 4.5] : [4.5, 0.08]} />
                  <primitive object={MATERIALS.laneMarkingWhite()} attach="material" />
                </mesh>
                {/* Teal accent line at front of space */}
                <mesh rotation-x={-Math.PI / 2} position={row.direction === 'z' ? [0, 0.025, -2.2] : [-2.2, 0.025, 0]}>
                  <planeGeometry args={row.direction === 'z' ? [3.8, 0.12] : [0.12, 3.8]} />
                  <primitive object={MATERIALS.laneMarkingTeal()} attach="material" />
                </mesh>
                {/* Stall number label */}
                <Html
                  position={[0, 0.05, 0]}
                  center
                  style={{ pointerEvents: 'none' }}
                >
                  <span className="text-[6px] font-mono font-bold" style={{ color: 'rgba(0,212,170,0.45)' }}>
                    S{String(globalIdx).padStart(2, '0')}
                  </span>
                </Html>
              </group>
            );
          })}

          {/* Row label */}
          <Html
            position={
              row.direction === 'z'
                ? [0, 5, (row.count - 1) * row.spacing / 2]
                : [(row.count - 1) * row.spacing / 2, 5, 0]
            }
            center
          >
            <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
              STAGING / QUEUE
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}
