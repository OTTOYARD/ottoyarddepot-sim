import { useMemo } from 'react';
import * as THREE from 'three';
import { OPS_SHELL } from '@/lib/structurePlan';
import { BuildingShell } from './BuildingShell';
import { StaticBatch, rod } from './staticBatch';
import { MATERIALS } from './materials';
import { logoSignMaterial, LOGO_SIGN_ASPECT } from './textures';
import {
  officeGlass, aluminiumTrim, wallGraphite, darkSteel, galvanizedSteel, ledPanel,
} from './buildingSkin';

/**
 * Operations building: a two-storey OPS CENTRE (west) and two PULL-THROUGH
 * service bays (east), drawn from structurePlan.OPS_SHELL. The bays are real
 * openings at both ends (BuildingShell); this component adds the office's
 * curtain wall, entrance, windows, signage and the rooftop plant.
 */

const GLAZING = { x0: OPS_SHELL.footprint.x0 + 2, x1: (OPS_SHELL.office?.x1 ?? 111) - 2 };
const SOUTH_GLAZING = { ...GLAZING, y0: OPS_SHELL.footprint.y1 - OPS_SHELL.wallT, y1: OPS_SHELL.footprint.y1 };
const DECK = OPS_SHELL.height - OPS_SHELL.parapet;
const SILL = 0.9;          // glazing starts above a 0.43 m base curb
const HEAD = DECK - 0.9;   // and stops under a 0.43 m fascia band
const FLOOR2 = 6.2;        // second-floor slab line (2.97 m)
const ENTRY = { x0: GLAZING.x0 + 1.5, x1: GLAZING.x0 + 7.5 };

export function DepotBuilding() {
  const geos = useMemo(() => buildOffice(), []);
  const mats = useMemo<Record<string, THREE.Material>>(() => ({
    glass: officeGlass(),
    trim: aluminiumTrim(),
    skin: wallGraphite(),
    steel: darkSteel(),
    galv: galvanizedSteel(),
    red: new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.45, metalness: 0.2, emissive: new THREE.Color('#c8102e'), emissiveIntensity: 0.25 }),
    led: ledPanel(1.8),
    pv: MATERIALS.solarPanelGlass(),
  }), []);

  // the OTTOYARD logo on the parapet (founder, 2026-09-30), at the height the
  // lettered sign had, as wide as the logo is
  const sign = useMemo(() => logoSignMaterial(0.55), []);

  const f = OPS_SHELL.footprint;
  const signH = Math.min(26, GLAZING.x1 - GLAZING.x0 - 4) / 6.4;
  const signW = signH * LOGO_SIGN_ASPECT;
  const signX = 150 - (GLAZING.x0 + GLAZING.x1) / 2;

  return (
    <group>
      <BuildingShell shell={OPS_SHELL} skin="graphite" southGlazing={SOUTH_GLAZING} />
      {[...geos.entries()].map(([key, g]) => (
        <mesh key={key} geometry={g} material={mats[key]} castShadow={key !== 'led' && key !== 'glass'} receiveShadow />
      ))}
      {/* OTTOYARD logo sign on the parapet over the ops centre, stood 0.6u proud of the
          face so the parapet coping and trim (0.3u proud) run behind it, not across it */}
      <mesh position={[signX, OPS_SHELL.height - OPS_SHELL.parapet / 2, 110 - f.y1 - 0.6]} rotation={[0, Math.PI, 0]} material={sign}>
        <planeGeometry args={[signW, signH]} />
      </mesh>
    </group>
  );
}

