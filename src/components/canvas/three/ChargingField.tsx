import { useMemo } from 'react';
import * as THREE from 'three';
import { useDepotStore } from '@/store/depotStore';
import { CANOPIES } from '@/lib/sitePlan';
import { toWorld } from './coordUtils';
import { MATERIALS } from './materials';

// charge cable arc, built per side (toward = ±1 points at the canopy spine)
function cableGeo(toward: number): THREE.TubeGeometry {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-toward * 0.8, 2.1, 0.15),
    new THREE.Vector3(-toward * 2.4, 0.9, 0.55),
    new THREE.Vector3(-toward * 4.0, 1.5, 0.35),
  );
  return new THREE.TubeGeometry(curve, 14, 0.09, 6);
}
const CABLES: Record<number, THREE.TubeGeometry> = { 1: cableGeo(1), [-1]: cableGeo(-1) };

interface Props { type: 'dcfc' | 'l2'; count: number; }

/**
 * Charging pedestals. Gas-pump layout: each stall holds the CAR position;
 * the pedestal stands beside it, toward its canopy's center spine.
 * Pedestal LED reflects live stall status (available/charging/servicing/offline).
 */
export function ChargingField({ type }: Props) {
  const stalls = useDepotStore((s) => s.stalls);
  const list = useMemo(() => stalls.filter((s) => s.type === type), [stalls, type]);

  const mats = useMemo(() => ({
    body: MATERIALS.anodizedPanel(),
    screen: MATERIALS.screenGlass(),
    teal: MATERIALS.tealLED(1.2),
    green: MATERIALS.greenIndicator(),
    amber: MATERIALS.amberIndicator(),
    red: MATERIALS.tealLED(0.4),
    cap: MATERIALS.darkCladding(),
  }), []);

  const ledFor = (status: string) => {
    if (status === 'charging') return mats.green;
    if (status === 'servicing' || status === 'occupied' || status === 'reserved') return mats.amber;
    if (status === 'offline') return mats.red;
    return mats.teal;
  };

  const isDC = type === 'dcfc';
  const H = isDC ? 3.6 : 2.8;
  const W = isDC ? 1.5 : 1.1;

  return (
    <group>
      {list.map((s) => {
        // pedestal sits between the car and its canopy spine
        const canopy = CANOPIES.reduce((best, c) =>
          Math.abs(c.cx - s.position.x) < Math.abs(best.cx - s.position.x) ? c : best, CANOPIES[0]);
        const toward = Math.sign(canopy.cx - s.position.x) || 1;
        const px = s.position.x + toward * 4.5;
        const [wx, , wz] = toWorld({ x: px, y: s.position.y }, 0);

        return (
          <group key={s.id} position={[wx, 0, wz]}>
            {/* concrete pad */}
            <mesh position={[0, 0.08, 0]} receiveShadow>
              <boxGeometry args={[W + 0.8, 0.16, 1.6]} />
              <primitive object={mats.cap} attach="material" />
            </mesh>
            {/* pedestal body */}
            <mesh position={[0, H / 2 + 0.16, 0]} castShadow material={mats.body}>
              <boxGeometry args={[W, H, 0.7]} />
            </mesh>
            {/* screen (faces the car) */}
            <mesh position={[toward * -(W / 2 + 0.02), H * 0.68, 0]} rotation={[0, toward < 0 ? Math.PI / 2 : -Math.PI / 2, 0]} material={mats.screen}>
              <planeGeometry args={[0.55, 0.8]} />
            </mesh>
            {/* status LED strip */}
            <mesh position={[0, H + 0.22, 0]} material={ledFor(s.status)}>
              <boxGeometry args={[W * 0.85, 0.12, 0.5]} />
            </mesh>
            {/* DCFC power cap */}
            {isDC && (
              <mesh position={[0, H + 0.5, 0]} castShadow material={mats.cap}>
                <boxGeometry args={[W + 0.25, 0.35, 0.85]} />
              </mesh>
            )}
            {/* charge cable arcs to the car while the stall is live */}
            {(s.status === 'charging' || s.status === 'occupied' || s.status === 'servicing') && (
              <mesh geometry={CABLES[toward as 1 | -1]}>
                <primitive object={MATERIALS.chargerCable()} attach="material" />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
