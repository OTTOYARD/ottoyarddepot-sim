import * as THREE from 'three';
import {
  type Building, type CityPlan, type Mass, type Rect, CURB_H, FACADE_SPEC, FAR_GROUND, RIVER, rectD, rectW,
} from './cityPlan';

/**
 * The city plan (cityPlan.ts) turned into geometry: ONE merged buffer per material,
 * so the whole city costs a few dozen draw calls however many buildings it holds.
 * Pure three.js, no React, so cityMesh.test.ts can check what it builds.
 *
 * Every buffer carries position, normal, uv and colour. Colour is a per-vertex tint
 * (the building's paint, a darker band at the foot of each wall that stands in for
 * contact shadow), so one textured material draws every building of its facade type.
 */

type V3 = [number, number, number];
type Col = [number, number, number];

const _c = new THREE.Color();
const _lin = new Map<string, Col>();
/** sRGB hex to the linear working-space triple vertex colours expect. */
export function lin(hex: string, k = 1): Col {
  let c = _lin.get(hex);
  if (!c) { _c.set(hex); c = [_c.r, _c.g, _c.b]; _lin.set(hex, c); }
  return k === 1 ? c : [c[0] * k, c[1] * k, c[2] * k];
}
const scale = (c: Col, k: number): Col => [c[0] * k, c[1] * k, c[2] * k];

/** A Float32Array that grows by doubling: the city writes ~1.5M floats per attribute. */
class Grow {
  a = new Float32Array(1 << 14);
  n = 0;
  room(k: number) {
    if (this.n + k <= this.a.length) return;
    const b = new Float32Array(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
}
interface Buf { p: Grow; n: Grow; uv: Grow; c: Grow }

export class GeoBatch {
  private bufs = new Map<string, Buf>();

  private buf(key: string): Buf {
    let b = this.bufs.get(key);
    if (!b) { b = { p: new Grow(), n: new Grow(), uv: new Grow(), c: new Grow() }; this.bufs.set(key, b); }
    return b;
  }

  private static vert(B: Buf, v: V3, nx: number, ny: number, nz: number, uv: [number, number], c: Col) {
    const p = B.p.a, n = B.n.a, t = B.uv.a, k = B.c.a;
    let i = B.p.n; p[i] = v[0]; p[i + 1] = v[1]; p[i + 2] = v[2];
    n[i] = nx; n[i + 1] = ny; n[i + 2] = nz;
    k[i] = c[0]; k[i + 1] = c[1]; k[i + 2] = c[2];
    B.p.n = B.n.n = B.c.n = i + 3;
    i = B.uv.n; t[i] = uv[0]; t[i + 1] = uv[1];
    B.uv.n = i + 2;
  }

  private static normal(a: V3, b: V3, c: V3): V3 {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  private reserve(B: Buf, verts: number) {
    B.p.room(verts * 3); B.n.room(verts * 3); B.c.room(verts * 3); B.uv.room(verts * 2);
  }

  /** a, b, c, d counter-clockwise as seen from the side the quad faces. */
  quad(key: string, a: V3, b: V3, c: V3, d: V3, uv: [number, number][], col: Col | Col[]) {
    const B = this.buf(key);
    this.reserve(B, 6);
    const [nx, ny, nz] = GeoBatch.normal(a, b, c);
    const one = !Array.isArray(col[0]);
    const c0 = one ? (col as Col) : (col as Col[])[0], c1 = one ? (col as Col) : (col as Col[])[1];
    const c2 = one ? (col as Col) : (col as Col[])[2], c3 = one ? (col as Col) : (col as Col[])[3];
    GeoBatch.vert(B, a, nx, ny, nz, uv[0], c0);
    GeoBatch.vert(B, b, nx, ny, nz, uv[1], c1);
    GeoBatch.vert(B, c, nx, ny, nz, uv[2], c2);
    GeoBatch.vert(B, a, nx, ny, nz, uv[0], c0);
    GeoBatch.vert(B, c, nx, ny, nz, uv[2], c2);
    GeoBatch.vert(B, d, nx, ny, nz, uv[3], c3);
  }

  tri(key: string, a: V3, b: V3, c: V3, col: Col, uv: [number, number][] = [[0, 0], [1, 0], [0.5, 1]]) {
    const B = this.buf(key);
    this.reserve(B, 3);
    const [nx, ny, nz] = GeoBatch.normal(a, b, c);
    GeoBatch.vert(B, a, nx, ny, nz, uv[0], col);
    GeoBatch.vert(B, b, nx, ny, nz, uv[1], col);
    GeoBatch.vert(B, c, nx, ny, nz, uv[2], col);
  }

  /** An upward-facing rectangle at height y, UVs in world units times `s`. */
  flat(key: string, r: Rect, y: number, col: Col, s = 1) {
    this.quad(key, [r.x0, y, r.z0], [r.x0, y, r.z1], [r.x1, y, r.z1], [r.x1, y, r.z0],
      [[r.x0 * s, r.z0 * s], [r.x0 * s, r.z1 * s], [r.x1 * s, r.z1 * s], [r.x1 * s, r.z0 * s]], col);
  }

  /** An axis-aligned box; `faces` picks which of +x -x +y -y +z -z to draw. UVs in world units times `s`. */
  box(key: string, r: Rect, y0: number, y1: number, col: Col, s = 1, faces = 'XxYZz') {
    const { x0, x1, z0, z1 } = r;
    const uvw = (u0: number, u1: number, v0: number, v1: number): [number, number][] =>
      [[u0 * s, v0 * s], [u1 * s, v0 * s], [u1 * s, v1 * s], [u0 * s, v1 * s]];
    if (faces.includes('Y')) this.flat(key, r, y1, col, s);
    if (faces.includes('y')) this.quad(key, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], uvw(x0, x1, z0, z1), col);
    if (faces.includes('z')) this.quad(key, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uvw(0, x1 - x0, y0, y1), col);
    if (faces.includes('Z')) this.quad(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uvw(0, x1 - x0, y0, y1), col);
    if (faces.includes('x')) this.quad(key, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uvw(0, z1 - z0, y0, y1), col);
    if (faces.includes('X')) this.quad(key, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uvw(0, z1 - z0, y0, y1), col);
  }

  /** Any three.js geometry, moved into place and painted one colour. */
  geometry(key: string, g: THREE.BufferGeometry, m: THREE.Matrix4, col: Col) {
    const src = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    const B = this.buf(key);
    const p = src.attributes.position, n = src.attributes.normal, uv = src.attributes.uv;
    this.reserve(B, p.count);
    for (let i = 0; i < p.count; i++) {
      GeoBatch.vert(B, [p.getX(i), p.getY(i), p.getZ(i)], n.getX(i), n.getY(i), n.getZ(i),
        [uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0], col);
    }
    src.dispose();
  }

  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [key, b] of this.bufs) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.p.a.slice(0, b.p.n), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.n.a.slice(0, b.n.n), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv.a.slice(0, b.uv.n), 2));
      g.setAttribute('color', new THREE.BufferAttribute(b.c.a.slice(0, b.c.n), 3));
      g.computeBoundingSphere();
      out.set(key, g);
    }
    return out;
  }
}

