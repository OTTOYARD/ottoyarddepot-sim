import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OPS_SHELL, WASH_SHELL } from '@/lib/structurePlan';
import { buildShell } from './BuildingShell';
import { buildOffice, SOUTH_GLAZING } from './DepotBuilding';
import { buildWashFittings } from './WashBays';
import { buildServiceFittings } from './ServiceBays';
import { StaticBatch } from './staticBatch';

/**
 * NO TWO FACES ON ONE SURFACE (Chase, 2026-11-18): "There is a flashing fluorescent strip along the top of the
 * commercial building and the bays that flashes when the camera moves."
 *
 * Two faces on the same plane, facing the same way, overlapping, cannot both be drawn: the depth buffer picks one or
 * the other pixel by pixel, and which one changes as the camera moves (z-fighting). The roof slab was drawn over the
 * whole footprint, so its edge stood on the walls' outer face in a 0.6u (0.29 m) band under the parapet, all the way
 * round both buildings: the white roof membrane and the graphite or silver wall skin fought for that band, and it
 * flashed. Faces of ONE material fight too when it is textured: two ribbed wall panels met at every building corner
 * with their ribs at different places (each box's texture starts at its own corner).
 *
 * This finds every such pair, of any material, where a camera can see it, in the two buildings as drawn: the shells,
 * the office's curtain wall, entrance and plant, the service bays' reels, and the wash hall's rails, drains,
 * clerestory and rooftop solar. Measured on the code before the fix: 41 pairs of two materials in
 * the operations building and 30 in the wash hall (the roof band, the liner's ends at the corners, the partitions'
 * feet, the red reveal's and the west windows' trim ends), and 32 and 36 pairs of one material (the wall skins',
 * parapets' and copings' corners).
 */

interface Face { mat: string; axis: number; sign: number; off: number; a0: number; a1: number; b0: number; b1: number }

const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const E1 = new THREE.Vector3(), E2 = new THREE.Vector3(), N = new THREE.Vector3();

/** The axis-aligned rectangular faces of a merged geometry (each quad's two triangles collapse into one rectangle).
 *  A face that is not a rectangle square to the axes (a tilted solar panel's end) is left out: no box can be flush
 *  with it. */
function facesOf(mat: string, g: THREE.BufferGeometry): Face[] {
  const pos = g.getAttribute('position');
  const out = new Map<string, Face>();
  for (let t = 0; t + 2 < pos.count; t += 3) {
    for (let i = 0; i < 3; i++) P[i].fromBufferAttribute(pos, t + i);
    N.crossVectors(E1.subVectors(P[1], P[0]), E2.subVectors(P[2], P[0]));
    if (N.lengthSq() < 1e-12) continue;
    N.normalize();
    const axis = [Math.abs(N.x), Math.abs(N.y), Math.abs(N.z)].findIndex((v) => v > 1 - 1e-6);
    if (axis < 0) continue; // a rod, a cylinder, a tilted panel: never flush with a wall
    const [ia, ib] = [0, 1, 2].filter((i) => i !== axis);
    const as = P.map((q) => q.getComponent(ia)), bs = P.map((q) => q.getComponent(ib));
    const [a0, a1, b0, b1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
    const onCorner = (k: number) => (Math.abs(as[k] - a0) < 1e-5 || Math.abs(as[k] - a1) < 1e-5) && (Math.abs(bs[k] - b0) < 1e-5 || Math.abs(bs[k] - b1) < 1e-5);
    if (![0, 1, 2].every(onCorner)) continue;
    const f: Face = {
      mat, axis, sign: Math.sign(N.getComponent(axis)), off: P[0].getComponent(axis),
      a0: Math.min(...as), a1: Math.max(...as), b0: Math.min(...bs), b1: Math.max(...bs),
    };
    out.set([axis, f.sign, f.off, f.a0, f.a1, f.b0, f.b1].map((v) => v.toFixed(4)).join('|'), f);
  }
  return [...out.values()];
}

/**
 * Run a geometry builder and keep every axis-aligned box it lays (StaticBatch.box, which planBox calls): the solids a
 * face can be buried in. A face inside a wall is never drawn on screen, so two of them on one plane cannot flash.
 */
function withSolids<T>(build: () => T): { out: T; solids: THREE.Box3[] } {
  const box = StaticBatch.prototype.box;
  const solids: THREE.Box3[] = [];
  StaticBatch.prototype.box = function (this: StaticBatch, key, cx, cy, cz, sx, sy, sz, rotY = 0) {
    if (!rotY) solids.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(sx, sy, sz)));
    return box.call(this, key, cx, cy, cz, sx, sy, sz, rotY);
  } as typeof box;
  try {
    return { out: build(), solids };
  } finally {
    StaticBatch.prototype.box = box;
  }
}

