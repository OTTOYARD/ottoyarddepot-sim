/**
 * The robots' flexible lines: the cables, hoses, ducts and energy chains that cross their moving joints
 * (cad/otto_cad/flex.py defines them; the GLB carries them in its root `extras.flex`, in metres).
 *
 * A rigid part moves with its node. A line that runs from one node to another cannot: its shape changes with
 * the pose. So the CAD gives each line what does not change (where it is held at each end, how long it is, how
 * tight it may bend) and the shape is SOLVED at each pose, here exactly as flex.py solves it, so the line the
 * viewer draws is the line the CAD checked (cadFlex.test.ts holds the two to the same points):
 *
 *   loop     fixed length between 2 anchors: 2 cubic curves meeting at a middle point that stands off the
 *            chord's midpoint along the loop's bulge (gravity, or away from the joint), as far as makes the
 *            curve the line's length; or (shape 'cubic', a long span held by a take-up) one cubic whose 2
 *            handles grow together, dropped at mid-length by a share of the handle; a spring take-up may hold
 *            the length at a share of the chord, and a swivel (ball-joint clamp, turning outlet) may let an
 *            end's direction turn toward the other end
 *   stretch  a straight run whose length follows its anchors: a cable on a spring reel, a coiled cable, a
 *            bellows duct
 *   chain    an energy chain on a linear axis: a fixed run, a 180 degree bend, a run that moves with the machine
 *
 * Pure maths over three.js matrices; meshes are built in flexMesh.ts.
 */
import * as THREE from 'three';

export type V3 = [number, number, number];

export interface FlexAnchorJson { node: string; p: V3; d: V3 }
export interface FlexMaterialJson { key: string; color: string; metal: number; rough: number }

export interface FlexDefJson {
  id: string;
  name: string;
  kind: 'loop' | 'stretch' | 'chain';
  style: 'tube' | 'bellows' | 'coil' | 'chain';
  sub: string;
  a: FlexAnchorJson;
  b: FlexAnchorJson;
  /** section radius, metres (a chain: its half height) */
  r: number;
  material: FlexMaterialJson;
  /** loop */
  length?: number;
  minBend?: number;
  hk?: number;
  bulge?: { g: number; a: V3; b: V3 };
  /** 'u' (2 cubics through a middle point, the default) or 'cubic' (one cubic, handles equal, sag x handle at mid-length) */
  shape?: 'u' | 'cubic';
  sag?: number;
  /** a spring retractor holds the loop at retractK x its chord, within [lmin, lmax] */
  retractK?: number;
  /** degrees an end's direction may turn toward the other end (a ball-joint clamp, a turning cable outlet) */
  swivelA?: number;
  swivelB?: number;
  /** a ball joint shared with another line: that line's far end (the joint points along the 2 chords' bisector) */
  pairA?: FlexAnchorJson;
  pairB?: FlexAnchorJson;
  /** stretch */
  lmin?: number;
  lmax?: number;
  /** bellows (rectangular) and chain sections */
  w?: number;
  h?: number;
  xd?: V3;
  /** coil */
  turns?: number;
  coilR?: number;
  /** chain */
  pitch?: number;
  bendR?: number;
  links?: number;
  up?: V3;
  /** the bill of materials' part id of one link (a chain is counted there as `links` of it) */
  linkPart?: string;
}

export const N_SEG = 32;
const BISECT = 48;
const HMAX_GROW = 6;
const G: V3 = [0, -1, 0];

// ── small vector helpers on tuples (double precision, as numpy) ─────────────────────────────────────────────
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): number => Math.sqrt(dot(a, a));
const unit = (a: V3): V3 => { const n = norm(a); return n > 0 ? mul(a, 1 / n) : [0, 0, 0]; };

/** Points of a polyline, flat [x, y, z, x, y, z, ...]. */
export type Polyline = Float64Array;

function bezierInto(out: Polyline, at: number, p0: V3, p1: V3, p2: V3, p3: V3, n: number, skipFirst: boolean): number {
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out[at++] = a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0];
    out[at++] = a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1];
    out[at++] = a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2];
  }
  return at;
}

