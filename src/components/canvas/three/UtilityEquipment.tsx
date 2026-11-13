import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS, chainLink, ribbed, weathered } from './materials';
import { dangerSignTexture } from './textures';
import { AUX_TRANSFORMER, BESS_YARD, CHARGER_TRANSFORMERS, LIGHT_POLES, MV_SWITCHGEAR, TX_PAD, TX_YARD } from '@/lib/sitePlan';
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
  const [tx, , tz] = toWorld({ x: TX_YARD.x + TX_YARD.w / 2, y: TX_YARD.y + TX_YARD.h / 2 }, 0);
  const txYard = useMemo(() => buildTransformerYard(), []);
  const yardMats = useMemo<Record<string, THREE.Material>>(() => ({
    shell: ribbed(new THREE.MeshStandardMaterial({ color: '#cdd2d8', roughness: 0.5, metalness: 0.2 })),
    seam: new THREE.MeshStandardMaterial({ color: '#8d959e', roughness: 0.6, metalness: 0.3 }),
    skid: MATERIALS.darkCladding(),
    steel: MATERIALS.structuralSteel(),
    transformer: weathered(new THREE.MeshStandardMaterial({ color: '#56705a', roughness: 0.6, metalness: 0.25 }), 4),
    hazard: new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.6 }),
    teal: MATERIALS.tealLED(1.6),
    pad: MATERIALS.polishedConcrete(),
  }), []);
  // chain-link infill for the two yards' fences, one material per panel length
  const bessFence = useMemo(() => ({ w: chainLink(BESS_YARD.w, 4), d: chainLink(BESS_YARD.h, 4) }), []);
  const txFence = useMemo(() => ({ w: chainLink(TX_YARD.w, 4), d: chainLink(TX_YARD.h, 4) }), []);
  const danger = useMemo(() => {
    const map = dangerSignTexture();
    return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.12, roughness: 0.6 });
  }, []);
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
          <mesh key={i} position={[f.x, 2.2, f.z]} rotation={[0, f.rot, 0]} material={f.len === BESS_YARD.w ? bessFence.w : bessFence.d}>
            <planeGeometry args={[f.len, 4.0]} />
          </mesh>
        ))}
        {/* hazard placard on the south fence */}
        <mesh position={[0, 3.2, BESS_YARD.h / 2 + 0.08]} material={mats.steel}>
          <boxGeometry args={[7.2, 1.8, 0.08]} />
        </mesh>
        {[1, -1].map((side) => (
          <mesh key={side} position={[0, 3.2, BESS_YARD.h / 2 + 0.08 + side * 0.05]} rotation-y={side > 0 ? 0 : Math.PI} material={danger}>
            <planeGeometry args={[7, 1.62]} />
          </mesh>
        ))}
      </group>

      {/* ---- transformer yard behind the office: the six charger transformers of the one-line ---- */}
      <group position={[tx, DECK_Y, tz]}>
        {[...txYard.entries()].map(([k, g]) => (
          <mesh key={k} geometry={g} material={yardMats[k]} castShadow={k !== 'pad'} receiveShadow />
        ))}
        {[
          { x: 0, z: -TX_YARD.h / 2, len: TX_YARD.w, rot: 0 },
          { x: 0, z: TX_YARD.h / 2, len: TX_YARD.w, rot: 0 },
          { x: -TX_YARD.w / 2, z: 0, len: TX_YARD.h, rot: Math.PI / 2 },
          { x: TX_YARD.w / 2, z: 0, len: TX_YARD.h, rot: Math.PI / 2 },
        ].map((f, i) => (
          <mesh key={i} position={[f.x, 2.2, f.z]} rotation={[0, f.rot, 0]} material={f.len === TX_YARD.w ? txFence.w : txFence.d}>
            <planeGeometry args={[f.len, 4.0]} />
          </mesh>
        ))}
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
  // TX-AUX (battery, building, solar), where the site plan stands it, and the primary switchgear along the north
  // fence: one section per transformer feeder and one for the utility's incoming line.
  const c = { x: BESS_YARD.x + W / 2, y: BESS_YARD.y + D / 2 };
  padMount(b, -(AUX_TRANSFORMER.x - c.x), -(AUX_TRANSFORMER.y - c.y));
  const sx = -(MV_SWITCHGEAR.x - c.x), sz = -(MV_SWITCHGEAR.y - c.y);
  b.box('skid', sx, 0.14, sz, MV_SWITCHGEAR.w + 0.8, 0.2, MV_SWITCHGEAR.d + 0.8);
  b.box('shell', sx, 0.24 + MV_SWITCHGEAR.h / 2, sz, MV_SWITCHGEAR.w, MV_SWITCHGEAR.h, MV_SWITCHGEAR.d);
  for (let k = 0; k < 8; k++) {
    const kx = sx - MV_SWITCHGEAR.w / 2 + (k + 0.5) * (MV_SWITCHGEAR.w / 8);
    b.box('seam', kx + MV_SWITCHGEAR.w / 16, 0.24 + MV_SWITCHGEAR.h / 2, sz - MV_SWITCHGEAR.d / 2 - 0.01, 0.05, MV_SWITCHGEAR.h - 0.4, 0.03);
    b.box('hazard', kx, 0.24 + MV_SWITCHGEAR.h * 0.72, sz - MV_SWITCHGEAR.d / 2 - 0.02, 0.7, 0.5, 0.03);
  }
  return b.build();
}