/** Is this point inside a solid (by more than a hair on every side)? */
const buried = (p: THREE.Vector3, solids: THREE.Box3[]) => solids.some((s) =>
  p.x > s.min.x + 1e-6 && p.x < s.max.x - 1e-6 && p.y > s.min.y + 1e-6 && p.y < s.max.y - 1e-6 && p.z > s.min.z + 1e-6 && p.z < s.max.z - 1e-6);

/** Pairs of faces on one plane, facing one way, overlapping where a camera can see them. */
function fights(faces: Face[], solids: THREE.Box3[]) {
  const byPlane = new Map<string, Face[]>();
  for (const f of faces) {
    const k = `${f.axis}|${f.sign}|${f.off.toFixed(3)}`;
    byPlane.set(k, [...(byPlane.get(k) ?? []), f]);
  }
  const out: { mats: string; axis: number; off: number; at: number[]; size: number[] }[] = [];
  for (const list of byPlane.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const w = Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0);
        const h = Math.min(a.b1, b.b1) - Math.max(a.b0, b.b0);
        if (w <= 1e-3 || h <= 1e-3) continue;
        // visible where the air just in front of the overlap is not inside some other solid (sampled 7 x 7)
        const [ia, ib] = [0, 1, 2].filter((k) => k !== a.axis);
        const a0 = Math.max(a.a0, b.a0), b0 = Math.max(a.b0, b.b0);
        let seen = false;
        for (let u = 0; u < 7 && !seen; u++) {
          for (let v = 0; v < 7 && !seen; v++) {
            const p = new THREE.Vector3();
            p.setComponent(a.axis, a.off + a.sign * 1e-3);
            p.setComponent(ia, a0 + (w * (u + 0.5)) / 7);
            p.setComponent(ib, b0 + (h * (v + 0.5)) / 7);
            seen = !buried(p, solids);
          }
        }
        if (seen) out.push({ mats: [a.mat, b.mat].sort().join(' / '), axis: a.axis, off: +a.off.toFixed(3), at: [+a0.toFixed(2), +b0.toFixed(2)], size: [+w.toFixed(2), +h.toFixed(2)] });
      }
    }
  }
  return out;
}

/** A building as drawn: its faces, each named by the MATERIAL it is drawn in (the same material in two batches is one
 *  name), and its solids. */
function building(parts: [() => Map<string, THREE.BufferGeometry>, Record<string, string>][]) {
  const faces: Face[] = [], solids: THREE.Box3[] = [];
  for (const [build, names] of parts) {
    const { out, solids: s } = withSolids(build);
    solids.push(...s);
    for (const [k, g] of out) faces.push(...facesOf(names[k] ?? k, g));
  }
  return { faces, solids };
}

// BuildingShell's and DepotBuilding's keys -> the material each draws with (their `mats` tables)
const SHELL = (skin: string): Record<string, string> => ({
  skin, liner: 'litInterior', block: 'interiorBlock', floor: 'floor', roof: 'roofMembrane', slats: 'doorSlats',
  hazard: 'hazardBand', trim: 'aluminiumTrim', steel: 'darkSteel', galv: 'galvanizedSteel', led: 'ledPanel2.4', pack: 'ledPanel3.2',
});
const OFFICE: Record<string, string> = {
  glass: 'officeGlass', trim: 'aluminiumTrim', skin: 'wallGraphite', steel: 'darkSteel', galv: 'galvanizedSteel',
  red: 'brandRed', led: 'ledPanel1.8', pv: 'solarPanelGlass',
};
const SERVICE: Record<string, string> = { steel: 'darkSteel', galv: 'galvanizedSteel' };
const WASH: Record<string, string> = {
  galv: 'galvanizedSteel', steel: 'darkSteel', clere: 'litInterior', yellow: 'safetyYellowPaint', pv: 'solarPanelGlass',
};

describe('the buildings draw no two faces on one surface (no z-fighting)', () => {
  it('the operations building: shell, curtain wall, entrance, rooftop plant and the service bays\' reels', () => {
    const { faces, solids } = building([
      [() => buildShell(OPS_SHELL, Infinity, SOUTH_GLAZING), SHELL('wallGraphite')], [buildOffice, OFFICE], [buildServiceFittings, SERVICE],
    ]);
    expect(faces.length).toBeGreaterThan(500);
    expect(fights(faces, solids)).toEqual([]);
  });

  it('the wash hall, with every door open and with its third bay shut, with its own rails or the CAD machine\'s', () => {
    for (const open of [3, 2]) {
      for (const cad of [false, true]) {
        const { faces, solids } = building([[() => buildShell(WASH_SHELL, open), SHELL('wallSilver')], [() => buildWashFittings(open, cad), WASH]]);
        expect(faces.length).toBeGreaterThan(300);
        expect(fights(faces, solids)).toEqual([]);
      }
    }
  });
});