/** The loop's centreline with its middle point `delta` off the chord's midpoint along the unit bulge b (flex.loop_points). */
export function loopPoints(pA: V3, tA: V3, pB: V3, tB: V3, b: V3, delta: number, hk = 0.5, n = N_SEG, out?: Polyline): Polyline {
  const P = out ?? new Float64Array((n + 1) * 3);
  const c = sub(pB, pA);
  const d = norm(c);
  const ch: V3 = d > 1e-9 ? mul(c, 1 / d) : [1, 0, 0];
  let tm = sub(ch, mul(b, dot(ch, b)));
  if (norm(tm) < 1e-6) tm = Math.abs(b[0]) < 0.9 ? cross(b, [1, 0, 0]) : cross(b, [0, 0, 1]);
  tm = unit(tm);
  const M = add(mul(add(pA, pB), 0.5), mul(b, delta));
  const ha = hk * norm(sub(M, pA));
  const hb = hk * norm(sub(pB, M));
  const half = Math.floor(n / 2);
  let at = bezierInto(P, 0, pA, add(pA, mul(tA, ha)), sub(M, mul(tm, ha)), M, half, false);
  at = bezierInto(P, at, M, add(M, mul(tm, hb)), sub(pB, mul(tB, hb)), pB, half, true);
  return P;
}

/** One cubic from A to B with both handles h long, dropped by sag x h at mid-length (flex.cubic_points). */
export function cubicPoints(pA: V3, tA: V3, pB: V3, tB: V3, h: number, sag: number, n = N_SEG, out?: Polyline): Polyline {
  const P = out ?? new Float64Array((n + 1) * 3);
  bezierInto(P, 0, pA, add(pA, mul(tA, h)), sub(pB, mul(tB, h)), pB, n, false);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k = sag * h * 4 * t * (1 - t);
    P[3 * i] += G[0] * k; P[3 * i + 1] += G[1] * k; P[3 * i + 2] += G[2] * k;
  }
  return P;
}