/** One pad-mounted transformer at a yard-local point: concrete pad, tank, cooling fins both sides, hazard label on
 *  its south (front) face. World +X is west and +Z is north, so a plan offset is negated on both axes by the caller. */
function padMount(b: StaticBatch, lx: number, lz: number) {
  b.box('skid', lx, 0.1, lz, TX_PAD.w + 1.4, 0.2, TX_PAD.d + 1.4);
  b.box('transformer', lx, 0.2 + TX_PAD.h / 2, lz, TX_PAD.w, TX_PAD.h, TX_PAD.d);
  for (let k = -2; k <= 2; k++) {
    for (const side of [-1, 1]) b.box('transformer', lx + side * (TX_PAD.w / 2 + 0.3), 0.2 + TX_PAD.h * 0.45, lz + k * 0.8, 0.6, TX_PAD.h * 0.76, 0.12);
  }
  b.box('hazard', lx, 0.2 + TX_PAD.h * 0.7, lz - TX_PAD.d / 2 - 0.02, 1.4, 1.0, 0.04);
}

/**
 * The transformer yard behind the office, in yard-local world units: a concrete pad, a fence, and the six charger
 * transformers in one row with their fronts to the south, where the working room is.
 */
function buildTransformerYard(): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const W = TX_YARD.w, D = TX_YARD.h;
  const c = { x: TX_YARD.x + W / 2, y: TX_YARD.y + D / 2 };
  b.box('pad', 0, 0.02, 0, W - 1, 0.04, D - 1);
  for (let x = -W / 2; x <= W / 2 + 1e-6; x += W / 8) {
    for (const z of [-D / 2, D / 2]) b.box('steel', x, 2.2, z, 0.16, 4.4, 0.16);
  }
  for (const x of [-W / 2, W / 2]) b.box('steel', x, 2.2, 0, 0.16, 4.4, 0.16);
  b.box('steel', 0, 4.35, -D / 2, W, 0.1, 0.1);
  b.box('steel', 0, 4.35, D / 2, W, 0.1, 0.1);
  b.box('steel', -W / 2, 4.35, 0, 0.1, 0.1, D);
  b.box('steel', W / 2, 4.35, 0, 0.1, 0.1, D);
  for (const t of CHARGER_TRANSFORMERS) padMount(b, -(t.x - c.x), -(t.y - c.y));
  // the feeders' trench along the north fence, back toward the switchgear
  b.box('skid', 0, 0.08, D / 2 - 1.6, W - 3, 0.12, 1.0);
  return b.build();
}
