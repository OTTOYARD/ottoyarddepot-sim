import { useMemo } from 'react';
import * as THREE from 'three';
import { useDepotStore } from '@/store/depotStore';
import { towardFor, PEDESTAL_OFFSET_PU } from '@/lib/ottoChargeArm/depotPlacement';
import { DCFC_CABINET_PU, L2_CABINET_PU, CABINET_BACKSET_PU } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { toWorld, DECK_Y } from './coordUtils';
import { StaticBatch } from './staticBatch';
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

// Coiled cable hanging on an idle L2 pedestal's end face (torus axis on Z).
const COIL = new THREE.TorusGeometry(0.3, 0.055, 6, 18);

/** Charger housing materials: a satin light shell over a graphite plinth, the
 *  way current DC and L2 hardware is finished — and light enough to read
 *  against the asphalt and the canopy's shade, which the old all-dark box did not. */
const HOUSING = {
  shell: () => new THREE.MeshStandardMaterial({ color: '#d4d8dd', roughness: 0.42, metalness: 0.25 }),
  graphite: () => new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.55, metalness: 0.35 }),
  brand: () => new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.45, metalness: 0.2, emissive: new THREE.Color('#c8102e'), emissiveIntensity: 0.25 }),
};

/**
 * Charging pedestals. Gas-pump layout: each stall holds the CAR position;
 * the pedestal stands beside it, toward its canopy's center spine.
 * Pedestal LED reflects live stall status (available/charging/servicing/offline).
 *
 * The HOUSING (pad, shell, plinth, cap, screen bezel, vents, brand line, L2
 * holster) never changes, so it is batched into one buffer per material for
 * the whole field; only the status-driven parts (LED bar, screen, cable, idle
 * coil) are drawn per stall. Everything sits within the cabinet envelope the
 * OTTO-CHARGE ARM is cleared against (cabinetEnvelope.ts) except what faces
 * the car on L2 pedestals, which carry no arm.
 */
