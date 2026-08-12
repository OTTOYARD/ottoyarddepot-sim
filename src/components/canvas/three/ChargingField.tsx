import { useMemo } from 'react';
import * as THREE from 'three';
import { useDepotStore } from '@/store/depotStore';
import { towardFor, PEDESTAL_OFFSET_PU } from '@/lib/ottoChargeArm/depotPlacement';
import { DCFC_CABINET_PU, L2_CABINET_PU, CABINET_BACKSET_PU } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { toWorld } from './coordUtils';
import { MATERIALS } from './materials';

/**
 * Charge cable arc, built per side.
 *
 * SIGN: `toward` is the plan-space direction of the canopy spine, and toWorld
 * negates X, so in WORLD space the car sits at +toward from its pedestal —
 * the same convention placeArm() derives its rotation from. This arced the
 * cable to -toward, i.e. out into empty tarmac on the far side of the pedestal,
 * away from the car it is supposedly plugged into. Same mirror as the screen
 * below. It never read as wrong because both stall columns have a pedestal, so
 * every stray cable had a neighbouring pedestal to look like it belonged to.
 */
function cableGeo(toward: number): THREE.TubeGeometry {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(toward * 0.8, 2.1, 0.15),
    new THREE.Vector3(toward * 2.4, 0.9, 0.55),
    new THREE.Vector3(toward * 4.0, 1.5, 0.35),
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

  // ONE SET OF NUMBERS. These used to be literals here, which meant the drawn
  // cabinet and anything reasoning about the cabinet could disagree without
  // anyone noticing — and for the OTTO-CHARGE ARM nothing WAS reasoning about
  // it at all, so the arm swept straight through this box. cabinetEnvelope.ts
  // now derives its collision solid from exactly these values, the same way
  // vehicleEnvelope.ts and vehicleBody.ts share the car's.
  const isDC = type === 'dcfc';
  const dims = isDC ? DCFC_CABINET_PU : L2_CABINET_PU;
  const H = dims.height;
  const W = dims.width;
  const D = dims.depth;

  return (
    <group>
      {list.map((s) => {
        // pedestal sits between the car and its canopy spine — one shared rule,
        // so the cabinet, its arm and the vehicle's charge port cannot disagree
        // about which flank they are all on.
        const toward = towardFor(s.position.x);
        // The ARM stands at the pedestal point; the CABINET now sits behind it.
        // They used to share this point exactly, which put the arm's shoulder
        // inside the box and let the upper arm sweep through it (-0.1675 m,
        // measured). Only DCFC cabinets carry an arm, so only they move.
        const px = s.position.x + toward * PEDESTAL_OFFSET_PU;
        const cabX = px + toward * (isDC ? CABINET_BACKSET_PU : 0);
        const [wx, , wz] = toWorld({ x: cabX, y: s.position.y }, 0);

        return (
          <group key={s.id} position={[wx, 0, wz]}>
            {/* concrete pad. ROTATED with the body: the pad's long axis follows
                the cabinet's wide face, which now runs fore/aft along the car. */}
            <mesh position={[0, 0.08, 0]} receiveShadow>
              <boxGeometry args={[D + 0.8, 0.16, W + 0.6]} />
              <primitive object={mats.cap} attach="material" />
            </mesh>
            {/* pedestal body. TURNED NINETY DEGREES: the WIDE face (W) now runs
                fore/aft along the car and the SHALLOW depth (D) faces it. It used
                to stand edge-on, presenting 1.5 pu of itself along the arm's reach
                axis — which is how the arm came to be buried inside it. Box args
                are world [X, Y, Z] and the arm's reach axis is world X, so the
                rotation IS this swap; there is no rotation prop to keep in sync. */}
            <mesh position={[0, H / 2 + 0.16, 0]} castShadow material={mats.body}>
              <boxGeometry args={[D, H, W]} />
            </mesh>
            {/* screen — on the car's flank of the cabinet, facing it. Ry(theta)
                sends +Z to (sin, 0, cos), so aiming at the car needs
                sin(theta) = toward: exactly the rotation placeArm() gives the
                OTTO-CHARGE ARM on the same pedestal. It used to be mounted on
                the BACK face, pointed at the next row over. */}
            <mesh position={[toward * (D / 2 + 0.02), H * 0.68, 0]} rotation={[0, toward * (Math.PI / 2), 0]} material={mats.screen}>
              <planeGeometry args={[0.55, 0.8]} />
            </mesh>
            {/* status LED strip */}
            <mesh position={[0, H + 0.22, 0]} material={ledFor(s.status)}>
              <boxGeometry args={[D * 0.85, 0.12, W * 0.6]} />
            </mesh>
            {/* DCFC power cap */}
            {isDC && (
              <mesh position={[0, H + 0.5, 0]} castShadow material={mats.cap}>
                <boxGeometry args={[D + 0.25, 0.35, W + 0.2]} />
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
