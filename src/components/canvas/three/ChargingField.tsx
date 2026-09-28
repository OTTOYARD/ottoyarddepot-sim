import { useMemo } from 'react';
import * as THREE from 'three';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { CAR_W_PU } from './vehicleBody';
import { towardFor, chargerCabinet } from '@/lib/ottoChargeArm/depotPlacement';
import { DCFC_CABINET_PU, L2_CABINET_PU, L2_POST_ALONG_PU, L2_POST_LATERAL_PU } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { toWorld, DECK_Y } from './coordUtils';
import { StaticBatch } from './staticBatch';
import { MATERIALS } from './materials';

interface Props { type: 'dcfc' | 'l2'; count: number; }

/**
 * An L2 charge cable, in the POST'S OWN frame (the per-stall group: origin on the
 * deck under the cabinet centre, local +X square to the car and toward it, local +Z
 * along the car — toward its nose on a west column, its tail on an east column, i.e.
 * toward·forward). The post stands beside the car's front quarter on its charge-port
 * flank (cabinetEnvelope.L2_POST_*), so the car's centreline is L2_POST_LATERAL_PU
 * out along local +X and its centre L2_POST_ALONG_PU back along the car. The cable
 * leaves the holster, drops in front of the post, crosses the 1.15u gap low and
 * rises to the car's own charge port — the port Vehicle3D draws (portFor, on the
 * flank facing this post).
 */
function l2CableGeo(toward: 1 | -1, alongM: number, heightM: number, holster: { x: number; y: number; z: number }): THREE.TubeGeometry {
  const flank = L2_POST_LATERAL_PU - CAR_W_PU / 2;                 // the car's port flank, local x
  const portZ = toward * (alongM * PLAN_UNITS_PER_METRE - L2_POST_ALONG_PU); // along the car from the post
  const pts = [
    new THREE.Vector3(holster.x, holster.y, holster.z),
    new THREE.Vector3(holster.x + 0.2, 0.55, holster.z * 0.6 + portZ * 0.4),
    new THREE.Vector3(flank - 0.45, 0.3, (holster.z + portZ) / 2),
    new THREE.Vector3(flank - 0.2, Math.max(0.35, heightM * PLAN_UNITS_PER_METRE * 0.6), portZ),
    new THREE.Vector3(flank - 0.05, heightM * PLAN_UNITS_PER_METRE, portZ),
  ];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.08, 6);
}

/** Where the connector hangs on an L2 post (the holster drawn on its car-facing face,
 *  local +X), in the per-stall group's frame — derived from the cabinet's own
 *  dimensions, toward the car's nose. */
const holsterAt = (toward: 1 | -1) => ({
  x: L2_CABINET_PU.depth / 2 + 0.2, y: L2_CABINET_PU.padHeight + 1.35, z: toward * L2_CABINET_PU.width * 0.22,
});
const L2_HOLSTER = { 1: holsterAt(1), [-1]: holsterAt(-1) } as Record<1 | -1, { x: number; y: number; z: number }>;