/** A building's walls: textured, the window grid running continuously round the corners. */
export function facade(batch: GeoBatch, m: Mass, footShade: boolean) {
  const spec = FACADE_SPEC[m.facade];
  const tileW = spec.bay * spec.tileBays;
  const tileH = spec.fitHeight ? m.y1 - m.y0 : spec.floor * spec.tileFloors;
  const tint = lin(m.tint);
  // walk the footprint clockwise from above, so each wall faces out
  const ring: [number, number][] = [[m.x1, m.z0], [m.x0, m.z0], [m.x0, m.z1], [m.x1, m.z1], [m.x1, m.z0]];
  const foot = footShade ? Math.min(8, (m.y1 - m.y0) * 0.5) : 0;
  const bands: [number, number, number, number][] = foot > 0
    ? [[m.y0, m.y0 + foot, 0.66, 1], [m.y0 + foot, m.y1, 1, 1]]
    : [[m.y0, m.y1, 1, 1]];
  let acc = 0;
  for (let k = 0; k < 4; k++) {
    const [px, pz] = ring[k], [qx, qz] = ring[k + 1];
    const len = Math.hypot(qx - px, qz - pz);
    const u0 = m.u + acc / tileW, u1 = m.u + (acc + len) / tileW;
    for (const [ya, yb, ka, kb] of bands) {
      const va = m.v + (ya - m.y0) / tileH, vb = m.v + (yb - m.y0) / tileH;
      batch.quad(`f:${m.facade}`, [px, ya, pz], [qx, ya, qz], [qx, yb, qz], [px, yb, pz],
        [[u0, va], [u1, va], [u1, vb], [u0, vb]],
        [scale(tint, ka), scale(tint, ka), scale(tint, kb), scale(tint, kb)]);
    }
    acc += len;
  }
}

