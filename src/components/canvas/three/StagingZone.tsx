import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { MATERIALS } from './materials';

interface StallPos {
  position: [number, number, number];
  direction: 'x' | 'z';
}

/**
 * Staging stalls arranged in a continuous U-shape around the depot perimeter.
 * Numbering goes chronologically 1→100:
 *   Segment 1 (west):  X=-130, Z from -60 south to +85  (stalls 1–26)
 *   Segment 2 (south): Z=+90,  X from -130 east to +130 (stalls 27–73)
 *   Segment 3 (east):  X=+130, Z from +85 north to -60  (stalls 74–100)
 */
export function StagingZone({ count = 100 }: { count?: number }) {
  const stalls = useMemo<StallPos[]>(() => {
    const SPACING = 5.5;

    // Segment lengths (in world units)
    const westLen = 85 - (-60);   // 145
    const southLen = 130 - (-130); // 260
    const eastLen = 85 - (-60);    // 145
    const totalLen = westLen + southLen + eastLen; // 550

    // Distribute stalls proportionally
    const westCount = Math.round(count * (westLen / totalLen));
    const eastCount = Math.round(count * (eastLen / totalLen));
    const southCount = count - westCount - eastCount;

    const result: StallPos[] = [];

    // Segment 1 — West side: X=-130, Z goes from -60 → +85 (south)
    const westSpacing = westLen / Math.max(westCount - 1, 1);
    for (let i = 0; i < westCount; i++) {
      const z = -60 + i * westSpacing;
      result.push({ position: [-130, 0, z], direction: 'z' });
    }

    // Segment 2 — South edge: Z=+90, X goes from -130 → +130 (east)
    const southSpacing = southLen / Math.max(southCount - 1, 1);
    for (let i = 0; i < southCount; i++) {
      const x = -130 + i * southSpacing;
      result.push({ position: [x, 0, 90], direction: 'x' });
    }

    // Segment 3 — East side: X=+130, Z goes from +85 → -60 (north)
    const eastSpacing = eastLen / Math.max(eastCount - 1, 1);
    for (let i = 0; i < eastCount; i++) {
      const z = 85 - i * eastSpacing;
      result.push({ position: [130, 0, z], direction: 'z' });
    }

    return result;
  }, [count]);

  return (
    <group>
      {stalls.map((stall, i) => {
        const globalIdx = i + 1;
        const d = stall.direction;
        return (
          <group key={i} position={stall.position}>
            {/* Asphalt pad */}
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} receiveShadow>
              <planeGeometry args={d === 'z' ? [5, 4.5] : [4.5, 5]} />
              <primitive object={MATERIALS.asphalt()} attach="material" />
            </mesh>
            {/* Left lane marking */}
            <mesh rotation-x={-Math.PI / 2} position={d === 'z' ? [-2, 0.02, 0] : [0, 0.02, -2]}>
              <planeGeometry args={d === 'z' ? [0.08, 4.5] : [4.5, 0.08]} />
              <primitive object={MATERIALS.laneMarkingWhite()} attach="material" />
            </mesh>
            {/* Right lane marking */}
            <mesh rotation-x={-Math.PI / 2} position={d === 'z' ? [2, 0.02, 0] : [0, 0.02, 2]}>
              <planeGeometry args={d === 'z' ? [0.08, 4.5] : [4.5, 0.08]} />
              <primitive object={MATERIALS.laneMarkingWhite()} attach="material" />
            </mesh>
            {/* Teal accent */}
            <mesh rotation-x={-Math.PI / 2} position={d === 'z' ? [0, 0.025, -2.2] : [-2.2, 0.025, 0]}>
              <planeGeometry args={d === 'z' ? [3.8, 0.12] : [0.12, 3.8]} />
              <primitive object={MATERIALS.laneMarkingTeal()} attach="material" />
            </mesh>
            {/* Stall number */}
            <Html position={[0, 0.05, 0]} center style={{ pointerEvents: 'none' }}>
              <span className="text-[6px] font-mono font-bold" style={{ color: 'rgba(0,212,170,0.45)' }}>
                S{String(globalIdx).padStart(2, '0')}
              </span>
            </Html>
          </group>
        );
      })}

      {/* Section labels */}
      <Html position={[-130, 5, 12]} center>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
          STAGING / QUEUE
        </span>
      </Html>
      <Html position={[0, 5, 90]} center>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
          STAGING / QUEUE
        </span>
      </Html>
      <Html position={[130, 5, 12]} center>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: 'rgba(0,212,170,0.6)' }}>
          STAGING / QUEUE
        </span>
      </Html>
    </group>
  );
}
