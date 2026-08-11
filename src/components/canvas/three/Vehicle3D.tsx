import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { toWorld, yawFromHeading2D, DECK_Y } from './coordUtils';
import { VEHICLE_GEO as GEO, PORT_GEO, CAR_W_PU } from './vehicleBody';
import { poseStore } from '@/engine/motion/poseStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { towardFor, portInVehicleFrame } from '@/lib/ottoChargeArm/depotPlacement';
import type { Vehicle } from '@/engine/types';

// ── PERF: the fleet used to clone a 22.5MB GLB per car (176 meshes / 684k tris
// EACH → ~20,000 draw calls + ~79M triangles/frame at 115 cars, drawn AGAIN by
// the shadow pass). Every car is now a shared low-poly robotaxi: ONE geometry +
// material set shared fleet-wide, and only the body casts a shadow. The 22.5MB
// model download is gone entirely.
//
// The body used to be stacked BoxGeometry — a slab with a floating glass cube
// on it, which does not read as a vehicle at any distance. It is now the
// extruded side-profile pod developed for the OTTO-CHARGE ARM viewer.
//
// Draw calls per car went 6 -> 7 (+ the status glow, + 2 for the charge port on
// cars that have one), NOT 6 -> 13: the four tyres are merged into one buffer,
// the four rim discs into another, the cladding and sensor pod into a third,
// and the greenhouse and pod glass into a fourth. Merging is done ONCE at module
// load, not per vehicle.

// Realistic fleet paint mix (weights ≈ real-world car-color distribution),
// picked stably per vehicle id. Ops color-coding stays on the 2D dots/badges.
const PAINTS: [string, number][] = [
  ['#e9eaec', 28], ['#101216', 20], ['#c4c8cd', 14], ['#6d7178', 12],
  ['#1b3a6b', 9], ['#7a1622', 8], ['#0e6f63', 5], ['#2e4a31', 4],
];
const PAINT_TOTAL = PAINTS.reduce((n, p) => n + p[1], 0);
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
function paintFor(id: string): string {
  let r = hash(id) % PAINT_TOTAL;
  for (const [c, w] of PAINTS) { if (r < w) return c; r -= w; }
  return PAINTS[0][0];
}
const FX: Record<string, { glow: string; pulse: number; op: number }> = {
  approaching: { glow: '', pulse: 0, op: 0.85 },
  queued: { glow: '', pulse: 0, op: 0.6 },
  charging: { glow: '#00B4A6', pulse: 3, op: 1 },
  washing: { glow: '#2196F3', pulse: 2, op: 1 },
  detailing: { glow: '#2196F3', pulse: 1.5, op: 1 },
  maintenance: { glow: '#FF9800', pulse: 1, op: 1 },
  staging: { glow: '', pulse: 0, op: 0.7 },
  departing: { glow: '', pulse: 0, op: 0.85 },
};

const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: '#0d1418', roughness: 0.10, metalness: 0.25 }),
  // One dark trim material for cladding AND sensor pod. The viewer gave them
  // slightly different roughness; at depot camera range that difference is
  // invisible and it costs a whole extra draw call per car to keep.
  trim: new THREE.MeshStandardMaterial({ color: '#171b21', roughness: 0.55, metalness: 0.45 }),
  tyre: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: '#6a7280', roughness: 0.3, metalness: 0.9 }),
  portSocket: new THREE.MeshStandardMaterial({ color: '#3a4048', roughness: 0.35, metalness: 0.9 }),
  // Idle vs live: the ring is a fixture, so it is dimly lit at rest and bright
  // while current is flowing. Two shared materials, not one per vehicle.
  portRing: new THREE.MeshStandardMaterial({
    color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 0.6, roughness: 1, metalness: 0, toneMapped: false,
  }),
  portRingLive: new THREE.MeshStandardMaterial({
    color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 2.2, roughness: 1, metalness: 0, toneMapped: false,
  }),
  paints: new Map<string, THREE.MeshStandardMaterial>(),
  glows: new Map<string, THREE.MeshPhysicalMaterial>(),
};
function paintMat(col: string): THREE.MeshStandardMaterial {
  let m = MAT.paints.get(col);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.30, metalness: 0.60 });
    MAT.paints.set(col, m);
  }
  return m;
}
function glowMat(col: string): THREE.MeshPhysicalMaterial {
  let m = MAT.glows.get(col);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, transparent: true, opacity: 0.12, roughness: 1, metalness: 0, toneMapped: false });
    MAT.glows.set(col, m);
  }
  return m;
}

