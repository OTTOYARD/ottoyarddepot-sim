import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { toWorld } from './coordUtils';
import { poseStore } from '@/engine/motion/poseStore';
import { MATERIALS } from './materials';
import type { Vehicle } from '@/engine/types';

const MODEL_PATH = '/models/tesla_model3.glb';
useGLTF.preload(MODEL_PATH);

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

const BODY_HINTS = ['body', 'paint', 'car', 'exterior', 'shell', 'hood', 'door', 'fender', 'bumper', 'trunk'];

// Vehicles face their direction of travel while moving (one-way circulation),
// then settle to their stall's site-plan angle when parked.

export function Vehicle3D({ vehicle }: { vehicle: Vehicle; simSpeed: number }) {
  const grp = useRef<THREE.Group>(null);
  const glw = useRef<THREE.Mesh>(null);
  const col = paintFor(vehicle.id);
  const fx = FX[vehicle.status] || FX.staging;
  // Initial mount position only; the LIVE pose is driven imperatively from the
  // poseStore in useFrame below (no React re-render on movement).
  const [tx, , tz] = toWorld(vehicle.position);

  const { scene } = useGLTF(MODEL_PATH);

  // Clone scene and compute ground offset
  const { clone, yOffset } = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          mesh.material = (mesh.material as THREE.Material).clone();
        }
      }
    });

    const box = new THREE.Box3().setFromObject(c);
    const offset = -box.min.y;

    return { clone: c, yOffset: offset };
  }, [scene]);

  // Swap body panels to a true clearcoat automotive paint (shared per color)
  useEffect(() => {
    const paint = MATERIALS.automotivePaint(col);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const name = (mat.name || mesh.name || '').toLowerCase();
        if (BODY_HINTS.some((h) => name.includes(h))) {
          mesh.material = paint;
        }
      }
    });
  }, [clone, col]);

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
    <group ref={grp} position={[tx, 0, tz]}>
      <primitive
        object={clone}
        scale={[1.2, 1.2, 1.2]}
        rotation={[0, 0, 0]}
        position={[0, yOffset * 1.2, 0]}
      />

      {/* Status glow */}
      {fx.glow && (
        <mesh ref={glw} position={[0, 2.2, 0]}>
          <sphereGeometry args={[1.8, 8, 8]} />
          <meshPhysicalMaterial color={fx.glow} emissive={fx.glow} emissiveIntensity={0.5} transparent opacity={0.12} roughness={1} metalness={0} toneMapped={false} />
        </mesh>
      )}

      {/* SoC badge */}
      <Html position={[0, 3.2, 0]} center>
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
    </group>
  );
}
