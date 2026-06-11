import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { LOT, INGRESS, EGRESS, GATE_W } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * Ground plane, asphalt lot, perimeter security fence with ingress/egress
 * gates, public road, and entrance signage — all derived from the site plan.
 */

// logical rect → world center + size
function rectWorld(r: { x: number; y: number; w: number; h: number }) {
  const [cx, , cz] = toWorld({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, 0);
  return { cx, cz, w: r.w, d: r.h };
}

function FenceRun({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const mats = useMemo(() => ({ steel: MATERIALS.structuralSteel() }), []);
  const [wx1, , wz1] = toWorld({ x: x1, y: y1 }, 0);
  const [wx2, , wz2] = toWorld({ x: x2, y: y2 }, 0);
  const len = Math.hypot(wx2 - wx1, wz2 - wz1);
  const rotY = Math.atan2(wz2 - wz1, wx2 - wx1);
  const posts = useMemo(() => {
    const n = Math.max(2, Math.floor(len / 6));
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.22, 4.6, 0.22), MATERIALS.structuralSteel(), n + 1,
    );
    const d = new THREE.Object3D();
    for (let i = 0; i <= n; i++) {
      d.position.set(-len / 2 + (i * len) / n, 2.3, 0);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, [len]);

  return (
    <group position={[(wx1 + wx2) / 2, 0, (wz1 + wz2) / 2]} rotation={[0, -rotY, 0]}>
      <primitive object={posts} />
      <mesh position={[0, 4.4, 0]} material={mats.steel}>
        <boxGeometry args={[len, 0.18, 0.14]} />
      </mesh>
      <mesh position={[0, 1.1, 0]} material={mats.steel}>
        <boxGeometry args={[len, 0.14, 0.12]} />
      </mesh>
      {/* mesh infill */}
      <mesh position={[0, 2.7, 0]}>
        <boxGeometry args={[len, 3.2, 0.03]} />
        <meshPhysicalMaterial color="#15181d" roughness={0.8} metalness={0.6} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Gate({ x, label }: { x: number; label: 'IN' | 'OUT' }) {
  const yS = LOT.y + LOT.h; // south fence line
  const [wx, , wz] = toWorld({ x, y: yS }, 0);
  const mats = useMemo(() => ({
    steel: MATERIALS.darkCladding(),
    led: label === 'IN' ? MATERIALS.tealLED(2.5) : MATERIALS.amberIndicator(),
  }), [label]);
  return (
    <group position={[wx, 0, wz]}>
      {[-GATE_W / 2, GATE_W / 2].map((px, i) => (
        <group key={i} position={[px, 0, 0]}>
          <mesh position={[0, 3, 0]} castShadow material={mats.steel}>
            <boxGeometry args={[1.4, 6, 1.4]} />
          </mesh>
          <mesh position={[0, 6.2, 0]} material={mats.led}>
            <boxGeometry args={[0.9, 0.35, 0.9]} />
          </mesh>
        </group>
      ))}
      {/* slide gate panel, parked open beside the gap */}
      <mesh position={[label === 'IN' ? -GATE_W : GATE_W, 2.4, 0.9]} material={mats.steel}>
        <boxGeometry args={[GATE_W - 1, 4.2, 0.25]} />
      </mesh>
    </group>
  );
}

export function DepotGround() {
  const mats = useMemo(() => ({
    grass: MATERIALS.grass(),
    asphalt: MATERIALS.asphalt(),
    concrete: MATERIALS.polishedConcrete(),
    curb: MATERIALS.curbing(),
    white: MATERIALS.laneMarkingWhite(),
    yellow: MATERIALS.amberIndicator(),
    cladding: MATERIALS.darkCladding(),
    sign: MATERIALS.tealLED(3.5),
  }), []);

  const lot = rectWorld(LOT);
  const yS = LOT.y + LOT.h;          // south fence y (logical)
  const xIn = INGRESS.x, xOut = EGRESS.x;

  return (
    <group>
      {/* earth + site grass */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]} receiveShadow material={mats.grass}>
        <planeGeometry args={[420, 320]} />
      </mesh>

      {/* asphalt lot */}
      <mesh rotation-x={-Math.PI / 2} position={[lot.cx, 0.02, lot.cz]} receiveShadow material={mats.asphalt}>
        <planeGeometry args={[lot.w, lot.d]} />
      </mesh>

      {/* perimeter curb */}
      <mesh position={[lot.cx, 0.12, lot.cz]}>
        <boxGeometry args={[lot.w + 1.6, 0.24, lot.d + 1.6]} />
        <meshPhysicalMaterial color="#6b7077" roughness={0.9} metalness={0} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[lot.cx, 0.26, lot.cz]} receiveShadow material={mats.asphalt}>
        <planeGeometry args={[lot.w, lot.d]} />
      </mesh>

      {/* public road along the south edge */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, -105]} receiveShadow material={mats.asphalt}>
        <planeGeometry args={[420, 13]} />
      </mesh>
      {Array.from({ length: 21 }, (_, i) => (
        <mesh key={`rd${i}`} rotation-x={-Math.PI / 2} position={[-200 + i * 20, 0.03, -105]} material={mats.yellow}>
          <planeGeometry args={[8, 0.5]} />
        </mesh>
      ))}

      {/* perimeter security fence (south side split around the two gates) */}
      <FenceRun x1={LOT.x} y1={LOT.y} x2={LOT.x + LOT.w} y2={LOT.y} />
      <FenceRun x1={LOT.x} y1={LOT.y} x2={LOT.x} y2={yS} />
      <FenceRun x1={LOT.x + LOT.w} y1={LOT.y} x2={LOT.x + LOT.w} y2={yS} />
      <FenceRun x1={LOT.x} y1={yS} x2={xIn - GATE_W / 2} y2={yS} />
      <FenceRun x1={xIn + GATE_W / 2} y1={yS} x2={xOut - GATE_W / 2} y2={yS} />
      <FenceRun x1={xOut + GATE_W / 2} y1={yS} x2={LOT.x + LOT.w} y2={yS} />
      <Gate x={xIn} label="IN" />
      <Gate x={xOut} label="OUT" />

      {/* OTTOYARD entrance sign wall (west of ingress) */}
      <group position={[-78, 0, -88]}>
        <mesh position={[0, 2.6, 0]} castShadow material={mats.cladding}>
          <boxGeometry args={[24, 5.2, 1.6]} />
        </mesh>
        <mesh position={[0, 3.1, 0.85]} material={mats.sign}>
          <boxGeometry args={[16, 2.0, 0.06]} />
        </mesh>
      </group>
    </group>
  );
}
