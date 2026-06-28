import { useMemo } from 'react';
import { MATERIALS } from './materials';
import { CANOPIES } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * The three central charging canopies (site plan: A=DCFC, B/C=L2).
 * CENTRAL-SPINE BUTTERFLY: a single row of columns down the center carries a
 * ridge girder; the roof cantilevers out as two PV slopes that peak at the
 * ridge and fall to the eaves — so AVs pull in/out from both sides with
 * nothing in their path. Mirrors unreal/ottoq_ue_build.py.
 * `solarKWdc` kept for API compatibility (scales the under-canopy LED).
 */
export function SolarCanopy({ solarKWdc }: { solarKWdc: number }) {
  const R = 13;     // ridge (center) height, logical units
  const E = 10.5;   // eave (outer) height

  const mats = useMemo(() => ({
    steel: MATERIALS.structuralSteel(),
    pv: MATERIALS.solarPanelGlass(),
  }), []);

  const canopies = useMemo(() => CANOPIES.map((c) => {
    const [cx, , cz] = toWorld({ x: c.cx, y: c.y + c.h / 2 }, 0);
    const half = c.w / 2;
    const theta = Math.atan2(R - E, half);
    const colZ: number[] = [];
    for (let z = -c.h / 2 + 6; z <= c.h / 2 - 6; z += 19) colZ.push(z);
    return { id: c.id, cx, cz, w: c.w, h: c.h, half, theta, colZ };
  }), []);

  return (
    <group>
      {canopies.map((c) => (
        <group key={c.id} position={[c.cx, 0, c.cz]}>
          {/* central column spine — single row at x=0 */}
          {c.colZ.map((z, i) => (
            <mesh key={i} position={[0, R / 2, z]} castShadow material={mats.steel}>
              <boxGeometry args={[1.5, R, 1.5]} />
            </mesh>
          ))}
          {/* ridge girder along the spine */}
          <mesh position={[0, R - 0.4, 0]} castShadow material={mats.steel}>
            <boxGeometry args={[1.8, 0.9, c.h]} />
          </mesh>
          {/* two tilted PV roof slopes (inner edge high at ridge, outer low at eave) */}
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[(side * c.half) / 2, (R + E) / 2, 0]}
              rotation={[0, 0, -side * c.theta]}
              castShadow
              material={mats.pv}
            >
              <boxGeometry args={[c.half + 1.5, 0.5, c.h + 1.5]} />
            </mesh>
          ))}
          {/* under-canopy LED strip */}
          <mesh position={[0, E - 0.4, 0]}>
            <boxGeometry args={[c.w - 4, 0.06, 0.3]} />
            <primitive object={MATERIALS.whiteLED(Math.min(2.5, 1 + solarKWdc / 600))} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
