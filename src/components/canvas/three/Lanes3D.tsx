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
// Heading note: the plan->world yaw transform is yawFromHeading2D in
// coordUtils, next to the position transform it has to agree with. This file
// used to re-derive it inline and was left behind by d879a23's X negation, so
// the chevrons on every EAST/WEST lane pointed against the traffic they mark.
// ============================================================================
import { useMemo } from "react";
import * as THREE from "three";
import { buildDepotLanes } from "@/engine/motion/LaneGraph";
import { paintLanes, LANE_PAINT_WIDTH } from "@/engine/motion/lanePaint";
import { toWorld, yawFromHeading2D, DECK_Y } from "./coordUtils";

// ON the drivable deck (DECK_Y), not the ground under it. This was 0.055 — a
// datum from before DepotGround laid the 0.26 asphalt deck over the lot — so
// every chevron, divider dash and stop bar sat 0.2u UNDER the pavement and
// none of the lane paint was visible in 3D at all.
const Y_PAINT = DECK_Y + 0.02;

export function Lanes3D() {
  const paint = useMemo(() => paintLanes(buildDepotLanes()), []);

  // Lit, opaque road paint: now that the markings are actually on the deck they
  // have to read as paint in the sun and in shadow, not as unlit overlays that
  // glow at night. Same hues as the 2D overlay, so the two views still agree.
  const materials = useMemo(
    () => ({
      oneWay: new THREE.MeshStandardMaterial({ color: "#27b5a3", roughness: 0.75, metalness: 0 }),
      twoWay: new THREE.MeshStandardMaterial({ color: "#c2c8d0", roughness: 0.8, metalness: 0 }),
      stripe: new THREE.MeshStandardMaterial({ color: "#d9a431", roughness: 0.75, metalness: 0 }),
      stop: new THREE.MeshStandardMaterial({ color: "#e9edf2", roughness: 0.75, metalness: 0 }),
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
          out.push({ x: wx, z: wz, rotY: yawFromHeading2D(angle), len: 3 });
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
          <group key={`ch${i}`} position={[wx, Y_PAINT, wz]} rotation={[0, yawFromHeading2D(a.angle), 0]}>
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
            rotation={[0, yawFromHeading2D(b.angle), 0]}
            material={materials.stop}
          >
            <boxGeometry args={[LANE_PAINT_WIDTH, 0.03, 0.5]} />
          </mesh>
        );
      })}
    </group>
  );
}
