import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { MATERIALS } from './materials';

interface SpaceRow {
  origin: [number, number, number];
  rotation: number;
  count: number;
  spacing: number;
  direction: 'x' | 'z';
}

/**
 * Staging stalls wrap around the depot perimeter EXCEPT near the
 * building/lounge area (north side, roughly X ∈ [-60, 60]).
 *
 * Layout (top-down, Z+ = north in 3D):
 *   - Left (west) edge:  along Z axis at X ≈ -120
 *   - Right (east) edge: along Z axis at X ≈ +120
 *   - Front (south):     along X axis at Z ≈ +85
 *   - Back-left wing:    along Z axis at X ≈ -80 (north, avoiding building)
 *   - Back-right wing:   along Z axis at X ≈ +80 (north, avoiding building)
 */
export function StagingZone({ count = 100 }: { count?: number }) {
  const rows = useMemo<SpaceRow[]>(() => {
    // Distribute proportionally: 25% left, 25% right, 15% front, 20% back-left, 15% back-right
    const left = Math.round(count * 0.25);
    const right = Math.round(count * 0.25);
    const front = Math.round(count * 0.15);
    const backLeft = Math.round(count * 0.20);
    const backRight = count - left - right - front - backLeft;

    return [
      // Left/west side — along Z axis
      { origin: [-120, 0, -50], rotation: 0, count: left, spacing: 5.5, direction: 'z' as const },
      // Right/east side — along Z axis
      { origin: [120, 0, -50], rotation: Math.PI, count: right, spacing: 5.5, direction: 'z' as const },
      // Front/south edge — along X axis
      { origin: [-((front - 1) * 5.5) / 2, 0, 85], rotation: 0, count: front, spacing: 5.5, direction: 'x' as const },
      // Back-left wing (north-west, avoids building) — along Z axis
      { origin: [-85, 0, -75], rotation: 0, count: backLeft, spacing: 5.5, direction: 'z' as const },
      // Back-right wing (north-east, avoids building) — along Z axis
      { origin: [85, 0, -75], rotation: Math.PI, count: backRight, spacing: 5.5, direction: 'z' as const },
    ];
  }, [count]);

  let runningIdx = 0;

  return (
    <group>
      {rows.map((row, ri) => {
        const startIdx = runningIdx;
        runningIdx += row.count;

        return (
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

              const globalIdx = startIdx + i + 1;

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
                  <Html position={[0, 0.05, 0]} center style={{ pointerEvents: 'none' }}>
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
        );
      })}
    </group>
  );
}
