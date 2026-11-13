// Spec -> a THREE.Group: body panels cut from one surface, doors on their hinges or tracks, wheels, sensors, cabin.
//
// Node names are the contract with whatever animates or measures the car:
//   body · door_<id> · wheel_<FL|FR|RL|RR> · sensor_<id> · interior · mirror_<L|R> · charge_port
// A door node sits at its pivot and carries userData.door (see rig.ts); a sensor node carries userData.sensor.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  boundaryEdges, K_BELT, K_RAIL, K_TOP, makeSurface, polyline, sdPolygon, splitAll, YARD_SPAN_SAMPLES,
  type Field, type Pt, type Surface, type SurfVertex, type Tri,
} from './surface';
import { makeMaterials, type MaterialSet } from './materials';
import type { DoorSpec, RegionHelpers, RegionSpec, SensorSpec, VehicleSpec } from './spec';
import { doorRigOf } from './doorRigs';

const H_SCALE = 0.45; // metres per unit of glass-band height, for distances in [xr, h]
const W_SCALE = 0.7; //  metres per unit of roof-band width

function helpers(s: Surface): RegionHelpers {
  const L = s.length;
  return {
    sideGlass(poly, r = 0.03, grow = 0) {
      const sp = poly.map(([x, h]) => [x, h * H_SCALE] as Pt);
      return [(p) => sdPolygon(p.xr, ((p.tt - K_BELT) / (K_RAIL - K_BELT)) * H_SCALE, sp) - r - grow];
    },
    topGlass(poly, r = 0.04, grow = 0) {
      const sp = poly.map(([x, w]) => [x, (w >= 1 ? 1.3 : w) * W_SCALE] as Pt);
      return [(p) => sdPolygon(p.xr, ((p.tt - K_RAIL) / (K_TOP - K_RAIL)) * W_SCALE, sp) - r - grow];
    },
    sidePatch(poly, r = 0.01, side) {
      const f: Field[] = [(p) => sdPolygon(p.xr, p.y, poly) - r, (p) => p.tt - (K_RAIL + 0.3), (p) => 1.2 - p.tt];
      if (side) f.push((p) => -side * p.z);
      return f;
    },
    endPatch(end, poly, r = 0.01, depth = 0.6, mirror = true) {
      return [
        (p) => sdPolygon(mirror ? Math.abs(p.z) : p.z, p.y, poly) - r,
        (p) => (end === 'front' ? p.xr : L - p.xr) - depth,
      ];
    },
    planPatch(poly, r = 0.01) {
      return [(p) => sdPolygon(p.xr, Math.abs(p.z), poly) - r, (p) => (K_BELT - 0.6) - p.tt];
    },
    below(line, ttMax = K_BELT) {
      const f = polyline(line);
      return [(p) => p.y - f(p.xr), (p) => p.tt - ttMax];
    },
    stripe(line, width, xr0, xr1) {
      const f = polyline(line);
      return [(p) => p.y - f(p.xr) - width / 2, (p) => f(p.xr) - width / 2 - p.y, (p) => xr0 - p.xr, (p) => p.xr - xr1, (p) => p.tt - (K_RAIL + 0.3)];
    },
  };
}

