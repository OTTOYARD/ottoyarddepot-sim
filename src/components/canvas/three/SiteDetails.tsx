import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { oilStainTexture } from './textures';
import { useDepotStore } from '@/store/depotStore';
import { BESS_YARD, INGRESS, EGRESS, LOT } from '@/lib/sitePlan';
import { bayBollards, BOLLARD_RADIUS } from '@/lib/structurePlan';
import { toWorld, DECK_Y } from './coordUtils';
import { hasWheelStop, wheelStopPose, WHEEL_STOP_SIZE } from './wheelStops';

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
  // Every stop lies ACROSS its stall, square to the car (wheelStops.ts, pinned by
  // wheelStops.test.ts): under the car's nose on the angled charger stalls, at the
  // stall head away from the aisle on the staging runs.
  const wheelStops = useMemo(() => {
    const parking = stalls.filter(hasWheelStop);
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(WHEEL_STOP_SIZE.length, WHEEL_STOP_SIZE.height, WHEEL_STOP_SIZE.depth),
      MATERIALS.curbing(), Math.max(1, parking.length),
    );
    const d = new THREE.Object3D();
    parking.forEach((s, i) => {
      const { x, y, rotY } = wheelStopPose(s);
      const [wx, , wz] = toWorld({ x, y }, 0);
      d.position.set(wx, DECK_Y + 0.1, wz); // 0.33u (15 cm) standing proud of the deck, not half-buried in it
      d.rotation.set(0, rotY, 0);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, [stalls]);

  // ---- instanced bollards ----
  // Yellow bollards guard each bay door's outer corners, front and rear, from
  // structurePlan.bayBollards() — the same points the replay clearance test
  // drives every recorded car against. The orange "canopy leg" pylons that used
  // to live here stood at cx±12, i.e. in the sidestep path of the DCFC column:
  // they guarded no leg (the canopy is a central-spine structure) and cars drove
  // through them. Canopy columns now carry their own hazard-banded plinths.
  const bollardSets = useMemo(() => {
    const pts = [...bayBollards(), { x: BESS_YARD.x + BESS_YARD.w + 2, y: BESS_YARD.y + BESS_YARD.h + 2 }];
    const inst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(BOLLARD_RADIUS, BOLLARD_RADIUS, 2.6, 12), MATERIALS.safetyYellow(), pts.length,
    );
    const d = new THREE.Object3D();
    pts.forEach((p, i) => {
      const [wx, , wz] = toWorld(p, 0);
      d.position.set(wx, 1.3, wz);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    return [inst];
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

  // ---- planted islands ----
  // FLOW AUDIT: the canopy gaps are PULL-OUT LANES — nothing lives in them.
  // Islands sit only where no vehicle path runs: the forecourt east cap
  // (x>220, off the bay frontage), and two south-fence pads clear of the
  // queue row and gate throats.
  // Relocated out of the NE overflow zone: tucked against the east fence,
  // north of the parking column, clear of the east aisle and apron swing.
  const islands = useMemo(() => ([
    { x: 286, y: 33, w: 9, d: 11, n: 4 },
  ]).map((r, k) => {
    const [wx, , wz] = toWorld({ x: r.x, y: r.y }, 0);
    const shrubs = Array.from({ length: r.n }, (_, i) => ({
      px: (seeded(k * 11 + i) - 0.5) * (r.w - 3),
      pz: (seeded(k * 17 + i) - 0.5) * (r.d - 3),
      s: 0.9 + seeded(k * 23 + i) * 1.2,
    }));
    return { ...r, wx, wz, shrubs, key: k };
  }), []);

  const [inWx, , inWz] = toWorld({ x: INGRESS.x, y: LOT.y + LOT.h }, 0);
  const [egWx, , egWz] = toWorld({ x: EGRESS.x, y: LOT.y + LOT.h }, 0);

  return (
    <group>
      <primitive object={wheelStops} />
      <primitive object={bollardSets[0]} />

      {/* oil stains */}
      {stains.map((s) => (
        <mesh key={s.id} rotation={[-Math.PI / 2, 0, s.rot]} position={[s.wx, DECK_Y + 0.012, s.wz]}>
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
      {/* concrete forecourt strip — the full bay approach throat (y 56..68) */}
      <mesh rotation-x={-Math.PI / 2} position={[-8, DECK_Y + 0.006, 48]} material={mats.concrete} receiveShadow>
        <planeGeometry args={[156, 12]} />
      </mesh>
      {/* concrete rear apron — 30ft clear maneuvering zone behind the bays */}
      <mesh rotation-x={-Math.PI / 2} position={[15, DECK_Y + 0.006, 94]} material={mats.concrete} receiveShadow>
        <planeGeometry args={[258, 20]} />
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

      {/* security cameras on the gate posts */}
      {[[inWx - 7, inWz], [egWx + 7, egWz]].map(([x, z], i) => (
        <group key={`cam${i}`} position={[x, 6.4, z]}>
          <mesh material={mats.steel}><boxGeometry args={[0.18, 1.1, 0.18]} /></mesh>
          <mesh position={[0, 0.62, 0.45]} rotation={[0.5, i === 0 ? 0.4 : -0.4, 0]} material={mats.dark}>
            <boxGeometry args={[0.5, 0.42, 1.1]} />
          </mesh>
        </group>
      ))}

    </group>
  );
}
