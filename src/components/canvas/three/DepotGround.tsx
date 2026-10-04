import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { LOT, INGRESS, EGRESS, GATE_W, southFenceSpans } from '@/lib/sitePlan';
import { toWorld, DECK_Y } from './coordUtils';
import { logoSignMaterial, LOGO_SIGN_ASPECT, gateSignTexture } from './textures';
import { SIGN_WALL } from '@/lib/structurePlan';
import { DEPOT_BLOCK, DEPOT_ROAD_SPAN, SOUTH_ROAD } from './cityPlan';

/**
 * Ground plane, asphalt lot, perimeter security fence with ingress/egress
 * gates, public road, and entrance signage — all derived from the site plan.
 *
 * The grass is the depot's own block and the road its stretch between the two
 * avenues; the city around them (UrbanSurround, cityPlan.ts) draws the rest.
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
  const mats = useMemo(() => {
    const sign = gateSignTexture(label === 'IN' ? 'ENTER' : 'EXIT', label === 'IN' ? '#00D4AA' : '#FFAA00');
    return {
      steel: MATERIALS.darkCladding(),
      led: label === 'IN' ? MATERIALS.tealLED(2.5) : MATERIALS.amberIndicator(),
      sign: new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.55, roughness: 0.5 }),
    };
  }, [label]);
  // the sign hangs on the gate's OUTER post, facing the road, clear of the opening
  const other = label === 'IN' ? EGRESS.x : INGRESS.x;
  const outer = Math.sign(toWorld({ x, y: 0 }, 0)[0] - toWorld({ x: other, y: 0 }, 0)[0]);
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
      {/* ENTER / EXIT, on the road face of the outer post */}
      <group position={[outer * (GATE_W / 2 + 1.0), 3.6, -0.7]}>
        <mesh position={[0, 0, -0.06]} material={mats.steel}>
          <boxGeometry args={[3.6, 1.5, 0.12]} />
        </mesh>
        <mesh position={[0, 0, -0.13]} rotation-y={Math.PI} material={mats.sign}>
          <planeGeometry args={[3.4, 1.3]} />
        </mesh>
      </group>
      {/* slide gate panel, parked open beside the gap */}
      <mesh position={[label === 'IN' ? -GATE_W : GATE_W, 2.4, 0.9]} material={mats.steel}>
        <boxGeometry args={[GATE_W - 1, 4.2, 0.25]} />
      </mesh>
    </group>
  );
}

/** The sign wall, logo lit on BOTH faces: the road side for arrivals, the lot side
 *  for every camera that looks south across the depot. */
function SignWall({ material, logo }: { material: THREE.Material; logo: THREE.Material }) {
  const [wx, , wz] = toWorld({ x: SIGN_WALL.cx, y: SIGN_WALL.cy }, 0);
  const { w, d, h } = SIGN_WALL;
  const logoH = h - 0.8;
  return (
    <group position={[wx, 0, wz]}>
      <mesh position={[0, h / 2, 0]} castShadow material={material}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, h / 2, side * (d / 2 + 0.03)]} rotation-y={side > 0 ? 0 : Math.PI} material={logo}>
          <planeGeometry args={[logoH * LOGO_SIGN_ASPECT, logoH]} />
        </mesh>
      ))}
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
  }), []);

  const logoSign = useMemo(() => logoSignMaterial(0.7), []);

  const lot = rectWorld(LOT);
  const yS = LOT.y + LOT.h;          // south fence y (logical)
  const xIn = INGRESS.x, xOut = EGRESS.x;

  return (
    <group>
      {/* site grass: the depot's block, out to the city's sidewalks */}
      <mesh rotation-x={-Math.PI / 2} position={[(DEPOT_BLOCK.x0 + DEPOT_BLOCK.x1) / 2, -0.05, (DEPOT_BLOCK.z0 + DEPOT_BLOCK.z1) / 2]} receiveShadow material={mats.grass}>
        <planeGeometry args={[DEPOT_BLOCK.x1 - DEPOT_BLOCK.x0, DEPOT_BLOCK.z1 - DEPOT_BLOCK.z0]} />
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
      <mesh rotation-x={-Math.PI / 2} position={[lot.cx, DECK_Y, lot.cz]} receiveShadow material={mats.asphalt}>
        <planeGeometry args={[lot.w, lot.d]} />
      </mesh>

      {/* public road along the south edge, between the avenues (the city draws it on from there) */}
      <mesh rotation-x={-Math.PI / 2} position={[(DEPOT_ROAD_SPAN.x0 + DEPOT_ROAD_SPAN.x1) / 2, 0.01, SOUTH_ROAD.at]} receiveShadow material={mats.asphalt}>
        <planeGeometry args={[DEPOT_ROAD_SPAN.x1 - DEPOT_ROAD_SPAN.x0, SOUTH_ROAD.width]} />
      </mesh>
      {Array.from({ length: 21 }, (_, i) => -200 + i * 20).filter((x) => x - 4 > DEPOT_ROAD_SPAN.x0 && x + 4 < DEPOT_ROAD_SPAN.x1).map((x) => (
        <mesh key={`rd${x}`} rotation-x={-Math.PI / 2} position={[x, 0.03, SOUTH_ROAD.at]} material={mats.yellow}>
          <planeGeometry args={[8, 0.5]} />
        </mesh>
      ))}

      {/* perimeter security fence, the south side split around the two gates. The south
          runs come from sitePlan.southFenceSpans: they were typed here for an ingress WEST of
          the egress, and once the gates swapped sides (enter east, exit west) the three runs
          overlapped and closed the fence across BOTH gate openings. */}
      <FenceRun x1={LOT.x} y1={LOT.y} x2={LOT.x + LOT.w} y2={LOT.y} />
      <FenceRun x1={LOT.x} y1={LOT.y} x2={LOT.x} y2={yS} />
      <FenceRun x1={LOT.x + LOT.w} y1={LOT.y} x2={LOT.x + LOT.w} y2={yS} />
      {southFenceSpans().map(([a, b]) => <FenceRun key={a} x1={a} y1={yS} x2={b} y2={yS} />)}
      <Gate x={xIn} label="IN" />
      <Gate x={xOut} label="OUT" />

      {/* OTTOYARD entrance sign wall: outside the south fence, mid-frontage between
          the gates, drawn from structurePlan.SIGN_WALL (which the stall and clearance
          tests read). It used to be typed in here at INGRESS.x - 178 / z -88, which
          after toWorld negated X stood inside the S2 staging row across four stalls. */}
      <SignWall material={mats.cladding} logo={logoSign} />
    </group>
  );
}