/** Indexed triangle buckets by material, in vehicle coordinates. */
class Collector {
  private b = new Map<string, { pos: number[]; nor: number[]; idx: number[]; ids: Map<string, number> }>();
  private bucket(m: string) {
    let x = this.b.get(m);
    if (!x) { x = { pos: [], nor: [], idx: [], ids: new Map() }; this.b.set(m, x); }
    return x;
  }
  /** A surface vertex, optionally pushed `inset` metres in along its normal (the inner skin). */
  private vert(m: string, v: SurfVertex, inset: number, flip: boolean): number {
    const x = this.bucket(m);
    const key = `${v.id}:${inset}:${flip ? 1 : 0}`;
    let i = x.ids.get(key);
    if (i === undefined) {
      i = x.pos.length / 3;
      x.pos.push(v.x - v.nx * inset, v.y - v.ny * inset, v.z - v.nz * inset);
      const sgn = flip ? -1 : 1;
      x.nor.push(v.nx * sgn, v.ny * sgn, v.nz * sgn);
      x.ids.set(key, i);
    }
    return i;
  }
  skin(m: string, tris: Tri[], inset = 0, flip = false) {
    const x = this.bucket(m);
    for (const [a, b, c] of tris) {
      const ia = this.vert(m, a, inset, flip);
      const ib = this.vert(m, b, inset, flip);
      const ic = this.vert(m, c, inset, flip);
      if (flip) x.idx.push(ia, ic, ib); else x.idx.push(ia, ib, ic);
    }
  }
  /** A wall from the outer skin to the inner one along each edge. */
  walls(m: string, edges: [SurfVertex, SurfVertex][], inset: number) {
    const x = this.bucket(m);
    for (const [a, b] of edges) {
      const pa = [a.x, a.y, a.z];
      const pb = [b.x, b.y, b.z];
      const qa = [a.x - a.nx * inset, a.y - a.ny * inset, a.z - a.nz * inset];
      const qb = [b.x - b.nx * inset, b.y - b.ny * inset, b.z - b.nz * inset];
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2 = [qa[0] - pa[0], qa[1] - pa[1], qa[2] - pa[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      const i0 = x.pos.length / 3;
      for (const p of [pa, pb, qb, qa]) { x.pos.push(p[0], p[1], p[2]); x.nor.push(n[0] / l, n[1] / l, n[2] / l); }
      x.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }
  }
  meshes(mats: MaterialSet, origin: THREE.Vector3): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [m, x] of this.b) {
      if (!x.idx.length) continue;
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(x.pos);
      for (let i = 0; i < pos.length; i += 3) { pos[i] -= origin.x; pos[i + 1] -= origin.y; pos[i + 2] -= origin.z; }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(x.nor), 3));
      g.setIndex(x.idx);
      const mesh = new THREE.Mesh(g, mats[m] ?? mats.trim);
      mesh.name = m;
      if (m.startsWith('glass') && m !== 'glassBlack') mesh.renderOrder = 2;
      out.push(mesh);
    }
    return out;
  }
}

const SEE_THROUGH = new Set(['glass', 'glassDark']);

/** Paint a panel's regions, then give it thickness: an inner skin and a wall round its rim. */
function finishPanel(s: Surface, tris: Tri[], regions: RegionSpec[], which: 'body' | 'doors', thickness: number, innerMat: string, shell = false): Collector {
  const col = new Collector();
  let rest = tris;
  const opaque: Tri[] = [];
  for (const r of regions) {
    if (r.on && r.on !== 'all' && r.on !== which) continue;
    const cut = splitAll(s, rest, r.fields);
    rest = cut.outside;
    if (!cut.inside.length) continue;
    col.skin(r.material, cut.inside);
    if (!SEE_THROUGH.has(r.material)) opaque.push(...cut.inside);
  }
  col.skin('paint', rest);
  opaque.push(...rest);
  // The yard's light model is the outer skin alone: its renderer shades the back of a panel dark instead.
  if (shell) return col;
  col.skin(innerMat, opaque, thickness, true);
  col.walls('cavity', boundaryEdges(tris), thickness);
  return col;
}

function doorFields(d: DoorSpec, wheels: { xr: number; y: number; r: number }[], gap: number, oneSide = false): Field[] {
  const front = polyline(d.front);
  const rear = polyline(d.rear);
  const f: Field[] = [
    (p) => front(p.tt) - p.xr + gap,
    (p) => p.xr - rear(p.tt) + gap,
    (p) => d.ttLow - p.tt + gap * 8,
    (p) => p.tt - d.ttHigh + gap * 8,
  ];
  for (const w of wheels) f.push((p) => w.r + 0.03 + gap - Math.hypot(p.xr - w.xr, p.y - w.y));
  // `oneSide`: the triangles handed in are already the door's own side of the car.
  if (!oneSide) f.push((p) => -d.side * p.z);
  return f;
}

