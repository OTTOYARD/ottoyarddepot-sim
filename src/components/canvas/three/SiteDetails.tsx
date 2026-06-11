import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { oilStainTexture } from './textures';
import { useDepotStore } from '@/store/depotStore';
import { BUILDING, WASH, BESS_YARD, CANOPIES, INGRESS, EGRESS, LOT } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * Site dressing layer — the small real-world details that sell the scene:
 * wheel stops, safety bollards, oil staining, gate crosswalks, planted
 * islands, rooftop HVAC, security cameras, glass mullions, wall-pack lights,
 * concrete aprons. All positions derive from the site plan / stall store.
 */

function seeded(n: number) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

export function SiteDetails() {
  const stalls = useDepotStore((s) => s.stalls);

  const mats = useMemo(() => ({
    concrete: MATERIALS.polishedConcrete(),
    curb: MATERIALS.curbing(),
    yellow: MATERIALS.safetyYellow(),
    steel: MATERIALS.structuralSteel(),
    dark: MATERIALS.darkCladding(),
    white: MATERIALS.laneMarkingWhite(),
    grass: MATERIALS.grass(),
    shrub: MATERIALS.shrubGreen(),
    led: MATERIALS.whiteLED(1.2),
  }), []);

  // ---- instanced wheel stops at every parking stall ----
  const wheelStops = useMemo(() => {
    const parking = stalls.filter((s) => s.type === 'staging');
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.6, 0.45, 0.7), MATERIALS.curbing(), Math.max(1, parking.length),
    );
    const d = new THREE.Object3D();
    parking.forEach((s, i) => {
      const across = s.position.angle === 90;
      // stop sits at the fence-side end of the stall
      const offX = across ? (s.position.x < 150 ? -3.4 : 3.4) : 0;
      const offY = across ? 0 : (s.position.y < 110 ? -3.4 : 3.4);
      const [wx, , wz] = toWorld({ x: s.position.x + offX, y: s.position.y + offY }, 0);
      d.position.set(wx, 0.25, wz);
      d.rotation.set(0, across ? 0 : Math.PI / 2, 0);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, [stalls]);

  // ---- instanced bollards: canopy lane ends, bay door flanks, BESS gate ----
  const bollards = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    for (const c of CANOPIES) {
      for (const side of [-7, 7]) {
        pts.push({ x: c.cx + side, y: c.y - 3 });
        pts.push({ x: c.cx + side, y: c.y + c.h + 3 });
      }
    }
    for (const dx of [120, 138]) { pts.push({ x: dx - 7.5, y: 48.5 }); pts.push({ x: dx + 7.5, y: 48.5 }); }
    for (const dx of [168, 186, 204]) { pts.push({ x: dx - 7, y: 48.5 }); pts.push({ x: dx + 7, y: 48.5 }); }
    pts.push({ x: BESS_YARD.x + BESS_YARD.w + 2, y: BESS_YARD.y + BESS_YARD.h + 2 });
    const inst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.42, 0.42, 2.6, 10), MATERIALS.safetyYellow(), pts.length,
    );
    const d = new THREE.Object3D();
    pts.forEach((p, i) => {
      const [wx, , wz] = toWorld(p, 0);
      d.position.set(wx, 1.3, wz);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, []);

  // ---- oil stains under ~30% of charging stalls ----
  const stains = useMemo(() => {
    const charge = stalls.filter((s) => s.type === 'dcfc' || s.type === 'l2');
    return charge.filter((_, i) => seeded(i * 3 + 1) < 0.3).map((s, i) => {
      const [wx, , wz] = toWorld({ x: s.position.x, y: s.position.y }, 0);
      return { id: s.id, wx, wz, r: 2.2 + seeded(i) * 2.2, rot: seeded(i * 7) * Math.PI };
    });
  }, [stalls]);
  const stainTex = useMemo(() => oilStainTexture(), []);

  // ---- gate crosswalks ----
  const crosswalks = useMemo(() => {
    const bars: { wx: number; wz: number }[] = [];
    for (const gate of [INGRESS.x, EGRESS.x]) {
      for (let i = -3; i <= 3; i++) {
        const [wx, , wz] = toWorld({ x: gate + i * 2.1, y: LOT.y + LOT.h + 3.5 }, 0);
        bars.push({ wx, wz });
      }
    }
    return bars;
  }, []);

  // ---- planted islands (curb + grass + shrubs) ----
  const islands = useMemo(() => ([
    { x: 60, y: 188, w: 22, d: 7 },
    { x: 150, y: 62, w: 18, d: 6 },
    { x: 240, y: 188, w: 22, d: 7 },
    { x: 76, y: 52, w: 14, d: 6 },
    { x: 224, y: 52, w: 14, d: 6 },
  ]).map((r, k) => {
    const [wx, , wz] = toWorld({ x: r.x, y: r.y }, 0);
    const shrubs = Array.from({ length: 5 }, (_, i) => ({
      px: (seeded(k * 11 + i) - 0.5) * (r.w - 4),
      pz: (seeded(k * 17 + i) - 0.5) * (r.d - 3),
      s: 0.9 + seeded(k * 23 + i) * 1.3,
    }));
    return { ...r, wx, wz, shrubs, key: k };
  }), []);

  // ---- rooftop HVAC ----
  const hvac = useMemo(() => {
    const units: { wx: number; wz: number; w: number; d: number; h: number; top: number }[] = [];
    const bld = (r: { x: number; y: number; w: number; h: number }, top: number, n: number, seed: number) => {
      for (let i = 0; i < n; i++) {
        const [wx, , wz] = toWorld({
          x: r.x + 8 + seeded(seed + i) * (r.w - 16),
          y: r.y + 8 + seeded(seed + i + 5) * (r.h - 16),
        }, 0);
        units.push({ wx, wz, w: 4 + seeded(seed + i) * 3, d: 3.4, h: 2.2, top });
      }
    };
    bld(BUILDING, 13, 3, 3);
    bld(WASH, 10, 2, 9);
    return units;
  }, []);

  const [inWx, , inWz] = toWorld({ x: INGRESS.x, y: LOT.y + LOT.h }, 0);
  const [egWx, , egWz] = toWorld({ x: EGRESS.x, y: LOT.y + LOT.h }, 0);
  const [bWx, , bWz] = toWorld({ x: BUILDING.x + BUILDING.w / 2, y: BUILDING.y + BUILDING.h / 2 }, 0);

  return (
    <group>
      <primitive object={wheelStops} />
      <primitive object={bollards} />

      {/* oil stains */}
      {stains.map((s) => (
        <mesh key={s.id} rotation={[-Math.PI / 2, 0, s.rot]} position={[s.wx, 0.045, s.wz]}>
          <planeGeometry args={[s.r * 2, s.r * 1.5]} />
          <meshBasicMaterial map={stainTex} transparent depthWrite={false} opacity={0.85} />
        </mesh>
      ))}

      {/* gate crosswalk bars */}
      {crosswalks.map((b, i) => (
        <mesh key={`cw${i}`} rotation-x={-Math.PI / 2} position={[b.wx, 0.04, b.wz]} material={mats.white}>
          <planeGeometry args={[1.2, 5]} />
        </mesh>
      ))}

      {/* concrete gate aprons */}
      {[[inWx, inWz], [egWx, egWz]].map(([x, z], i) => (
        <mesh key={`apron${i}`} rotation-x={-Math.PI / 2} position={[x, 0.035, z]} material={mats.concrete} receiveShadow>
          <planeGeometry args={[16, 14]} />
        </mesh>
      ))}
      {/* bay forecourt apron (service + wash frontage) */}
      <mesh rotation-x={-Math.PI / 2} position={[bWx + 32, 0.035, bWz - 21]} material={mats.concrete} receiveShadow>
        <planeGeometry args={[110, 12]} />
      </mesh>

      {/* planted islands */}
      {islands.map((r) => (
        <group key={`isl${r.key}`} position={[r.wx, 0, r.wz]}>
          <mesh position={[0, 0.35, 0]} material={mats.curb} castShadow receiveShadow>
            <boxGeometry args={[r.w, 0.7, r.d]} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.72, 0]} material={mats.grass}>
            <planeGeometry args={[r.w - 1.2, r.d - 1.2]} />
          </mesh>
          {r.shrubs.map((s, i) => (
            <mesh key={i} position={[s.px, 0.7 + s.s * 0.45, s.pz]} castShadow material={mats.shrub}>
              <sphereGeometry args={[s.s * 0.55, 8, 6]} />
            </mesh>
          ))}
        </group>
      ))}

      {/* rooftop HVAC */}
      {hvac.map((u, i) => (
        <group key={`hv${i}`} position={[u.wx, u.top + u.h / 2, u.wz]}>
          <mesh castShadow material={mats.steel}>
            <boxGeometry args={[u.w, u.h, u.d]} />
          </mesh>
          <mesh position={[0, u.h / 2 + 0.04, 0]} material={mats.dark}>
            <boxGeometry args={[u.w - 0.6, 0.08, u.d - 0.6]} />
          </mesh>
        </group>
      ))}

      {/* security cameras on the gate posts */}
      {[[inWx - 7, inWz], [egWx + 7, egWz]].map(([x, z], i) => (
        <group key={`cam${i}`} position={[x, 6.4, z]}>
          <mesh material={mats.steel}><boxGeometry args={[0.18, 1.1, 0.18]} /></mesh>
          <mesh position={[0, 0.62, 0.45]} rotation={[0.5, i === 0 ? 0.4 : -0.4, 0]} material={mats.dark}>
            <boxGeometry args={[0.5, 0.42, 1.1]} />
          </mesh>
        </group>
      ))}

      {/* office glass mullions + wall packs over bay doors */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={`mul${i}`} position={[bWx - 36 + i * 4.6, 4.6, bWz - 15.2]} material={mats.steel}>
          <boxGeometry args={[0.16, 8.2, 0.16]} />
        </mesh>
      ))}
      {[120, 138, 168, 186, 204].map((dx) => {
        const [wx, , wz] = toWorld({ x: dx, y: 46 }, 0); // south face of the bay row
        const h = dx < 160 ? 11.2 : 8.6;                 // building vs wash parapet heights
        return (
          <mesh key={`wp${dx}`} position={[wx, h, wz - 0.4]} material={mats.led}>
            <boxGeometry args={[1.6, 0.35, 0.5]} />
          </mesh>
        );
      })}
    </group>
  );
}