/**
 * Which flank this vehicle presents its charge port on.
 *
 * chargePort.ts models the vehicle as ARRIVING CORRECTLY ORIENTED — a
 * pedestal-mounted arm cannot serve the far flank, so an AV picks its approach
 * so the inlet presents to the charger, the way a driver picks a pump side.
 * That makes the port side a property of the ASSIGNED STALL, not of the car:
 * the pedestal sits on the car's -toward flank, so the port does too.
 *
 * Away from a charging stall there is no pedestal to present to, so the side
 * falls back to a stable per-vehicle choice rather than flipping about.
 */
function portSideFor(id: string, stallToward: 1 | -1 | 0): 1 | -1 {
  if (stallToward !== 0) return (-stallToward) as 1 | -1;
  return hash(id) % 2 === 0 ? 1 : -1;
}

// Vehicles face their direction of travel while moving (one-way circulation),
// then settle to their stall's site-plan angle when parked.

function Vehicle3DInner({ vehicle }: { vehicle: Vehicle; simSpeed: number }) {
  const grp = useRef<THREE.Group>(null);
  const col = paintFor(vehicle.id);
  const fx = FX[vehicle.status] || FX.staging;
  // Only the HOVERED car shows its data badge — one <Html> instead of 132 (drei
  // re-projects every Html label to screen each frame, a huge cost at fleet size).
  // Selector returns a bool, so a car only re-renders when ITS hover state flips.
  const isHovered = useVehicleStore((s) => s.hoveredVehicleId === vehicle.id);
  const setHovered = useVehicleStore((s) => s.setHoveredVehicle);

  // Pedestal side of this vehicle's stall, or 0 when it is not at a charger.
  // The selector returns a PRIMITIVE, so the car re-renders only when the sign
  // actually flips — not on every depot-store update.
  const stallToward = useDepotStore((s) => {
    if (!vehicle.assignedStall) return 0 as const;
    const st = s.stalls.find((x) => x.id === vehicle.assignedStall);
    if (!st || (st.type !== 'dcfc' && st.type !== 'l2')) return 0 as const;
    return towardFor(st.position.x);
  });

  const port = useMemo(() => {
    const p = portFor(vehicle.id, vehicle.oem);
    const side = portSideFor(vehicle.id, stallToward);
    const v = portInVehicleFrame(p.along, p.height, CAR_W_PU / 2, side);
    // The socket is authored with its normal on +X; on the -X flank the whole
    // group turns about Y so the recess still sinks INTO the bodywork.
    return { pos: [v.x, v.y, v.z] as [number, number, number], yaw: side > 0 ? 0 : Math.PI };
  }, [vehicle.id, vehicle.oem, stallToward]);

  // Initial mount position only; the LIVE pose is driven imperatively from the
  // poseStore in useFrame below (no React re-render on movement).
  const [tx, , tz] = toWorld(vehicle.position);

  useFrame(() => {
    const g = grp.current;
    if (!g) return;
    const lp = poseStore.get(vehicle.id);
    if (!lp) return;
    // Faithful render of the physics pose: the driver already integrates a smooth
    // 60fps kinematic pose, so we set it DIRECTLY — no lerp (lerp was the slide) —
    // and face by the TRUE steering heading, not a guess from the frame delta.
    const [wx, , wz] = toWorld({ x: lp.x, y: lp.y });
    g.position.x = wx;
    g.position.z = wz;
    // Yaw comes from coordUtils so it can never again disagree with toWorld's
    // signs — the old inline atan2(cosθ, −sinθ) predated d879a23's X negation
    // and rendered every east/west car facing backwards.
    g.rotation.y = yawFromHeading2D(lp.heading);
  });

  return (
    <group
      ref={grp}
      position={[tx, 0, tz]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(vehicle.id); }}
      onPointerOut={() => setHovered(null)}
    >
      {/* Tyres rest ON the deck, the same grade the OTTO-CHARGE ARM mounts off. */}
      <group position={[0, DECK_Y, 0]}>
        {/* body — the ONLY shadow caster on the car (shadow pass stays cheap) */}
        <mesh geometry={GEO.body} material={paintMat(col)} castShadow />
        <mesh geometry={GEO.glass} material={MAT.glass} />
        <mesh geometry={GEO.trim} material={MAT.trim} />
        <mesh geometry={GEO.tyres} material={MAT.tyre} />
        <mesh geometry={GEO.rims} material={MAT.rim} />
      </group>

      {/* Charge port — the inlet the OTTO-CHARGE ARM actually mates with.
          Positioned from portFor() through the same resolver the arm solves
          against, so what the robot plugs into is what you can see. */}
      <group position={port.pos} rotation={[0, port.yaw, 0]}>
        <mesh geometry={PORT_GEO.socket} material={MAT.portSocket} />
        <mesh
          geometry={PORT_GEO.ring}
          material={vehicle.status === 'charging' ? MAT.portRingLive : MAT.portRing}
        />
      </group>

      {/* Status glow */}
      {fx.glow && (
        <mesh geometry={GEO.glow} material={glowMat(fx.glow)} position={[0, 3.9, 0]} />
      )}

      {/* SoC badge — only on the hovered car (keeps the scene fast) */}
      {isHovered && (
        <Html position={[0, 6.66, 0]} center>
          <div className="px-1.5 py-0.5 rounded text-[7px] font-mono bg-black/80 text-white whitespace-nowrap border border-white/10 flex items-center gap-1"
            style={{ backdropFilter: 'blur(4px)' }}>
            <div className="w-6 h-1 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${vehicle.currentSoC}%`,
                  backgroundColor: vehicle.currentSoC > 60 ? '#22c55e' : vehicle.currentSoC > 30 ? '#eab308' : '#ef4444',
                }}
              />
            </div>
            {Math.round(vehicle.currentSoC)}%
          </div>
        </Html>
      )}
    </group>
  );
}