function tyre(R: number, width: number, rimR: number, yard = false): THREE.BufferGeometry {
  const w = width / 2;
  const pts = yard ? [
    [rimR - 0.01, -w + 0.012], [R - 0.03, -w], [R, -w + 0.035], [R, w - 0.035], [R - 0.03, w], [rimR - 0.01, w - 0.012],
  ].map(([r, a]) => new THREE.Vector2(r, a)) : [
    [rimR - 0.01, -w + 0.012], [rimR + 0.015, -w + 0.004], [R - 0.045, -w], [R - 0.012, -w + 0.012], [R, -w + 0.04],
    [R, w - 0.04], [R - 0.012, w - 0.012], [R - 0.045, w], [rimR + 0.015, w - 0.004], [rimR - 0.01, w - 0.012],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const g = new THREE.LatheGeometry(pts, yard ? YARD_WHEEL_SEGMENTS : 56);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Segments round a wheel and round a sensor in the yard's light model. */
const YARD_WHEEL_SEGMENTS = 16;
const YARD_ROUND_SEGMENTS = 10;
/** A sensor whose largest side is under this is not drawn in the yard's light model (its node stays). */
export const YARD_MIN_SENSOR_M = 0.05;
/** A rounded box, or a plain one in the yard's light model. */
function rbox(yard: boolean, l: number, h: number, w: number, seg: number, r: number): THREE.BufferGeometry {
  return yard ? new THREE.BoxGeometry(l, h, w) : new RoundedBoxGeometry(l, h, w, seg, r);
}

function lathe(points: Pt[], seg = 48): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points.map(([r, a]) => new THREE.Vector2(r, a)), seg);
  g.rotateX(Math.PI / 2);
  return g;
}

/** A wheel with its outer face toward +Z. */
function wheel(spec: VehicleSpec, mats: MaterialSet, yard = false): THREE.Group {
  const { tyreRadius: R, tyreWidth: W, rimRadius: rr } = spec.dims;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(tyre(R, W, rr, yard), mats.rubber));
  const face = W / 2 - 0.012;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => { const x = new THREE.Mesh(geo, m); g.add(x); return x; };
  if (yard) {
    // The yard's wheel: the tyre, a dark dished face and the rim's colour on it as a ring and a hub.
    const n = YARD_WHEEL_SEGMENTS;
    const covered = spec.wheelStyle === 'disc';
    add(lathe([[0, face - 0.02], [rr, face - 0.02]], n), covered ? mats.rim : mats.rimDark);
    if (!covered) {
      add(lathe([[rr * 0.72, face - 0.012], [rr, face - 0.004]], n), mats.rim);
      add(lathe([[0, face - 0.006], [rr * 0.3, face - 0.012]], n), mats.rim);
    }
    return g;
  }
  // Barrel and back of the rim.
  g.add(new THREE.Mesh(lathe([[rr, face], [rr - 0.02, face - 0.03], [rr - 0.03, -face], [0.05, -face + 0.02]]), mats.rimDark));
  if (spec.wheelStyle === 'disc') {
    // A smooth cover reaching onto the sidewall.
    const edge = R * 0.86;
    add(lathe([[0, face + 0.02], [0.03, face + 0.02], [0.035, face + 0.012], [edge * 0.55, face + 0.012], [edge, face - 0.004], [edge + 0.004, face - 0.02]], 64), mats.rim);
    add(lathe([[0, face + 0.028], [0.022, face + 0.026], [0.03, face + 0.02]], 24), mats.rim);
  } else if (spec.wheelStyle === 'aero') {
    add(lathe([[0, face + 0.006], [rr * 0.98, face + 0.002], [rr + 0.002, face - 0.015]], 64), mats.rimDark);
    for (let i = 0; i < 5; i++) {
      const b = new RoundedBoxGeometry(rr * 0.62, rr * 0.36, 0.014, 2, 0.006);
      b.translate(rr * 0.52, 0, face + 0.008);
      b.rotateZ((i / 5) * Math.PI * 2 + 0.3);
      add(b, mats.trim);
    }
    add(lathe([[0, face + 0.02], [0.05, face + 0.018], [0.06, face + 0.006]], 24), mats.rimDark);
  } else if (spec.wheelStyle === 'paddle') {
    add(lathe([[0, face - 0.03], [rr * 0.98, face - 0.035], [rr, face]], 64), mats.rimDark);
    for (let i = 0; i < 5; i++) {
      const b = new RoundedBoxGeometry(rr * 0.5, rr * 0.2, 0.03, 3, 0.012);
      b.translate(rr * 0.66, 0, face - 0.012);
      b.rotateZ((i / 5) * Math.PI * 2 + Math.PI / 2);
      add(b, mats.rim);
    }
    add(lathe([[0, face], [0.07, face - 0.002], [0.09, face - 0.03]], 24), mats.rimDark);
  } else {
    // Ten slim spokes on a dished face.
    add(lathe([[rr - 0.004, face], [rr - 0.03, face - 0.004], [rr - 0.034, face - 0.05]], 64), mats.rim);
    for (let i = 0; i < 10; i++) {
      const b = new THREE.BoxGeometry(rr - 0.05, 0.03, 0.022);
      b.translate((rr - 0.05) / 2 + 0.03, 0, face - 0.03);
      b.rotateZ((i / 10) * Math.PI * 2);
      add(b, mats.rim);
    }
    add(lathe([[0, face - 0.008], [0.06, face - 0.012], [0.075, face - 0.04]], 24), mats.rim);
    add(lathe([[0.08, face - 0.07], [rr * 0.78, face - 0.07]], 40), mats.rimDark);
  }
  return g;
}