/** The single cubic of length L between the anchors (flex.solve_cubic): bisect on the handle length. */
export function solveCubic(pA: V3, tA: V3, pB: V3, tB: V3, L: number, sag: number): LoopSolution {
  const d = norm(sub(pB, pA));
  const buf = new Float64Array((N_SEG + 1) * 3);
  const f = (h: number) => polylineLength(cubicPoints(pA, tA, pB, tB, h, sag, N_SEG, buf)) - L;
  if (d >= L || f(0) >= 0) return { points: cubicPoints(pA, tA, pB, tB, 0, sag), tight: true, delta: 0, chord: d };
  let lo = 0, hi = 0.5 * L, k = 0;
  while (f(hi) < 0 && k < HMAX_GROW) { lo = hi; hi *= 2; k++; }
  for (let i = 0; i < BISECT; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  const h = 0.5 * (lo + hi);
  return { points: cubicPoints(pA, tA, pB, tB, h, sag), tight: false, delta: h, chord: d };
}

export function polylineLength(P: Polyline): number {
  let L = 0;
  for (let i = 3; i < P.length; i += 3) {
    const dx = P[i] - P[i - 3], dy = P[i + 1] - P[i - 2], dz = P[i + 2] - P[i - 1];
    L += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return L;
}

/** The tightest bend along a polyline: the smallest circle through 3 neighbouring points (flex.min_radius). */
export function minRadius(P: Polyline): number {
  let best = Infinity;
  const n = P.length / 3;
  for (let i = 1; i < n - 1; i++) {
    const p0: V3 = [P[3 * i - 3], P[3 * i - 2], P[3 * i - 1]];
    const p1: V3 = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
    const p2: V3 = [P[3 * i + 3], P[3 * i + 4], P[3 * i + 5]];
    const a = norm(sub(p1, p0)), b = norm(sub(p2, p1)), c = norm(sub(p2, p0));
    const area2 = norm(cross(sub(p1, p0), sub(p2, p0)));
    if (area2 < 1e-12) continue;
    best = Math.min(best, (a * b * c) / (2 * area2));
  }
  return best;
}

export interface LoopSolution { points: Polyline; tight: boolean; delta: number; chord: number }

/** The loop of length L between the anchors, its middle pushed along the unit bulge b (flex.solve_loop). */
export function solveLoop(pA: V3, tA: V3, pB: V3, tB: V3, b: V3, L: number, hk = 0.5): LoopSolution {
  const d = norm(sub(pB, pA));
  const buf = new Float64Array((N_SEG + 1) * 3);
  const f = (x: number) => polylineLength(loopPoints(pA, tA, pB, tB, b, x, hk, N_SEG, buf)) - L;
  if (d >= L || f(0) >= 0) return { points: loopPoints(pA, tA, pB, tB, b, 0, hk), tight: true, delta: 0, chord: d };
  let lo = 0, hi = 0.5 * L, k = 0;
  while (f(hi) < 0 && k < HMAX_GROW) { lo = hi; hi *= 2; k++; }
  for (let i = 0; i < BISECT; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  const x = 0.5 * (lo + hi);
  return { points: loopPoints(pA, tA, pB, tB, b, x, hk), tight: false, delta: x, chord: d };
}

/** d turned toward target by their angle, but by no more than maxDeg (both unit; flex.turn_toward). */
export function turnToward(d: V3, target: V3, maxDeg: number): V3 {
  const c = Math.min(1, Math.max(-1, dot(d, target)));
  const ang = Math.acos(c);
  const lim = (maxDeg * Math.PI) / 180;
  if (ang <= lim) return [target[0], target[1], target[2]];
  let ax = cross(d, target);
  const n = norm(ax);
  if (n < 1e-12) return [d[0], d[1], d[2]];
  ax = mul(ax, 1 / n);
  const ct = Math.cos(lim), st = Math.sin(lim);
  return add(add(mul(d, ct), mul(cross(ax, d), st)), mul(ax, dot(ax, d) * (1 - ct)));
}

/** A loop's length at a pose: fixed, or held by its retractor at retractK x the chord within [lmin, lmax]. */
export function loopLength(def: FlexDefJson, chord: number): number {
  if ((def.retractK ?? 0) > 0) return Math.min(def.lmax ?? Infinity, Math.max(def.lmin ?? 0, (def.retractK ?? 0) * chord));
  return def.length ?? 0;
}

export interface ChainLink { c: V3; t: V3; n: V3 }

/** An energy chain's links between its fixed end (pA, lying along dA, bending toward upA) and its moving end (flex.chain_path). */
export function chainPath(def: Pick<FlexDefJson, 'links' | 'pitch' | 'bendR'>, pA: V3, dA: V3, upA: V3, pB: V3): { links: ChainLink[]; ok: boolean; travel: number } {
  const s = dot(sub(pB, pA), dA);
  const R = def.bendR ?? 0, p = def.pitch ?? 0, n = def.links ?? 0;
  const C = n * p;
  const xb = (C - Math.PI * R + s) / 2;
  const ok = xb >= -1e-9 && xb >= s - 1e-9;
  const links: ChainLink[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) * p;
    let x: number, y: number, tx: number, ty: number;
    if (a <= xb) { x = a; y = 0; tx = 1; ty = 0; } else if (a <= xb + Math.PI * R) {
      const th = (a - xb) / R;
      x = xb + R * Math.sin(th); y = R - R * Math.cos(th); tx = Math.cos(th); ty = Math.sin(th);
    } else { x = xb - (a - xb - Math.PI * R); y = 2 * R; tx = -1; ty = 0; }
    links.push({
      c: add(add(pA, mul(dA, x)), mul(upA, y)),
      t: add(mul(dA, tx), mul(upA, ty)),
      n: add(mul(dA, -ty), mul(upA, tx)),
    });
  }
  return { links, ok, travel: s };
}

export interface FlexSolution {
  points: Polyline;
  ok: boolean;
  tight?: boolean;
  chord?: number;
  minRadius?: number;
  length?: number;
  links?: ChainLink[];
  travel?: number;
}

const _v = new THREE.Vector3();
function anchorWorld(an: FlexAnchorJson, M: THREE.Matrix4): { p: V3; d: V3 } {
  _v.set(an.p[0], an.p[1], an.p[2]).applyMatrix4(M);
  const p: V3 = [_v.x, _v.y, _v.z];
  _v.set(an.d[0], an.d[1], an.d[2]).transformDirection(M);
  return { p, d: [_v.x, _v.y, _v.z] };
}
function dirWorld(v: V3, M: THREE.Matrix4): V3 {
  if (v[0] === 0 && v[1] === 0 && v[2] === 0) return [0, 0, 0];
  const e = M.elements;   // rotation part only, not normalised: the bulge sums weighted directions
  return [e[0] * v[0] + e[4] * v[1] + e[8] * v[2], e[1] * v[0] + e[5] * v[1] + e[9] * v[2], e[2] * v[0] + e[6] * v[1] + e[10] * v[2]];
}

/** Where a swivel turns: the line's chord, or at a ball joint shared with another line, the 2 chords' bisector (flex._shared). */
function shared(ch: V3, pairWorld: V3 | null, p: V3, before: boolean): V3 {
  if (!pairWorld) return ch;
  const other = before ? unit(sub(p, pairWorld)) : unit(sub(pairWorld, p));
  const s = add(ch, other);
  return norm(s) > 1e-9 ? unit(s) : s;
}

/**
 * A line's shape and checks at a pose, given its 2 anchor nodes' world matrices (flex.solve). A line with a shared ball
 * joint (pairA / pairB) also needs that pair's node matrix: pass a lookup by node name.
 */
export function solveFlex(def: FlexDefJson, MA: THREE.Matrix4, MB: THREE.Matrix4, nodeMatrix?: (name: string) => THREE.Matrix4): FlexSolution {
  const A = anchorWorld(def.a, MA), B = anchorWorld(def.b, MB);
  if (def.kind === 'loop') {
    const bu = def.bulge ?? { g: 1, a: [0, 0, 0], b: [0, 0, 0] };
    let v = add(add(mul(G, bu.g), dirWorld(bu.a, MA)), dirWorld(bu.b, MB));
    v = norm(v) > 1e-9 ? unit(v) : G;
    const c = sub(B.p, A.p);
    const cn = norm(c);
    const ch = cn > 1e-9 ? mul(c, 1 / cn) : A.d;
    const pairWorld = (pr?: FlexAnchorJson): V3 | null => (pr && nodeMatrix ? anchorWorld(pr, nodeMatrix(pr.node)).p : null);
    const tA = (def.swivelA ?? 0) > 0 ? turnToward(A.d, shared(ch, pairWorld(def.pairA), A.p, true), def.swivelA ?? 0) : A.d;
    const tB = (def.swivelB ?? 0) > 0 ? turnToward(B.d, shared(ch, pairWorld(def.pairB), B.p, false), def.swivelB ?? 0) : B.d;
    const L = loopLength(def, cn);
    const r = def.shape === 'cubic' ? solveCubic(A.p, tA, B.p, tB, L, def.sag ?? 0) : solveLoop(A.p, tA, B.p, tB, v, L, def.hk ?? 0.5);
    const mr = r.tight ? 0 : minRadius(r.points);
    return { points: r.points, tight: r.tight, chord: r.chord, length: L, minRadius: mr, ok: !r.tight && mr >= (def.minBend ?? 0) };
  }
  if (def.kind === 'stretch') {
    const L = norm(sub(B.p, A.p));
    return { points: Float64Array.from([...A.p, ...B.p]), length: L, ok: L >= (def.lmin ?? 0) - 1e-9 && L <= (def.lmax ?? Infinity) + 1e-9 };
  }
  const up = unit(dirWorld(def.up ?? [0, 1, 0], MA));
  const dA = unit(sub(A.d, mul(up, dot(A.d, up))));
  const ch = chainPath(def, A.p, dA, up, B.p);
  const pts = new Float64Array(ch.links.length * 3);
  ch.links.forEach((l, i) => { pts[3 * i] = l.c[0]; pts[3 * i + 1] = l.c[1]; pts[3 * i + 2] = l.c[2]; });
  return { points: pts, links: ch.links, ok: ch.ok, travel: ch.travel };
}

/** The flex lines a loaded GLB carries (its root's extras.flex), or none. */
export function flexDefs(root: THREE.Object3D): FlexDefJson[] {
  let defs: FlexDefJson[] = [];
  root.traverse((o) => {
    const f = (o.userData as { flex?: unknown }).flex;
    if (Array.isArray(f) && defs.length === 0) defs = f as FlexDefJson[];
  });
  return defs;
}
