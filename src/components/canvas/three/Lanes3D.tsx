// ============================================================================
// Lanes3D — RAILS P2 (3D half). Ground-painted right-of-way markings generated
// from the SAME directed LaneGraph as the 2D overlay and the routed motion, so
// all three agree by construction.
//
//   • teal chevrons  = one-way lane (charging gaps NORTHBOUND, rear apron EAST)
//   • grey chevrons  = travel direction on a two-way divided road
//   • amber dashes   = the centre divider of a two-way road
//   • white bars     = stop line at a one-way lane mouth
//
// Heading note: the plan frame is y-DOWN (south = +y) and the 3D frame maps
// z = 110 - y, so a 2D heading θ becomes the 3D direction (cos θ, -sin θ) and
// the Y-rotation is atan2(cos θ, -sin θ).
// ============================================================================
import { useMemo } from "react";
import * as THREE from "three";
import { buildDepotLanes } from "@/engine/motion/LaneGraph";
import { paintLanes, LANE_PAINT_WIDTH } from "@/engine/motion/lanePaint";
import { toWorld } from "./coordUtils";

const Y_PAINT = 0.055; // just above the tarmac, below the cars

function rotYFrom2D(angle: number) {
  // 2D heading -> 3D direction (cos, -sin) in (x, z); Y-rotation to face it
  return Math.atan2(Math.cos(angle), -Math.sin(angle));
}

export function Lanes3D() {
  const paint = useMemo(() => paintLanes(buildDepotLanes()), []);

  const materials = useMemo(
    () => ({
      oneWay: new THREE.MeshBasicMaterial({ color: "#2BD9C4", transparent: true, opacity: 0.85 }),
      twoWay: new THREE.MeshBasicMaterial({ color: "#7A8699", transparent: true, opacity: 0.5 }),
      stripe: new THREE.MeshBasicMaterial({ color: "#F5B942", transparent: true, opacity: 0.45 }),
      stop: new THREE.MeshBasicMaterial({ color: "#E7EAF0", transparent: true, opacity: 0.75 }),
    }),
    []
  );

  // one shared chevron geometry pair: two angled bars forming a ">" that points
  // along +Z (the group's rotation then aims it down the lane).
  const chevron = useMemo(() => {
    const left = new THREE.BoxGeometry(0.5, 0.03, 2.2).rotateY(0.62).translate(-0.55, 0, -0.5);
    const right = new THREE.BoxGeometry(0.5, 0.03, 2.2).rotateY(-0.62).translate(0.55, 0, -0.5);
    return { left, right };
  }, []);

  // centre-divider dashes sampled along each two-way centreline
  const stripeDashes = useMemo(() => {
    const out: { x: number; z: number; rotY: number; len: number }[] = [];
    for (const s of paint.stripes) {
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1];
        const b = s.pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 1e-3) continue;
        const angle = Math.atan2(dy, dx);
        const step = 6;
        for (let d = 3; d < segLen - 3; d += step) {
          const t = d / segLen;
          const [wx, , wz] = toWorld({ x: a.x + dx * t, y: a.y + dy * t }, 0);
          out.push({ x: wx, z: wz, rotY: rotYFrom2D(angle), len: 3 });
        }
      }
    }
    return out;
  }, [paint]);

  return (
    <group name="lane-paint">
      {/* travel-direction chevrons, in the lane a car actually drives */}
      {paint.arrows.map((a, i) => {
        const [wx, , wz] = toWorld({ x: a.x, y: a.y }, 0);
        const mat = a.oneWay ? materials.oneWay : materials.twoWay;
        return (
          <group key={`ch${i}`} position={[wx, Y_PAINT, wz]} rotation={[0, rotYFrom2D(a.angle), 0]}>
            <mesh geometry={chevron.left} material={mat} />
            <mesh geometry={chevron.right} material={mat} />
          </group>
        );
      })}

      {/* two-way centre divider dashes */}
      {stripeDashes.map((d, i) => (
        <mesh
          key={`st${i}`}
          position={[d.x, Y_PAINT, d.z]}
          rotation={[0, d.rotY, 0]}
          material={materials.stripe}
        >
          <boxGeometry args={[0.28, 0.03, d.len]} />
        </mesh>
      ))}

      {/* stop bars across one-way mouths */}
      {paint.stopBars.map((b, i) => {
        const [wx, , wz] = toWorld({ x: b.x, y: b.y }, 0);
        return (
          <mesh
            key={`sb${i}`}
            position={[wx, Y_PAINT, wz]}
            rotation={[0, rotYFrom2D(b.angle), 0]}
            material={materials.stop}
          >
            <boxGeometry args={[LANE_PAINT_WIDTH, 0.03, 0.5]} />
          </mesh>
        );
      })}
    </group>
  );
}