function sensorNode(sp: SensorSpec, s: Surface, mats: MaterialSet, yard = false): THREE.Group {
  const g = new THREE.Group();
  g.name = `sensor_${sp.id}`;
  const L = s.length;
  let yaw = ((sp.yawDeg ?? 0) * Math.PI) / 180;
  if (sp.on) {
    const side = sp.on.side === 0 ? 1 : sp.on.side;
    const tt = sp.on.side === 0 ? K_TOP : sp.on.tt;
    const p = s.point(sp.on.xr, tt, side);
    const n = s.normalAt(sp.on.xr, tt, side);
    const lift = sp.on.lift ?? 0;
    g.position.set(p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift);
    if (sp.yawDeg === undefined && Math.hypot(n[0], n[2]) > 0.3) yaw = Math.atan2(n[2], n[0]);
  } else if (sp.pos) {
    g.position.set(L / 2 - sp.pos[0], sp.pos[1], sp.pos[2]);
  }
  g.rotation.y = -yaw;
  const sz = sp.size ?? [];
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => { const x = new THREE.Mesh(geo, m); g.add(x); return x; };
  g.userData.sensor = { id: sp.id, type: sp.type, shape: sp.shape, note: sp.note ?? '' };
  if (yard) {
    const round = YARD_ROUND_SEGMENTS;
    if (sp.shape === 'spinLidar') {
      const [r = 0.08, h = 0.12] = sz;
      if (Math.max(2 * r, h) < YARD_MIN_SENSOR_M) return g;
      const c = new THREE.CylinderGeometry(r, r * 1.1, h, round); c.translate(0, h / 2, 0);
      add(c, mats.sensorGloss);
    } else if (sp.shape === 'puckLidar') {
      const [r = 0.05, h = 0.07] = sz;
      if (Math.max(2 * r, h) < YARD_MIN_SENSOR_M) return g;
      const c = new THREE.CylinderGeometry(r, r, h, round); c.rotateZ(Math.PI / 2); c.translate(h / 2 - 0.01, 0, 0);
      add(c, mats.sensorGloss);
    } else if (sp.shape === 'camera') {
      const [r = 0.018, d = 0.03] = sz;
      if (Math.max(2 * r, d) < YARD_MIN_SENSOR_M) return g;
      const c = new THREE.CylinderGeometry(r, r * 1.15, d, 8); c.rotateZ(-Math.PI / 2); c.translate(d / 2 - 0.006, 0, 0);
      add(c, mats.sensorBody);
    } else if (sp.shape === 'dome') {
      const [r = 0.3, hh = 0.14] = sz;
      const pr: Pt[] = [[0, hh], [r * 0.5, hh], [r * 0.9, hh * 0.5], [r, 0]];
      add(new THREE.LatheGeometry(pr.map(([a, b]) => new THREE.Vector2(a, b)).reverse(), 16), mats.sensorGloss);
    } else if (sp.shape === 'radar') {
      const [l = 0.02, h = 0.07, w = 0.1] = sz;
      if (Math.max(l, h, w) < YARD_MIN_SENSOR_M) return g;
      add(new THREE.BoxGeometry(l, h, w), mats.sensorBody);
    } else {
      const [l = 0.1, h = 0.08, w = 0.12] = sz;
      if (Math.max(l, h, w) < YARD_MIN_SENSOR_M) return g;
      add(new THREE.BoxGeometry(l, h, w), mats[sp.material ?? 'sensorGloss']);
    }
    return g;
  }
  if (sp.shape === 'spinLidar') {
    const [r = 0.08, h = 0.12] = sz;
    const base = new THREE.CylinderGeometry(r * 1.08, r * 1.15, h * 0.22, 40); base.translate(0, h * 0.11, 0);
    const win = new THREE.CylinderGeometry(r, r, h * 0.62, 40); win.translate(0, h * 0.53, 0);
    const cap = new THREE.CylinderGeometry(r * 0.96, r * 1.04, h * 0.16, 40); cap.translate(0, h * 0.92, 0);
    add(base, mats.sensorBody); add(win, mats.sensorGloss); add(cap, mats.sensorBody);
  } else if (sp.shape === 'puckLidar') {
    const [r = 0.05, h = 0.07] = sz;
    const c = new THREE.CylinderGeometry(r, r, h, 32); c.rotateZ(Math.PI / 2); c.translate(h / 2 - 0.01, 0, 0);
    add(c, mats.sensorGloss);
    const ring = new THREE.CylinderGeometry(r * 1.12, r * 1.12, h * 0.3, 32); ring.rotateZ(Math.PI / 2); ring.translate(0, 0, 0);
    add(ring, mats.sensorBody);
  } else if (sp.shape === 'camera') {
    const [r = 0.018, d = 0.03] = sz;
    const c = new THREE.CylinderGeometry(r, r * 1.15, d, 20); c.rotateZ(-Math.PI / 2); c.translate(d / 2 - 0.006, 0, 0);
    add(c, mats.sensorBody);
    const lens = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.004, 16); lens.rotateZ(-Math.PI / 2); lens.translate(d - 0.005, 0, 0);
    add(lens, mats.lens);
  } else if (sp.shape === 'dome') {
    const [r = 0.3, hh = 0.14] = sz;
    const pr: Pt[] = [[0, hh], [r * 0.5, hh], [r * 0.62, hh * 0.86], [r * 0.9, hh * 0.5], [r, hh * 0.2], [r, 0]];
    add(new THREE.LatheGeometry(pr.map(([a, b]) => new THREE.Vector2(a, b)).reverse(), 48), mats.sensorGloss);
  } else if (sp.shape === 'radar') {
    const [l = 0.02, h = 0.07, w = 0.1] = sz;
    add(new RoundedBoxGeometry(l, h, w, 2, Math.min(l, h, w) * 0.3), mats.sensorBody);
  } else {
    const [l = 0.1, h = 0.08, w = 0.12] = sz;
    const geo = new RoundedBoxGeometry(l, h, w, 4, Math.min(l, h, w) * 0.28);
    add(geo, mats[sp.material ?? (sp.shape === 'windowLidar' ? 'sensorGloss' : 'sensorGloss')]);
    if (sp.shape === 'windowLidar') {
      const win = new RoundedBoxGeometry(0.006, h * 0.6, w * 0.8, 2, 0.002); win.translate(l / 2, 0, 0);
      add(win, mats.lens);
    }
  }
  return g;
}

