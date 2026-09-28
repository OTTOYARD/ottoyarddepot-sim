import { useMemo } from 'react';
import * as THREE from 'three';
import { CANOPIES, generateStallsV2 } from '@/lib/sitePlan';
import { canopyColumnYs, cabinetFootprints, CANOPY_COLUMN } from '@/lib/structurePlan';
import { StaticBatch } from './staticBatch';
import { MATERIALS } from './materials';
import { galvanizedSteel, darkSteel, hazardBand, ledPanel, aluminiumTrim } from './buildingSkin';

/**
 * The three central charging canopies (site plan: A = DCFC, B/C = L2).
 *
 * CENTRAL-SPINE STRUCTURE, drawn as a steel fabricator would build it:
 *   concrete pier (hazard-banded) -> square HSS column on the spine -> a ridge
 *   girder along the spine -> tapered cantilever RAFTERS off every column to
 *   both eaves -> PURLINS along the canopy -> PV MODULES on the purlins.
 * The roof is carried at every point by something you can see; nothing floats.
 *
 * Columns come from structurePlan.canopyColumnYs(), which places them clear of
 * every charger cabinet and every parked car's body (the old fixed 19u pitch put
 * three columns THROUGH cabinets), keeps every span <= 17u, and stands one near
 * each roof end. A cable tray runs under the girder; the chargers, which stand
 * beside their cars off the spine, are fed from below.
 */

const R = 13;      // ridge height at the spine (6.2 m)
const E = 10.5;    // eave height (5.0 m)
const HALF = 15;   // spine to eave, plan units

/** Roof underside height at `d` units out from the spine. */
const roofAt = (d: number) => R - ((R - E) * d) / HALF;
const SLOPE = Math.atan2(R - E, HALF);

export function SolarCanopy({ solarKWdc }: { solarKWdc: number }) {
  const geos = useMemo(() => build(), []);
  const ledI = Math.min(2.6, 1.4 + solarKWdc / 900);
  const mats = useMemo<Record<string, THREE.Material>>(() => ({
    steel: galvanizedSteel(),
    dark: darkSteel(),
    trim: aluminiumTrim(),
    hazard: hazardBand(),
    pier: MATERIALS.polishedConcrete(),
    pv: MATERIALS.solarPanelGlass(),
    led: ledPanel(ledI),
  }), [ledI]);
  return (
    <group>
      {[...geos.entries()].map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k]} castShadow={k !== 'led'} receiveShadow={k !== 'pv' && k !== 'led'} />
      ))}
    </group>
  );
}