const sameFootprint = (a: Rect, b: Rect) =>
  Math.abs(a.x0 - b.x0) < 0.01 && Math.abs(a.x1 - b.x1) < 0.01 && Math.abs(a.z0 - b.z0) < 0.01 && Math.abs(a.z1 - b.z1) < 0.01;

function rngFor(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARAPET = 1.1, COPING = 0.7;
/** Past this distance from the lot, roofs carry no parapets or rooftop units: from any
 *  camera they are under a pixel, and they would be a third of the city's triangles. */
export const ROOF_DETAIL_RADIUS = 900;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const unitCyl6 = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
const unitCone = new THREE.ConeGeometry(1, 1, 10, 1, true);
const unitDisc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
const spireGeo = new THREE.CylinderGeometry(0.12, 1, 1, 4, 1, true).rotateY(Math.PI / 4);

function place(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0) {
  tmpQ.setFromAxisAngle(UP, rotY);
  return tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
}

/** Walls, roofs, parapets and whatever stands on the roof. */
export function building(batch: GeoBatch, b: Building) {
  const r = rngFor(b.id);
  const base = b.masses[0];
  const detail = !!base && Math.hypot((base.x0 + base.x1) / 2, (base.z0 + base.z1) / 2 - 4) < ROOF_DETAIL_RADIUS;
  b.masses.forEach((m, i) => {
    facade(batch, m, m.y0 < 0.5);
    const above = b.masses[i + 1];
    if (above && sameFootprint(above, m) && Math.abs(above.y0 - m.y1) < 0.01) return; // capped by the next mass
    const roofCol = lin('#bfc2c5', 0.85 + r() * 0.15);
    batch.flat('roof', m, m.y1, roofCol, 1 / 24);
    if (!detail) return;
    if (b.use === 'residential') {
      // a slim cornice instead of a parapet
      batch.box('plain', { x0: m.x0 - 0.35, x1: m.x1 + 0.35, z0: m.z0 - 0.35, z1: m.z1 + 0.35 }, m.y1 - 0.5, m.y1 + 0.15, lin(m.tint, 0.82), 1, 'XxYZz');
      return;
    }
    const pc = m.facade === 'glass' ? lin('#9aa5b0') : lin(m.tint, 0.85);
    const t = COPING;
    // four coping runs: outer face, inner face and top; the two that own the corners close their ends
    const runs: Rect[] = [
      { x0: m.x0, x1: m.x1, z0: m.z0, z1: m.z0 + t }, { x0: m.x0, x1: m.x1, z0: m.z1 - t, z1: m.z1 },
      { x0: m.x0, x1: m.x0 + t, z0: m.z0 + t, z1: m.z1 - t }, { x0: m.x1 - t, x1: m.x1, z0: m.z0 + t, z1: m.z1 - t },
    ];
    const faces = ['zZYxX', 'zZYxX', 'xXY', 'xXY'];
    runs.forEach((run, k) => batch.box('plain', run, m.y1, m.y1 + PARAPET, pc, 1, faces[k]));
  });

  const top = b.masses[b.masses.length - 1];
  if (!top) return;
  const y = top.y1;
  const W = rectW(top), D = rectD(top);
  if (!detail) { crowns(batch, b); return; }

  // rooftop units, kept off the parapet
  for (let k = 0; k < b.equipment; k++) {
    const w = 3 + r() * Math.min(5, W * 0.2), d = 3 + r() * Math.min(4, D * 0.2), h = 1.8 + r() * 1.8;
    if (W < w + 8 || D < d + 8) break;
    const x = top.x0 + 4 + r() * (W - w - 8), z = top.z0 + 4 + r() * (D - d - 8);
    batch.box('plain', { x0: x, x1: x + w, z0: z, z1: z + d }, y, y + h, lin(r() < 0.5 ? '#c9cdd0' : '#b7bcc0'), 1, 'XxYZz');
  }
  // a plant room on the bigger flat roofs
  if (b.use !== 'industrial' && b.use !== 'residential' && !b.pyramid && !b.spires && W > 26 && D > 26 && r() < 0.6) {
    const w = W * (0.25 + r() * 0.15), d = D * (0.25 + r() * 0.15);
    const x = top.x0 + (W - w) * (0.3 + r() * 0.4), z = top.z0 + (D - d) * (0.3 + r() * 0.4);
    batch.box('plain', { x0: x, x1: x + w, z0: z, z1: z + d }, y, y + 5.5, lin(top.tint, 0.78), 1, 'XxYZz');
  }
  if (b.waterTower && W > 18 && D > 18) {
    const x = top.x0 + 6 + r() * (W - 12), z = top.z0 + 6 + r() * (D - 12);
    const wood = lin('#7b5b3e'), steel = lin('#55585c');
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      batch.box('plain', { x0: x + dx - 0.2, x1: x + dx + 0.2, z0: z + dz - 0.2, z1: z + dz + 0.2 }, y, y + 4.2, steel, 1, 'XxZz');
    }
    batch.geometry('plain', unitCyl6, place(x, y + 4.2 + 2.6, z, 2.7, 5.2, 2.7), wood);
    batch.geometry('plain', unitCone, place(x, y + 4.2 + 5.2 + 0.9, z, 3, 1.8, 3), lin('#4a3f36'));
  }
  if (b.skylights && W > 30 && D > 30) {
    const alongX = W >= D;
    const len = (alongX ? W : D) * 0.6;
    for (let s = (alongX ? D : W) * 0.2; s < (alongX ? D : W) * 0.8; s += 11) {
      const rr: Rect = alongX
        ? { x0: top.x0 + W * 0.2, x1: top.x0 + W * 0.2 + len, z0: top.z0 + s, z1: top.z0 + s + 2.2 }
        : { x0: top.x0 + s, x1: top.x0 + s + 2.2, z0: top.z0 + D * 0.2, z1: top.z0 + D * 0.2 + len };
      batch.box('skylight', rr, y, y + 0.7, lin('#ffffff'), 1, 'XxYZz');
    }
  }
  if (b.solar && W > 30 && D > 30) {
    // rows of panels tilted toward the sun, one PV module (the texture) per 2.6 u along each row
    const alongX = W >= D;
    const white = lin('#ffffff');
    for (let s = 5; s < (alongX ? D : W) - 5; s += 4.4) {
      const lo = y + 0.7, hi = y + 1.5, k = (alongX ? W : D) - 12;
      const uv: [number, number][] = [[0, 0], [k / 2.6, 0], [k / 2.6, 1], [0, 1]];
      if (alongX) {
        const z = top.z0 + s, x0 = top.x0 + 6, x1 = top.x1 - 6;
        batch.quad('solar', [x1, lo, z - 1.25], [x0, lo, z - 1.25], [x0, hi, z + 1.25], [x1, hi, z + 1.25], uv, white);
      } else {
        const x = top.x0 + s, z0 = top.z0 + 6, z1 = top.z1 - 6;
        batch.quad('solar', [x - 1.25, lo, z0], [x - 1.25, lo, z1], [x + 1.25, hi, z1], [x + 1.25, hi, z0], uv, white);
      }
    }
  }
  crowns(batch, b);
}