function seat(width: number, mats: MaterialSet, yard = false): THREE.Group {
  const g = new THREE.Group();
  const cushion = rbox(yard, 0.5, 0.13, width, 4, 0.05); cushion.translate(0.02, 0, 0);
  const back = rbox(yard, 0.13, 0.62, width, 4, 0.05); back.translate(0, 0.31, 0); back.rotateZ(0.2); back.translate(-0.24, 0.02, 0);
  const n = Math.max(1, Math.round(width / 0.5));
  g.add(new THREE.Mesh(cushion, mats.seat), new THREE.Mesh(back, mats.seat));
  for (let i = 0; i < n && !yard; i++) {
    const head = new RoundedBoxGeometry(0.1, 0.18, 0.26, 3, 0.04);
    head.translate(-0.39, 0.72, (i - (n - 1) / 2) * (width / n));
    g.add(new THREE.Mesh(head, mats.seat));
  }
  return g;
}

export interface BuildOptions {
  /** Stations along the body. Lower for a lighter mesh. */
  detail?: number;
  /**
   * The yard's light model (yardLod.ts bakes it): the outer skin alone on a coarser ring, with no inner skin, edge
   * walls or wheel-housing liners, plain wheels, box seats, and no sensor under YARD_MIN_SENSOR_M. Same surface, same
   * cuts, same node names and door rigs as the full model.
   */
  yard?: boolean;
}