function build(): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const cabs = cabinetFootprints(generateStallsV2());
  const hc = CANOPY_COLUMN / 2;
  for (const c of CANOPIES) {
    const wx = 150 - c.cx;
    const y0 = c.y, y1 = c.y + c.h;
    const ys = canopyColumnYs(c, cabs);

    // ── piers + columns ──
    for (const y of ys) {
      b.planBox('pier', { x0: c.cx - 1.0, x1: c.cx + 1.0, y0: y - 1.0, y1: y + 1.0 }, 0, 0.5);
      b.planBox('hazard', { x0: c.cx - 0.8, x1: c.cx + 0.8, y0: y - 0.8, y1: y + 0.8 }, 0.5, 1.7);
      b.planBox('steel', { x0: c.cx - hc, x1: c.cx + hc, y0: y - hc, y1: y + hc }, 1.7, R - 1.0);
      // cap plate + knee plates under the girder
      b.planBox('dark', { x0: c.cx - hc - 0.25, x1: c.cx + hc + 0.25, y0: y - hc - 0.25, y1: y + hc + 0.25 }, R - 1.1, R - 1.0);
    }

    // ── ridge girder along the spine ──
    b.planBox('steel', { x0: c.cx - 0.5, x1: c.cx + 0.5, y0: y0 + 0.3, y1: y1 - 0.3 }, R - 1.0, R - 0.1);

    // ── cantilever rafters off each column, both sides, tapered ──
    for (const y of ys) {
      for (const side of [-1, 1]) b.geometry('steel', rafter(wx, 110 - y, side));
    }
    // edge rafters at both roof ends (carried by the girder + end purlins)
    for (const y of [y0 + 0.5, y1 - 0.5]) for (const side of [-1, 1]) b.geometry('steel', rafter(wx, 110 - y, side, 0.5));

    // ── purlins along the canopy, on the rafters ──
    for (const side of [-1, 1]) {
      for (const d of [1.2, 4.6, 8.0, 11.4, 14.6]) {
        const top = roofAt(d);
        b.planBox('steel', { x0: c.cx + side * d - 0.2, x1: c.cx + side * d + 0.2, y0: y0 + 0.2, y1: y1 - 0.2 }, top - 0.1, top + 0.32);
      }
      // eave fascia
      b.planBox('trim', { x0: c.cx + side * HALF - 0.12, x1: c.cx + side * HALF + 0.12, y0: y0, y1: y1 }, E - 0.2, E + 0.55);
    }

    // ── PV modules on the purlins: 6 across x 19 along each slope ──
    const modW = 2.4, modL = 4.3, gap = 0.12;
    const nAcross = Math.floor((HALF - 0.4) / (modW + gap));
    const nAlong = Math.floor((c.h - 0.6) / (modL + gap));
    const along0 = y0 + (c.h - nAlong * (modL + gap)) / 2 + modL / 2;
    for (const side of [-1, 1]) {
      for (let i = 0; i < nAcross; i++) {
        const d = 0.4 + (i + 0.5) * (modW + gap);
        const h = roofAt(d) + 0.42;
        for (let j = 0; j < nAlong; j++) {
          const y = along0 + j * (modL + gap);
          const g = new THREE.BoxGeometry(modW, 0.12, modL);
          g.rotateZ(side * SLOPE); // world X is plan -x: a +side (plan east) slope falls toward world -X
          g.translate(150 - (c.cx + side * d), h, 110 - y);
          b.geometry('pv', g);
        }
      }
    }

    // ── under-canopy LED fixtures over each stall row ──
    for (const side of [-1, 1]) {
      const d = 7;
      const h = roofAt(d) - 0.35;
      for (let y = y0 + 6; y <= y1 - 6; y += 10) {
        b.planBox('dark', { x0: c.cx + side * d - 0.45, x1: c.cx + side * d + 0.45, y0: y - 1.8, y1: y + 1.8 }, h - 0.12, h + 0.3);
        b.planBox('led', { x0: c.cx + side * d - 0.36, x1: c.cx + side * d + 0.36, y0: y - 1.7, y1: y + 1.7 }, h - 0.16, h - 0.1);
      }
    }

    // ── cable tray under the girder, conduit drop into any cabinet ON the spine ──
    // Since the stalls went to 60° (2026-09-28) every cabinet stands beside its car,
    // 2.95-3.7u off the spine (depotPlacement.chargerCabinet), and is fed from below,
    // through its pad, as a pad-mounted charger is. A drop from the tray there was a
    // bare pole standing on each post, thirty of them down canopies B and C.
    b.planBox('dark', { x0: c.cx - 0.55, x1: c.cx + 0.55, y0: y0 + 1, y1: y1 - 1 }, R - 1.75, R - 1.45);
    for (const k of cabs) {
      const kx = k.box.cx;
      if (Math.abs(kx - c.cx) > 1) continue;
      const ky = k.box.cy;
      const top = k.dc ? 3.76 : 2.96;
      b.cylinder('dark', 150 - kx, top, 110 - ky, 0.14, R - 1.75 - top, 8);
    }
  }
  return b.build();
}

/**
 * One tapered cantilever rafter from the spine (depth 0.95) to the eave
 * (depth 0.4), its top on the roof slope. toWorld negates plan x, so a rafter
 * reaching plan-EAST (side +1) reaches world -X: the profile is drawn toward
 * -x for it. (ExtrudeGeometry fixes either winding itself — no mirroring.)
 */
function rafter(wxSpine: number, wz: number, side: number, width = 0.45): THREE.BufferGeometry {
  const s = side > 0 ? -1 : 1;
  const top0 = R - 0.1, top1 = E + 0.1;         // top edge follows the roof
  const bot0 = top0 - 0.95, bot1 = top1 - 0.4;  // tapering to the eave
  const shape = new THREE.Shape();
  shape.moveTo(0, bot0);
  shape.lineTo(s * HALF, bot1);
  shape.lineTo(s * HALF, top1);
  shape.lineTo(0, top0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.translate(wxSpine, 0, wz - width / 2);
  return g;
}