export function ChargingField({ type }: Props) {
  const stalls = useDepotStore((s) => s.stalls);
  const list = useMemo(() => stalls.filter((s) => s.type === type), [stalls, type]);

  const mats = useMemo(() => ({
    screen: MATERIALS.screenGlass(),
    teal: MATERIALS.tealLED(1.2),
    green: MATERIALS.greenIndicator(),
    amber: MATERIALS.amberIndicator(),
    red: MATERIALS.tealLED(0.4),
    pad: MATERIALS.darkCladding(),
    shell: HOUSING.shell(),
    graphite: HOUSING.graphite(),
    brand: HOUSING.brand(),
    cable: MATERIALS.chargerCable(),
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
  const P = dims.padHeight;

  // Where each cabinet stands, and which way its car is. The pad stands ON the
  // deck, as cabinetEnvelope's solid (and the arm measured against it) already
  // assumes: "the body's underside is padHeight above the deck". Drawn from
  // y = 0 it sat 0.26u (12 cm) lower than the solid the arm clears.
  const placed = useMemo(() => list.map((s) => {
    // pedestal sits between the car and its canopy spine — one shared rule,
    // so the cabinet, its arm and the vehicle's charge port cannot disagree
    // about which flank they are all on.
    const toward = towardFor(s.position.x);
    // The ARM stands at the pedestal point; the CABINET sits behind it. They
    // used to share this point exactly, which put the arm's shoulder inside the
    // box (-0.1675 m, measured). Only DCFC cabinets carry an arm, so only they move.
    const px = s.position.x + toward * PEDESTAL_OFFSET_PU;
    const cabX = px + toward * (isDC ? CABINET_BACKSET_PU : 0);
    const [wx, , wz] = toWorld({ x: cabX, y: s.position.y }, 0);
    return { s, toward, wx, wz };
  // positions depend only on the layout, not on live status
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [list.map((s) => `${s.id}@${s.position.x},${s.position.y}`).join('|'), isDC]);

  const housing = useMemo(() => {
    const b = new StaticBatch();
    for (const { toward, wx, wz } of placed) {
      const y0 = DECK_Y;
      const face = toward * (D / 2);          // the car-facing face (world X)
      // pad: long axis with the cabinet's wide face, fore/aft along the car
      b.box('pad', wx, y0 + P / 2, wz, D + 0.8, P, W + 0.6);
      // satin shell over a graphite plinth
      b.box('shell', wx, y0 + P + H / 2, wz, D, H, W);
      b.box('graphite', wx, y0 + P + 0.24, wz, D + 0.04, 0.48, W + 0.04);
      // top cap: DCFC carries the power module housing, L2 a thin lid
      if (isDC) b.box('graphite', wx, y0 + P + H + 0.19, wz, D + 0.25, 0.38, W + 0.2);
      else b.box('graphite', wx, y0 + P + H + 0.05, wz, D + 0.08, 0.1, W + 0.08);
      // screen bezel on the car-facing face (the lit screen itself is per stall)
      b.box('graphite', wx + face + toward * 0.012, y0 + P + H * 0.68, wz, 0.024, 1.0, 0.72);
      // brand line under the bezel
      b.box('brand', wx + face + toward * 0.01, y0 + P + H * 0.68 - 0.62, wz, 0.02, 0.06, W * 0.78);
      // cooling vents on the back face, away from the car and the arm
      for (let k = 0; k < 4; k++) {
        b.box('graphite', wx - face - toward * 0.015, y0 + P + 0.95 + k * 0.2, wz, 0.03, 0.07, W * 0.62);
      }
      // L2: connector holster on the car-facing face (no arm on these)
      if (!isDC) {
        b.box('graphite', wx + face + toward * 0.1, y0 + P + 1.35, wz + W * 0.22, 0.2, 0.42, 0.26);
        b.box('pad', wx + face + toward * 0.22, y0 + P + 1.45, wz + W * 0.22, 0.12, 0.28, 0.14);
      }
    }
    return b.build();
  }, [placed, isDC, D, H, W, P]);

  const houseMats: Record<string, THREE.Material> = { pad: mats.pad, shell: mats.shell, graphite: mats.graphite, brand: mats.brand };

  return (
    <group>
      {[...housing.entries()].map(([k, g]) => (
        <mesh key={k} geometry={g} material={houseMats[k]} castShadow={k !== 'brand'} receiveShadow />
      ))}
      {placed.map(({ s, toward, wx, wz }) => {
        const live = s.status === 'charging' || s.status === 'occupied' || s.status === 'servicing';
        return (
          <group key={s.id} position={[wx, DECK_Y, wz]}>
            {/* screen — on the car's flank of the cabinet, facing it. Ry(theta)
                sends +Z to (sin, 0, cos), so aiming at the car needs
                sin(theta) = toward: exactly the rotation placeArm() gives the
                OTTO-CHARGE ARM on the same pedestal. */}
            <mesh position={[toward * (D / 2 + 0.026), P + H * 0.68, 0]} rotation={[0, toward * (Math.PI / 2), 0]} material={mats.screen}>
              <planeGeometry args={[0.6, 0.86]} />
            </mesh>
            {/* status LED bar across the top of the shell */}
            <mesh position={[0, P + H + (isDC ? 0.42 : 0.13), 0]} material={ledFor(s.status)}>
              <boxGeometry args={[D * 0.85, 0.07, W * 0.7]} />
            </mesh>
            {/* charge cable arcs to the car while the stall is live */}
            {live && <mesh geometry={CABLES[toward as 1 | -1]} material={mats.cable} />}
            {/* an idle L2 keeps its cable coiled on the pedestal's end */}
            {!isDC && !live && (
              <mesh geometry={COIL} material={mats.cable} position={[toward * 0.05, P + 1.25, W / 2 + 0.07]} />
            )}
          </group>
        );
      })}
    </group>
  );
}