/** Stations along the body of the yard's light model. */
export const YARD_DETAIL = 44;

export function buildVehicle(spec: VehicleSpec, opts: BuildOptions = {}): THREE.Group {
  const s = makeSurface(spec.curves);
  const L = s.length;
  const mats = makeMaterials(spec.colors, spec.finish ?? 'solid');
  const root = new THREE.Group();
  root.name = spec.key;
  const h = helpers(s);
  const regions = spec.regions(s, h);
  const d = spec.dims;
  const axles = [d.frontAxle, d.frontAxle + d.wheelbase];
  const wheels = axles.map((xr) => ({ xr, y: d.tyreRadius, r: spec.archRadius }));

  // 1. Skin, with the wheel arches opened.
  const yard = opts.yard === true;
  let body = yard ? s.grid(opts.detail ?? YARD_DETAIL, YARD_SPAN_SAMPLES) : s.grid(opts.detail ?? 230);
  for (const w of wheels) {
    body = splitAll(s, body, [(p) => Math.hypot(p.xr - w.xr, p.y - w.y) - w.r, (p) => 1.25 - p.tt, (p) => p.tt - (K_BELT - 0.05)]).outside;
  }

  // 2. Doors: the opening is cut at the shut line, the panel 4 mm inside it.
  const doors = spec.doors(s);
  const doorTris: { d: DoorSpec; tris: Tri[] }[] = [];
  for (const door of doors) {
    if (yard) {
      // The yard's light model cuts only the door's own side of the car, so the cut lines do not run on round the
      // far side and the roof, where they only add triangles. Its panel fills its opening: a 4 mm shut line is under
      // a pixel in the yard and costs a second cut.
      const own: Tri[] = [];
      const far: Tri[] = [];
      for (const t of body) (door.side * (t[0].z + t[1].z + t[2].z) > 0 ? own : far).push(t);
      const cut = splitAll(s, own, doorFields(door, wheels, 0, true));
      body = far.concat(cut.outside);
      doorTris.push({ d: door, tris: cut.inside });
      continue;
    }
    const cut = splitAll(s, body, doorFields(door, wheels, 0));
    body = cut.outside;
    doorTris.push({ d: door, tris: splitAll(s, cut.inside, doorFields(door, wheels, 0.004)).inside });
  }

  // 3. Body.
  const bodyNode = new THREE.Group();
  bodyNode.name = 'body';
  bodyNode.add(...finishPanel(s, body, regions, 'body', 0.04, 'cavity', yard).meshes(mats, new THREE.Vector3()));
  root.add(bodyNode);

  // 4. Door panels on their pivots.
  for (const { d: door, tris } of doorTris) {
    const node = new THREE.Group();
    node.name = `door_${door.id}`;
    // The door's motion has one derivation (doorRigs.ts): the robots place the open leaf with the same rig.
    const info = doorRigOf(door, s);
    const pivot = new THREE.Vector3(...info.pivot);
    node.position.copy(pivot);
    node.userData.door = info;
    node.add(...finishPanel(s, tris, regions, 'doors', 0.055, 'interior', yard).meshes(mats, pivot));
    root.add(node);
  }

  // 5. Wheels and arch liners.
  const names = ['F', 'R'];
  axles.forEach((xr, ai) => {
    for (const side of [-1, 1] as const) {
      const w = wheel(spec, mats, yard);
      w.name = `wheel_${names[ai]}${side < 0 ? 'L' : 'R'}`;
      w.position.set(L / 2 - xr, d.tyreRadius, side * d.track / 2);
      if (side < 0) w.rotation.y = Math.PI;
      root.add(w);
      if (yard) continue;
      const hw = s.at(xr).hw;
      const depth = 0.36;
      // The top of the wheel housing: an open half barrel and its back wall.
      const liner = new THREE.CylinderGeometry(spec.archRadius + 0.004, spec.archRadius + 0.004, depth, 40, 1, true, Math.PI / 2 - 0.3, Math.PI + 0.6);
      liner.rotateX(Math.PI / 2);
      const lm = new THREE.Mesh(liner, mats.cavity);
      lm.name = 'arch_liner';
      lm.position.set(L / 2 - xr, d.tyreRadius, side * (hw - depth / 2 - 0.012));
      bodyNode.add(lm);
      const back = new THREE.Mesh(new THREE.CircleGeometry(spec.archRadius + 0.004, 40, -0.3, Math.PI + 0.6), mats.cavity);
      back.name = 'arch_liner';
      back.position.set(L / 2 - xr, d.tyreRadius, side * (hw - depth - 0.012));
      bodyNode.add(back);
    }
  });

  // 6. Cabin: floor, seats, dash.
  const cabin = new THREE.Group();
  cabin.name = 'interior';
  const mid = s.at(L / 2);
  const floorY = mid.yb + 0.11;
  const fl = new THREE.Mesh(new THREE.BoxGeometry(d.wheelbase + 0.35, 0.03, mid.hw * 2 - 0.2), mats.interior);
  fl.position.set(L / 2 - (d.frontAxle + d.wheelbase / 2), floorY, 0);
  cabin.add(fl);
  for (const st of spec.seats) {
    const g = seat(st.width ?? 0.5, mats, yard);
    g.position.set(L / 2 - st.xr, floorY + 0.3, st.z);
    if (st.facing < 0) g.rotation.y = Math.PI;
    cabin.add(g);
  }
  const forward = spec.seats.filter((x) => x.facing > 0);
  if (forward.length && spec.seats.every((x) => x.facing > 0)) {
    const firstRow = Math.min(...forward.map((x) => x.xr));
    const dashXr = firstRow - 0.72;
    const st = s.at(dashXr);
    const dash = new THREE.Mesh(rbox(yard, 0.34, 0.2, st.hw * 2 - 0.3, 3, 0.06), mats.interior);
    dash.position.set(L / 2 - dashXr, st.belt - 0.12, 0);
    cabin.add(dash);
    if (spec.steeringWheel && !yard) {
      const sw = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.016, 10, 32), mats.trim);
      sw.rotation.y = Math.PI / 2;
      sw.rotation.z = -0.4;
      sw.position.set(L / 2 - dashXr - 0.3, st.belt - 0.06, -0.37);
      cabin.add(sw);
    }
  }
  root.add(cabin);

  // 7. Mirrors. A mirror on a door moves with it.
  if (spec.mirrors) {
    for (const side of [-1, 1] as const) {
      const m = new THREE.Group();
      m.name = `mirror_${side < 0 ? 'L' : 'R'}`;
      const p = s.point(spec.mirrors.xr, K_BELT + 0.25, side);
      m.position.set(p[0], spec.mirrors.y, p[2]);
      const arm = new THREE.Mesh(rbox(yard, 0.07, 0.03, 0.12, 2, 0.012), mats.trim);
      arm.position.set(0, -0.02, side * 0.05);
      const head = new THREE.Mesh(rbox(yard, 0.1, 0.13, 0.2, 4, 0.04), mats.paint);
      head.position.set(-0.01, 0.03, side * 0.17);
      m.add(arm, head);
      if (!yard) {
        const glass = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.1, 0.16, 2, 0.002), mats.lens);
        glass.position.set(-0.062, 0.03, side * 0.17);
        m.add(glass);
      }
      const host = doors.find((x) => x.side === side && polyline(x.front)(K_BELT) <= spec.mirrors!.xr && spec.mirrors!.xr <= polyline(x.rear)(K_BELT));
      const hostNode = host ? root.getObjectByName(`door_${host.id}`) : undefined;
      if (hostNode) { m.position.sub(hostNode.position); hostNode.add(m); } else root.add(m);
    }
  }

  // 8. Sensors.
  for (const sp of spec.sensors) root.add(sensorNode(sp, s, mats, yard));

  // 9. Charge port: a flap outline with the port's position recorded for the robots.
  if (spec.chargePort) {
    const cp = spec.chargePort;
    const g = new THREE.Group();
    g.name = 'charge_port';
    let p: [number, number, number];
    let n: [number, number, number];
    if (cp.face === 'rear') {
      // On the tail: walk forward from the bumper's tip until the body is as tall as the inlet is high.
      p = [-L / 2, cp.y, cp.z ?? 0];
      n = [-1, 0, 0];
      for (let xr = L; xr > L - 0.4; xr -= 0.002) {
        const st = s.at(xr);
        if (st.yb < cp.y - 0.08 && st.yt > cp.y + 0.08 && st.hw > Math.abs(cp.z ?? 0) + 0.1) { p = [L / 2 - xr, cp.y, cp.z ?? 0]; break; }
      }
    } else {
      const side = cp.face === 'left' ? -1 : 1;
      // Find the ring position at the port's height.
      let lo = K_SILL_SAFE;
      let hi = K_RAIL; // a tall-glazed body (the Zoox) carries its inlet above its beltline
      for (let i = 0; i < 24; i++) { const m2 = (lo + hi) / 2; if (s.point(cp.xr, m2, side)[1] < cp.y) lo = m2; else hi = m2; }
      p = s.point(cp.xr, lo, side);
      n = s.normalAt(cp.xr, lo, side);
    }
    g.position.set(p[0] + n[0] * 0.002, p[1] + n[1] * 0.002, p[2] + n[2] * 0.002);
    g.lookAt(g.position.clone().add(new THREE.Vector3(n[0], n[1], n[2])));
    if (!yard) g.add(new THREE.Mesh(new THREE.RingGeometry(0.072, 0.078, 32), mats.cavity));
    g.userData.chargePort = { ...cp, normal: n };
    root.add(g);
  }

  root.userData.vehicle = {
    key: spec.key, name: spec.name, operator: spec.operator, maker: spec.maker, dims: spec.dims, provenance: spec.provenance,
    chargePort: spec.chargePort ?? null,
    doors: doors.map((x) => ({ id: x.id, kind: x.kind, side: x.side })),
    sensors: spec.sensors.map((x) => ({ id: x.id, type: x.type })),
  };
  return root;
}

const K_SILL_SAFE = 2.4;