/** What tops a tower (glass peak, spires, obstruction lights): kept at every distance, it IS the skyline. */
function crowns(batch: GeoBatch, b: Building) {
  if (b.pyramid) {
    const p = b.pyramid;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, ap: V3 = [cx, p.y0 + p.h, cz];
    const col = lin('#8ea3ba');
    batch.tri('glassCrown', [p.x1, p.y0, p.z0], [p.x0, p.y0, p.z0], ap, col);
    batch.tri('glassCrown', [p.x0, p.y0, p.z0], [p.x0, p.y0, p.z1], ap, col);
    batch.tri('glassCrown', [p.x0, p.y0, p.z1], [p.x1, p.y0, p.z1], ap, col);
    batch.tri('glassCrown', [p.x1, p.y0, p.z1], [p.x1, p.y0, p.z0], ap, col);
  }
  for (const s of b.spires ?? []) {
    batch.geometry('glassCrown', spireGeo, place(s.x, s.y0 + s.h / 2, s.z, s.r * Math.SQRT2, s.h, s.r * Math.SQRT2), lin('#7f91a5'));
  }
  for (const be of b.beacons ?? []) {
    batch.box('beacon', { x0: be.x - 0.5, x1: be.x + 0.5, z0: be.z - 0.5, z1: be.z + 0.5 }, be.y - 0.5, be.y + 0.5, lin('#ffffff'));
  }
}