// PERF: the roster array is rebuilt on every twin poll (new object identities);
// live position comes from poseStore, so a car only needs to re-render when its
// id / status / SoC actually change — plus, now, its stall assignment and OEM,
// which together decide where its charge port sits.
//
// SoC IS COMPARED AT THE PRECISION IT IS DRAWN AT, and no coarser. The old
// `Math.round(soc / 5)` bucketed the roster into 5-point steps, so a hovered
// car's badge — which prints Math.round(soc) — kept re-rendering the SoC
// captured at the last bucket crossing. A car climbing 4 points while you
// watched it charge showed a completely unchanging number, which is exactly
// the "SoC never increases" report. The 5-point bucketing was a perf tactic,
// not a display choice, and it silently became the display.
//
// Exported so the SoC precision can be asserted directly — the defect it caused
// was invisible to every test in the suite because it lived in a memo predicate.
export function vehicleRenderEqual(
  a: { vehicle: Vehicle }, b: { vehicle: Vehicle },
): boolean {
  return a.vehicle.id === b.vehicle.id &&
    a.vehicle.status === b.vehicle.status &&
    a.vehicle.assignedStall === b.vehicle.assignedStall &&
    a.vehicle.oem === b.vehicle.oem &&
    Math.round(a.vehicle.currentSoC) === Math.round(b.vehicle.currentSoC);
}

export const Vehicle3D = memo(Vehicle3DInner, vehicleRenderEqual);
