import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { BESS_YARD, LIGHT_POLES } from '@/lib/sitePlan';
import { toWorld, DECK_Y } from './coordUtils';
import { StaticBatch } from './staticBatch';

interface UtilityEquipmentProps {
  bessCapacity: number;
  bessPower: number;
}

/**
 * Secured BESS yard (NW corner, own fence + hazard placard) and the
 * overhead commercial light poles for 24/7 operations. From the site plan.
 */
export function UtilityEquipment({ bessCapacity, bessPower }: UtilityEquipmentProps) {
  const mats = useMemo(() => ({
    bess: MATERIALS.darkCladding(),
    panel: MATERIALS.anodizedPanel(),
    steel: MATERIALS.structuralSteel(),
    teal: MATERIALS.tealLED(1.6),
    amber: MATERIALS.amberIndicator(),
    pole: MATERIALS.structuralSteel(),
    head: MATERIALS.whiteLED(1.8),
  }), []);

  const [bx, , bz] = toWorld({ x: BESS_YARD.x + BESS_YARD.w / 2, y: BESS_YARD.y + BESS_YARD.h / 2 }, 0);
  const containers = Math.max(2, Math.min(4, Math.round(bessCapacity)));
  const yard = useMemo(() => buildBessYard(containers), [containers]);
  const yardMats = useMemo<Record<string, THREE.Material>>(() => ({
    shell: new THREE.MeshStandardMaterial({ color: '#cdd2d8', roughness: 0.5, metalness: 0.2 }),
    seam: new THREE.MeshStandardMaterial({ color: '#8d959e', roughness: 0.6, metalness: 0.3 }),
    skid: MATERIALS.darkCladding(),
    steel: MATERIALS.structuralSteel(),
    transformer: new THREE.MeshStandardMaterial({ color: '#56705a', roughness: 0.6, metalness: 0.25 }),
    hazard: new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.6 }),
    teal: MATERIALS.tealLED(1.6),
    pad: MATERIALS.polishedConcrete(),
  }), []);
  void bessPower;

  return (
    <group>
      {/* ---- BESS yard: battery enclosures, PCS skid, transformer, fenced ---- */}
      <group position={[bx, DECK_Y, bz]}>
        {[...yard.entries()].map(([k, g]) => (
          <mesh key={k} geometry={g} material={yardMats[k]} castShadow={k !== 'pad' && k !== 'teal'} receiveShadow />
        ))}
        {/* chain-link infill (translucent), one panel per side */}
        {[
          { x: 0, z: -BESS_YARD.h / 2, len: BESS_YARD.w, rot: 0 },
          { x: 0, z: BESS_YARD.h / 2, len: BESS_YARD.w, rot: 0 },
          { x: -BESS_YARD.w / 2, z: 0, len: BESS_YARD.h, rot: Math.PI / 2 },
          { x: BESS_YARD.w / 2, z: 0, len: BESS_YARD.h, rot: Math.PI / 2 },
        ].map((f, i) => (
          <mesh key={i} position={[f.x, 2.2, f.z]} rotation={[0, f.rot, 0]}>
            <boxGeometry args={[f.len, 4.0, 0.03]} />
            <meshStandardMaterial color="#15181d" roughness={0.8} metalness={0.6} transparent opacity={0.28} />
          </mesh>
        ))}
        {/* hazard placard on the south fence */}
        <mesh position={[0, 3.2, BESS_YARD.h / 2 + 0.08]} material={mats.amber}>
          <boxGeometry args={[7, 1.6, 0.08]} />
        </mesh>
      </group>

      {/* ---- site light poles (24/7 ops) ---- */}
      {LIGHT_POLES.map((p, i) => {
        const [wx, , wz] = toWorld({ x: p.x, y: p.y }, 0);
        return (
          <group key={i} position={[wx, 0, wz]}>
            <mesh position={[0, 9, 0]} castShadow material={mats.pole}>
              <cylinderGeometry args={[0.28, 0.4, 18, 8]} />
            </mesh>
            <mesh position={[2.6, 17.7, 0]} material={mats.pole}>
              <boxGeometry args={[5.2, 0.3, 0.3]} />
            </mesh>
            <mesh position={[5, 17.5, 0]} material={mats.head}>
              <boxGeometry args={[2.6, 0.5, 1.3]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * The BESS yard's equipment, in yard-local world units (x across, z along),
 * batched by material. Battery enclosures stand in a row on steel skids with
 * door seams, thermal units on the roof and a status strip; the power
 * conversion skid and a finned pad-mount transformer take their own column at
 * the +x end, so the row can never grow into them (it used to overlap the
 * inverters once the row reached four).
 */
function buildBessYard(n: number): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const W = BESS_YARD.w, D = BESS_YARD.h;
  b.box('pad', 0, 0.02, 0, W - 2, 0.04, D - 2);
  // fence posts + top rail
  for (let x = -W / 2; x <= W / 2 + 1e-6; x += 5) {
    for (const z of [-D / 2, D / 2]) b.box('steel', x, 2.2, z, 0.16, 4.4, 0.16);
  }
  for (let z = -D / 2 + 5; z < D / 2; z += 5) {
    for (const x of [-W / 2, W / 2]) b.box('steel', x, 2.2, z, 0.16, 4.4, 0.16);
  }
  b.box('steel', 0, 4.35, -D / 2, W, 0.1, 0.1);
  b.box('steel', 0, 4.35, D / 2, W, 0.1, 0.1);
  b.box('steel', -W / 2, 4.35, 0, 0.1, 0.1, D);
  b.box('steel', W / 2, 4.35, 0, 0.1, 0.1, D);

  // battery enclosures: 7u wide, 16u long, 5.4u tall, on 0.4u skids
  const CW = 7, CL = 16, CH = 5.4, GAP = 2;
  const rowW = n * CW + (n - 1) * GAP;
  const x0 = -W / 2 + 3 + CW / 2 + (W - 15 - rowW) / 2;
  for (let i = 0; i < n; i++) {
    const cx = x0 + i * (CW + GAP);
    b.box('skid', cx, 0.24, 0, CW + 0.3, 0.4, CL + 0.3);
    b.box('shell', cx, 0.44 + CH / 2, 0, CW, CH, CL);
    // door seams down both long faces
    for (let k = -3; k <= 3; k++) {
      for (const side of [-1, 1]) b.box('seam', cx + side * (CW / 2 + 0.01), 0.44 + CH / 2, k * 2.2, 0.03, CH - 0.5, 0.06);
    }
    // roof thermal units
    for (const z of [-4.5, 0, 4.5]) b.box('seam', cx, 0.44 + CH + 0.45, z, CW - 1.6, 0.9, 3.2);
    // status strip + hazard labels
    b.box('teal', cx + CW / 2 + 0.03, 0.44 + CH - 0.6, 0, 0.04, 0.22, CL - 4);
    for (const z of [-CL / 2 + 1.2, CL / 2 - 1.2]) b.box('hazard', cx + CW / 2 + 0.03, 0.44 + CH * 0.55, z, 0.04, 0.9, 0.9);
  }
  // cable trench from the row to the equipment column
  b.box('skid', (x0 + (W / 2 - 7)) / 2, 0.08, -D / 2 + 3.5, W / 2 - 7 - x0, 0.12, 1.2);

  // equipment column at the +x end: PCS skid (two cabinets) and a transformer
  const ex = W / 2 - 6.5;
  b.box('skid', ex, 0.2, -8, 8, 0.4, 7);
  for (const dz of [-1.7, 1.7]) {
    b.box('shell', ex, 0.4 + 2.2, -8 + dz, 6, 4.4, 2.6);
    for (let k = 0; k < 5; k++) b.box('seam', ex - 3.02, 1.2 + k * 0.6, -8 + dz, 0.04, 0.25, 2.0);
  }
  b.box('transformer', ex, 0.2 + 2.1, 7, 5.2, 4.2, 5.6);
  for (let k = -2; k <= 2; k++) {
    for (const side of [-1, 1]) b.box('transformer', ex + side * 2.9, 0.2 + 1.9, 7 + k * 0.9, 0.6, 3.2, 0.12);
  }
  b.box('hazard', ex - 2.62, 3.0, 7, 0.04, 1.0, 1.4);
  return b.build();
}
