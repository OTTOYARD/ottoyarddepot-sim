// ============================================================================
// Lanes3D — RAILS P2 (3D half). Ground-painted right-of-way markings generated
// from the SAME directed LaneGraph as the 2D overlay and the routed motion, so
// all three agree by construction.
//
//   • teal chevrons  = one-way lane (charging gaps NORTHBOUND, rear apron EAST)
//   • grey chevrons  = travel direction on a two-way road
//   • amber median   = a divided road: two solid edge lines with diagonal hatching
//                      between, the 1.6u between its streams (lanePaint.medians)
//   • amber dashes   = the centre stripe of a two-way aisle
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
import { StaticBatch } from "./staticBatch";

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
      // the median's hatching: the same yellow, worn back toward the asphalt so the
      // strip reads as empty road rather than a solid block of paint
      hatch: new THREE.MeshStandardMaterial({ color: "#8a7440", roughness: 0.85, metalness: 0 }),
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

  // ONE buffer per paint colour for the whole lot (phone lane, 2026-09-29): the
  // markings never move, and drawn one mesh per chevron arm, dash and bar they
  // were ~370 draw calls — an eighth of the frame — for a few thousand triangles.
  // Same geometry at the same place; only the batching changed.
  const batched = useMemo(() => {
    const b = new StaticBatch();
    const put = (key: string, g: THREE.BufferGeometry, x: number, z: number, rotY: number) =>
      b.geometry(key, g.clone().rotateY(rotY).translate(x, Y_PAINT, z));

    // travel-direction chevrons, in the lane a car actually drives
    for (const a of paint.arrows) {
      const [wx, , wz] = toWorld({ x: a.x, y: a.y }, 0);
      const key = a.oneWay ? "oneWay" : "twoWay";
      const yaw = yawFromHeading2D(a.angle);
      put(key, chevron.left, wx, wz, yaw);
      put(key, chevron.right, wx, wz, yaw);
    }
    // two-way aisle centre dashes
    for (const d of stripeDashes) put("stripe", new THREE.BoxGeometry(0.28, 0.03, d.len), d.x, d.z, d.rotY);
    // divided-road medians: a solid line along each edge, and the hatching between
    for (const m of paint.medians) {
      for (const e of m.edges) {
        for (let i = 1; i < e.length; i++) {
          const a = e[i - 1], c = e[i];
          const len = Math.hypot(c.x - a.x, c.y - a.y);
          if (len < 1e-3) continue;
          const [wx, , wz] = toWorld({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, 0);
          put("stripe", new THREE.BoxGeometry(0.28, 0.03, len), wx, wz, yawFromHeading2D(Math.atan2(c.y - a.y, c.x - a.x)));
        }
      }
      for (const h of m.hatch) {
        const [wx, , wz] = toWorld({ x: h.x, y: h.y }, 0);
        put("hatch", new THREE.BoxGeometry(0.16, 0.03, h.len), wx, wz, yawFromHeading2D(h.angle));
      }
    }
    // stop bars across one-way mouths
    for (const s of paint.stopBars) {
      const [wx, , wz] = toWorld({ x: s.x, y: s.y }, 0);
      put("stop", new THREE.BoxGeometry(LANE_PAINT_WIDTH, 0.03, 0.5), wx, wz, yawFromHeading2D(s.angle));
    }
    return b.build();
  }, [paint, chevron, stripeDashes]);

  return (
    <group name="lane-paint">
      {[...batched.entries()].map(([k, g]) => (
        <mesh key={k} geometry={g} material={materials[k as keyof typeof materials]} />
      ))}
    </group>
  );
}