function L2Cable({ toward, vehicleId, oem, holster, material }: {
  toward: 1 | -1; vehicleId: string | null; oem: string | undefined;
  holster: { x: number; y: number; z: number }; material: THREE.Material;
}) {
  const geo = useMemo(() => {
    const p = vehicleId ? portFor(vehicleId, oem) : { along: 0, height: 0.7 };
    return l2CableGeo(toward, p.along, p.height, holster);
  }, [toward, vehicleId, oem, holster]);
  return <mesh geometry={geo} material={material} />;
}

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
 * Charging pedestals. Every charger stall is ANGLED 60° to its lane
 * (sitePlan.chargingStalls): each stall holds the CAR position, and its cabinet
 * stands where the car's charger is, on the car's charge-port flank, turned with
 * the car and its wide face along it (depotPlacement.chargerCabinet) —
 *   - DCFC: abeam the car's centre, behind the OTTO-CHARGE ARM that stands on the
 *     same line (depotPlacement.pedestalPlanPoint);
 *   - L2: beside the car's front quarter (cabinetEnvelope.L2_POST_*).
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
  // The OEM of each car parked at one of these stalls (its charge port depends on it).
  // A string, so this re-renders only when a parked car or its OEM changes.
  const oemKey = useVehicleStore((st) => {
    const parked = new Set(list.map((s) => s.vehicleId).filter(Boolean));
    return st.vehicles.filter((v) => parked.has(v.id)).map((v) => `${v.id}=${v.oem ?? ''}`).sort().join('|');
  });
  const oemOf = useMemo(() => new Map(oemKey ? oemKey.split('|').map((kv) => kv.split('=') as [string, string]) : []), [oemKey]);

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
  //
  // (fx, fz) is the WORLD unit vector from the cabinet toward its car, square to
  // the car, and each stall's group is yawed so its local +X is that vector; local
  // +Z is then (-fz, fx), which runs along the car. The same point and the same
  // turn as structurePlan.cabinetFootprints, which the clearance tests drive cars
  // against — both read depotPlacement.chargerCabinet.
  const placed = useMemo(() => list.map((s) => {
    const toward = towardFor(s.position.x);
    const cab = chargerCabinet(isDC ? 'dcfc' : 'l2', s.position.x, s.position.y, s.position.angle);
    const [wx, , wz] = toWorld(cab, 0);
    // toWorld negates both plan axes
    const fx = -cab.face.x, fz = -cab.face.y;
    // Ry(yaw) sends local +X to (cos yaw, 0, -sin yaw)
    const yaw = Math.atan2(-fz, fx);
    return { s, toward, wx, wz, fx, fz, yaw };
  // positions depend only on the layout, not on live status
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [list.map((s) => `${s.id}@${s.position.x},${s.position.y},${s.position.angle}`).join('|'), isDC]);

  const housing = useMemo(() => {
    const b = new StaticBatch();
    for (const { wx, wz, fx, fz, yaw, toward } of placed) {
      const y0 = DECK_Y;
      // One box, placed `f` toward the car and `a` along local +Z (along the car),
      // sized `sf` on the car-facing axis and `sa` along the car, and turned with it.
      const put = (k: string, f: number, y: number, a: number, sf: number, sy: number, sa: number) =>
        b.box(k, wx + fx * f - fz * a, y, wz + fz * f + fx * a, sf, sy, sa, yaw);
      // pad: long axis with the cabinet's wide face, along the car
      put('pad', 0, y0 + P / 2, 0, D + 0.8, P, W + 0.6);
      // satin shell over a graphite plinth
      put('shell', 0, y0 + P + H / 2, 0, D, H, W);
      put('graphite', 0, y0 + P + 0.24, 0, D + 0.04, 0.48, W + 0.04);
      // top cap: DCFC carries the power module housing, L2 a thin lid
      if (isDC) put('graphite', 0, y0 + P + H + 0.19, 0, D + 0.25, 0.38, W + 0.2);
      else put('graphite', 0, y0 + P + H + 0.05, 0, D + 0.08, 0.1, W + 0.08);
      // screen bezel on the car-facing face (the lit screen itself is per stall)
      put('graphite', D / 2 + 0.012, y0 + P + H * 0.68, 0, 0.024, 1.0, 0.72);
      // brand line under the bezel
      put('brand', D / 2 + 0.01, y0 + P + H * 0.68 - 0.62, 0, 0.02, 0.06, W * 0.78);
      // cooling vents on the back face, away from the car and the arm
      for (let k = 0; k < 4; k++) {
        put('graphite', -D / 2 - 0.015, y0 + P + 0.95 + k * 0.2, 0, 0.03, 0.07, W * 0.62);
      }
      // L2: connector holster on the car-facing face (no arm on these)
      if (!isDC) {
        put('graphite', D / 2 + 0.1, y0 + P + 1.35, toward * W * 0.22, 0.2, 0.42, 0.26);
        put('pad', D / 2 + 0.22, y0 + P + 1.45, toward * W * 0.22, 0.12, 0.28, 0.14);
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
      {placed.map(({ s, toward, wx, wz, yaw }) => {
        const live = s.status === 'charging' || s.status === 'occupied' || s.status === 'servicing';
        return (
          <group key={s.id} position={[wx, DECK_Y, wz]} rotation={[0, yaw, 0]}>
            {/* screen — on the car-facing face of the cabinet (local +X). A plane's
                normal is +Z, and Ry(pi/2) turns it to +X. */}
            <mesh position={[D / 2 + 0.026, P + H * 0.68, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.screen}>
              <planeGeometry args={[0.6, 0.86]} />
            </mesh>
            {/* status LED bar across the top of the shell */}
            <mesh position={[0, P + H + (isDC ? 0.42 : 0.13), 0]} material={ledFor(s.status)}>
              <boxGeometry args={[D * 0.85, 0.07, W * 0.7]} />
            </mesh>
            {/* an L2 cable runs across to the car's own port while the stall is live;
                a DCFC car is plugged by its OTTO-CHARGE ARM, which draws its own */}
            {live && !isDC && (
              <L2Cable toward={toward as 1 | -1} vehicleId={s.vehicleId} oem={s.vehicleId ? oemOf.get(s.vehicleId) || undefined : undefined}
                holster={L2_HOLSTER[toward as 1 | -1]} material={mats.cable} />
            )}
            {/* an idle L2 keeps its cable coiled on the pedestal's end */}
            {!isDC && !live && (
              <mesh geometry={COIL} material={mats.cable} position={[0.05, P + 1.25, toward * (W / 2 + 0.07)]} />
            )}
          </group>
        );
      })}
    </group>
  );
}
