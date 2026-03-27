import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { toWorld } from './coordUtils';
import { useDepotStore } from '@/store/depotStore';
import type { Vehicle } from '@/engine/types';

const MODEL_PATH = '/models/tesla_model3.glb';
useGLTF.preload(MODEL_PATH);

const COLORS: Record<string, string> = {
  fleet: '#00B4A6', core: '#E0E0E0', concierge: '#A0A0A0', elite: '#FFD700'
};
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

/**
 * Compute vehicle Y-rotation so its hood (front) faces toward its assigned stall/charger.
 * Falls back to facing depot center for vehicles without an assigned stall.
 */
function getFacingRotation(
  vehiclePos2d: { x: number; y: number },
  stallPos2d: { x: number; y: number } | null
): number {
  // Target: stall position if assigned, otherwise depot center
  const tx = stallPos2d ? stallPos2d.x : 150;
  const ty = stallPos2d ? stallPos2d.y : 110;

  // Convert both to 3D (XZ plane)
  const [vx, , vz] = toWorld(vehiclePos2d);
  const [sx, , sz] = toWorld({ x: tx, y: ty });

  const dx = sx - vx;
  const dz = sz - vz;

  // atan2(dx, dz) gives angle in XZ plane; model's default forward is +X,
  // so we use atan2(dx, dz) which aligns the model front toward the target
  return Math.atan2(dx, dz);
}

export function Vehicle3D({ vehicle, simSpeed }: { vehicle: Vehicle; simSpeed: number }) {
  const grp = useRef<THREE.Group>(null);
  const glw = useRef<THREE.Mesh>(null);
  const col = COLORS[vehicle.type] || '#E8E8E8';
  const fx = FX[vehicle.status] || FX.staging;
  const [tx, , tz] = toWorld(vehicle.position);

  // Look up assigned stall position from depot store
  const stalls = useDepotStore((s) => s.stalls);
  const stallPos2d = useMemo(() => {
    if (!vehicle.assignedStall) return null;
    const stall = stalls.find((s) => s.id === vehicle.assignedStall);
    return stall ? { x: stall.position.x, y: stall.position.y } : null;
  }, [vehicle.assignedStall, stalls]);

  const facingRotation = getFacingRotation(vehicle.position, stallPos2d);

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

  // Apply vehicle-type color tint to body meshes
  useEffect(() => {
    const tint = new THREE.Color(col);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const name = (mat.name || mesh.name || '').toLowerCase();
        if (BODY_HINTS.some((h) => name.includes(h))) {
          mat.color.copy(tint);
        }
      }
    });
  }, [clone, col]);

  useFrame((_, delta) => {
    if (!grp.current) return;
    const p = grp.current.position;
    const rate = Math.min(delta * 2 * Math.max(simSpeed, 1), 1);
    p.x = THREE.MathUtils.lerp(p.x, tx, rate);
    p.z = THREE.MathUtils.lerp(p.z, tz, rate);
  });

  return (
    <group ref={grp} position={[tx, 0, tz]}>
      <primitive
        object={clone}
        scale={[1.2, 1.2, 1.2]}
        rotation={[0, facingRotation, 0]}
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