function buildOffice(): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const f = OPS_SHELL.footprint;
  const yFace = f.y1;              // south exterior face (plan)
  const band = (d0: number, d1: number) => ({ y0: yFace - d1, y1: yFace - d0 }); // inside the wall

  // ── south curtain wall ─────────────────────────────────────────────────────
  // base curb + fascia band close the glazed bay top and bottom
  b.planBox('skin', { ...GLAZING, ...band(0, OPS_SHELL.wallT) }, 0, SILL);
  b.planBox('skin', { ...GLAZING, ...band(0, OPS_SHELL.wallT) }, HEAD, DECK);
  // glass, set back 0.25 from the face
  b.planBox('glass', { ...GLAZING, ...band(0.25, 0.4) }, SILL, HEAD);
  // mullions every ~3.4u, proud of the glass
  const nMul = Math.round((GLAZING.x1 - GLAZING.x0) / 3.4);
  for (let i = 0; i <= nMul; i++) {
    const x = GLAZING.x0 + ((GLAZING.x1 - GLAZING.x0) * i) / nMul;
    b.planBox('trim', { x0: x - 0.13, x1: x + 0.13, ...band(-0.15, 0.3) }, SILL, HEAD);
  }
  // second-floor spandrel + sill/head rails
  b.planBox('skin', { ...GLAZING, ...band(-0.05, 0.3) }, FLOOR2 - 0.35, FLOOR2 + 0.35);
  for (const y of [SILL, HEAD]) b.planBox('trim', { ...GLAZING, ...band(-0.12, 0.3) }, y - 0.12, y + 0.12);
  // brand accent: a red reveal under the fascia
  b.planBox('red', { ...GLAZING, ...band(-0.08, 0.1) }, HEAD + 0.05, HEAD + 0.25);

  // ── entrance: glass doors + a canopy HUNG from the wall on two tie rods ─────
  b.planBox('steel', { ...ENTRY, ...band(0.2, 0.42) }, SILL, 3.9);         // door frame backing
  b.planBox('glass', { x0: ENTRY.x0 + 0.3, x1: ENTRY.x1 - 0.3, ...band(0.1, 0.2) }, 0.3, 3.6);
  const canopy = { x0: ENTRY.x0 - 1.0, x1: ENTRY.x1 + 1.0, y0: yFace, y1: yFace + 2.6 };
  b.planBox('steel', canopy, 4.35, 4.65);
  b.planBox('led', { x0: canopy.x0 + 0.6, x1: canopy.x1 - 0.6, y0: canopy.y0 + 0.6, y1: canopy.y1 - 0.6 }, 4.3, 4.35);
  // tie rods: from each outer canopy corner up to the wall at 7.2 (so it is carried, not floating)
  for (const x of [canopy.x0 + 0.4, canopy.x1 - 0.4]) {
    const p0 = new THREE.Vector3(150 - x, 4.65, 110 - (canopy.y1 - 0.2));
    const p1 = new THREE.Vector3(150 - x, 7.2, 110 - yFace);
    b.geometry('galv', rod(p0, p1, 0.07));
  }

  // ── west + north windows on the office block (two storeys) ─────────────────
  const office = OPS_SHELL.office!;
  for (const [z0, z1] of [[2.0, 4.8], [7.3, 10.2]]) {
    // west face (plan x0 exterior), proud 0.06
    b.planBox('glass', { x0: f.x0 - 0.06, x1: f.x0 + 0.1, y0: f.y0 + 3, y1: f.y1 - 3 }, z0, z1);
    b.planBox('trim', { x0: f.x0 - 0.14, x1: f.x0 + 0.02, y0: f.y0 + 3, y1: f.y1 - 3 }, z0 - 0.1, z0 + 0.05);
    b.planBox('trim', { x0: f.x0 - 0.14, x1: f.x0 + 0.02, y0: f.y0 + 3, y1: f.y1 - 3 }, z1 - 0.05, z1 + 0.1);
    // north face over the office (plan y0 exterior)
    b.planBox('glass', { x0: office.x0 + 4, x1: office.x1 - 6, y0: f.y0 - 0.1, y1: f.y0 + 0.06 }, z0, z1);
  }
  // rear staff door
  b.planBox('steel', { x0: office.x1 - 5, x1: office.x1 - 2.8, y0: f.y0 - 0.12, y1: f.y0 + 0.05 }, 0.28, 4.2);

  // ── rooftop plant + PV (inside the parapet, clear of it by 1.5u) ────────────
  const roofY = DECK;
  for (const [x0, y0, w, d] of [[office.x0 + 4, f.y0 + 4, 5, 4], [office.x0 + 12, f.y0 + 4, 5, 4]]) {
    b.planBox('galv', { x0, x1: x0 + w, y0, y1: y0 + d }, roofY, roofY + 2.4);
    b.planBox('steel', { x0: x0 + 0.5, x1: x0 + w - 0.5, y0: y0 + 0.5, y1: y0 + d - 0.5 }, roofY + 2.4, roofY + 2.5);
  }
  // PV: one tilted row set over the office east half and both bays (south-facing tilt)
  for (let x = office.x0 + 20; x + 4.2 <= f.x1 - 1.6; x += 4.6) {
    for (let y = f.y0 + 11; y + 4 <= f.y1 - 2; y += 6) {
      const g = new THREE.BoxGeometry(4.2, 0.12, 4.0);
      g.rotateX(-0.17); // ~10° tilt: north edge up, so the panels face south (world -Z)
      g.translate(150 - (x + 2.1), roofY + 0.9, 110 - (y + 2));
      b.geometry('pv', g);
      // rack legs
      b.planBox('galv', { x0: x + 0.3, x1: x + 0.5, y0: y + 3.2, y1: y + 3.4 }, roofY, roofY + 1.2);
      b.planBox('galv', { x0: x + 3.7, x1: x + 3.9, y0: y + 3.2, y1: y + 3.4 }, roofY, roofY + 1.2);
    }
  }
  return b.build();
}
