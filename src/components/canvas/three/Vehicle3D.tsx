import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { toWorld } from './coordUtils';
import { poseStore } from '@/engine/motion/poseStore';
import { useVehicleStore } from '@/store/vehicleStore';
import type { Vehicle } from '@/engine/types';

// ── PERF: the fleet used to clone a 22.5MB GLB per car (176 meshes / 684k tris
// EACH → ~20,000 draw calls + ~79M triangles/frame at 115 cars, drawn AGAIN by
// the shadow pass). Every car is now a shared low-poly sedan: ~6 draw calls and
// ~300 triangles per car, ONE geometry + material set shared fleet-wide, and
// only the body casts a shadow. The 22.5MB model download is gone entirely.

// Realistic fleet paint mix (weights ≈ real-world car-color distribution),
// picked stably per vehicle id. Ops color-coding stays on the 2D dots/badges.
const PAINTS: [string, number][] = [
  ['#e9eaec', 28], ['#101216', 20], ['#c4c8cd', 14], ['#6d7178', 12],
  ['#1b3a6b', 9], ['#7a1622', 8], ['#0e6f63', 5], ['#2e4a31', 4],
];
const PAINT_TOTAL = PAINTS.reduce((n, p) => n + p[1], 0);
function paintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  let r = h % PAINT_TOTAL;
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

// Shared geometries + materials — created ONCE for the whole fleet.
// Scaled by factor 10.2 / 4.9 ≈ 2.08 from the original metre values to match the 2D car size (10.2 plan units long).
// (1 plan unit = 0.4785 m).
const SCALE = 7.5 / 4.9;
const GEO = {
  body: new THREE.BoxGeometry(2.2 * SCALE, 0.85 * SCALE, 4.9 * SCALE),
  cabin: new THREE.BoxGeometry(3.8 / 2.0 * SCALE, 1.24 / 2.0 * SCALE, 5.0 / 2.0 * SCALE),
  wheel: new THREE.CylinderGeometry(0.84 / 2.0 * SCALE, 0.84 / 2.0 * SCALE, 0.6 / 2.0 * SCALE, 10),
  glow: new THREE.SphereGeometry(3.6 / 2.0 * SCALE, 8, 8),
};
GEO.wheel.rotateZ(Math.PI / 2); // axle along X
const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: '#0c1116', roughness: 0.12, metalness: 0.9 }),
  wheel: new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.9 }),
  paints: new Map<string, THREE.MeshStandardMaterial>(),
  glows: new Map<string, THREE.MeshPhysicalMaterial>(),
};
function paintMat(col: string): THREE.MeshStandardMaterial {
  let m = MAT.paints.get(col);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.75 });
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
const WHEELS: [number, number, number][] = [
  [-2.19, 0.87, 3.23], [2.19, 0.87, 3.23], [-2.19, 0.87, -3.23], [2.19, 0.87, -3.23],
];

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
    // logical heading θ (0=+x, y-down) → world travel (cosθ, −sinθ); model forward
    // at rot.y=0 is +Z, so rot.y = atan2(worldDX, worldDZ) = atan2(cosθ, −sinθ).
    g.rotation.y = Math.atan2(Math.cos(lp.heading), -Math.sin(lp.heading));
  });

  return (
    <group
      ref={grp}
      position={[tx, 0, tz]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(vehicle.id); }}
      onPointerOut={() => setHovered(null)}
    >
      {/* body — the ONLY shadow caster on the car (shadow pass stays cheap) */}
      <mesh geometry={GEO.body} material={paintMat(col)} position={[0, 1.77, 0]} castShadow />
      <mesh geometry={GEO.cabin} material={MAT.glass} position={[0, 3.12, -0.52]} />
      {WHEELS.map((p, i) => (
        <mesh key={i} geometry={GEO.wheel} material={MAT.wheel} position={p} />
      ))}

      {/* Status glow */}
      {fx.glow && (
        <mesh geometry={GEO.glow} material={glowMat(fx.glow)} position={[0, 4.58, 0]} />
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
// id / status / coarse SoC actually change.
export const Vehicle3D = memo(Vehicle3DInner, (a, b) =>
  a.vehicle.id === b.vehicle.id &&
  a.vehicle.status === b.vehicle.status &&
  Math.round(a.vehicle.currentSoC / 5) === Math.round(b.vehicle.currentSoC / 5));