const SURFACE_COL: Record<string, string> = {
  street: '#ffffff', plaza: '#ffffff', yard: '#ffffff', lawn: '#ffffff', path: '#ffffff', far: '#ffffff',
};
/** UV scale per surface: one texture repeat per this many world units. */
const SURFACE_UV: Record<string, number> = { street: 1 / 40, plaza: 1 / 18, yard: 1 / 34, lawn: 1 / 30, path: 1 / 14, far: 1 / 200 };

/** Streets, sidewalks, lots, paint, the river and its bridges. */
export function groundworks(batch: GeoBatch, plan: CityPlan) {
  for (const g of plan.ground) batch.flat(g.surface, g, 0, lin(SURFACE_COL[g.surface]), SURFACE_UV[g.surface]);
  for (const s of plan.sidewalks) batch.box('sidewalk', s, 0, CURB_H, lin('#ffffff'), 1 / 12, 'XxYZz');
  for (const p of plan.paint) batch.flat(`paint:${p.paint}`, p, 0.03, lin('#ffffff'));

  // the river: water, stone banks the length of the map, a bridge at every street
  for (const w of plan.water) batch.flat('water', w, RIVER.water + 0.8, lin('#ffffff'), 1 / 60);
  const bank = lin('#a19b90');
  batch.quad('plain', [RIVER.x0, RIVER.water, FAR_GROUND.z1], [RIVER.x0, RIVER.water, FAR_GROUND.z0], [RIVER.x0, 0, FAR_GROUND.z0], [RIVER.x0, 0, FAR_GROUND.z1],
    [[0, 0], [1, 0], [1, 1], [0, 1]], [scale(bank, 0.7), scale(bank, 0.7), bank, bank]);
  batch.quad('plain', [RIVER.x1, RIVER.water, FAR_GROUND.z0], [RIVER.x1, RIVER.water, FAR_GROUND.z1], [RIVER.x1, 0, FAR_GROUND.z1], [RIVER.x1, 0, FAR_GROUND.z0],
    [[0, 0], [1, 0], [1, 1], [0, 1]], [scale(bank, 0.7), scale(bank, 0.7), bank, bank]);
  const deck = lin('#b9b6ae');
  for (const br of plan.bridges) {
    const span: Rect = { x0: RIVER.x0, x1: RIVER.x1, z0: br.z0, z1: br.z1 };
    batch.box('plain', span, RIVER.deckBottom, 0, deck, 1, 'yZz');
    for (const z of [br.z0, br.z1 - 0.5]) {
      batch.box('plain', { x0: RIVER.x0, x1: RIVER.x1, z0: z, z1: z + 0.5 }, CURB_H, CURB_H + 1.2, lin('#6c7178'), 1, 'YZz');
    }
    for (const px of [RIVER.x0 + (RIVER.x1 - RIVER.x0) / 3, RIVER.x0 + (2 * (RIVER.x1 - RIVER.x0)) / 3]) {
      batch.box('plain', { x0: px - 2, x1: px + 2, z0: br.z0 + 3, z1: br.z1 - 3 }, RIVER.water, RIVER.deckBottom, scale(deck, 0.85), 1, 'XxZz');
    }
  }
  for (const f of plan.fountains) {
    batch.geometry('plain', unitCyl6, place(f.x, 0.45, f.z, f.r, 0.9, f.r), lin('#cfcac0'));
    batch.geometry('water', unitDisc, place(f.x, 0.93, f.z, f.r - 0.6, 1, f.r - 0.6), lin('#ffffff'));
    batch.geometry('plain', unitCyl6, place(f.x, 1.6, f.z, 0.7, 3.2, 0.7), lin('#e4e0d8'));
  }
}

/** Every buffer key the city builds: one material each in UrbanSurround (the type makes it total). */
export const CITY_MATERIAL_KEYS = [
  'f:glass', 'f:office', 'f:brick', 'f:stucco', 'f:storefront', 'f:industrial',
  'street', 'plaza', 'yard', 'lawn', 'path', 'far', 'sidewalk',
  'paint:white', 'paint:yellow', 'paint:amber',
  'roof', 'plain', 'skylight', 'solar', 'glassCrown', 'beacon', 'water',
] as const;
export type CityMaterialKey = (typeof CITY_MATERIAL_KEYS)[number];

/** Every building and all the groundwork, merged by material. */
export function buildCityGeometry(plan: CityPlan): Map<string, THREE.BufferGeometry> {
  const batch = new GeoBatch();
  groundworks(batch, plan);
  for (const b of plan.buildings) building(batch, b);
  return batch.build();
}
