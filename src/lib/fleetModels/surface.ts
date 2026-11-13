// The body surface of a fleet vehicle, and the tools that cut it into panels.
//
// A body is ONE closed surface P(u, v): u runs nose to tail, v runs round the cross-section. Every station's
// section is a closed cubic B-spline through a ring of control points placed from six side-view and plan-view
// curves (roof line, underside, half-width, beltline, roof rail, roof-rail half-width). Glass, doors, wheel arches
// and lamps are not separate solids: they are regions of that surface, cut along the zero line of a scalar field,
// so a door's edge and the opening it leaves are the same curve.
//
// Frame: metres, +X toward the nose, +Y up, +Z to the vehicle's right, origin on the ground under the middle of
// the body. Specs are authored in `xr`, metres back from the front bumper, the way a side drawing is read.

export type Pt = [number, number];

/** Monotone cubic (PCHIP) through keypoints sorted by x. No overshoot, so a roof never dips between two keys. */
export function pchip(keys: Pt[]): (x: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  const m = new Array<number>(n).fill(0);
  if (n === 2) { m[0] = m[1] = d[0]; }
  else {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    m[0] = d[0];
    m[n - 1] = d[n - 2];
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

/** Piecewise-linear through keypoints (door edges, lamp outlines). */
export function polyline(keys: Pt[]): (x: number) => number {
  return (x: number) => {
    if (x <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (x <= keys[i + 1][0]) {
        const t = (x - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        return keys[i][1] + t * (keys[i + 1][1] - keys[i][1]);
      }
    }
    return keys[keys.length - 1][1];
  };
}

/** Signed distance to a closed polygon (negative inside). */
export function sdPolygon(px: number, py: number, poly: Pt[]): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const ex = bx - ax;
    const ey = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const dx = wx - ex * t;
    const dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d);
}

/** How a station's section is drawn between its key heights. All fractions of the local half-width. */
export interface SectionStyle {
  /** How far the sill tucks in under the body side (0.03 slab .. 0.12 sports car). */
  tuck: number;
  /** How far the body side leans in at the shoulder, below the glass. */
  barrel: number;
  /** Roof crown: how far the roof edge sits below the centreline, as a fraction of (top - roof rail). */
  crown: number;
  /** Outward bow of the side glass between belt and roof rail, metres. */
  glassBow: number;
}

export interface BodyCurves {
  length: number;
  /** Upper silhouette on the centreline, [xr, y]. Authored without the bumper rounding; `cap` adds it. */
  top: Pt[];
  /** Underside. */
  bottom: Pt[];
  /** Half-width of the body at its widest, [xr, z]. */
  plan: Pt[];
  /** Beltline: the foot of the side glass, continuing forward as the wing top. */
  belt: Pt[];
  /** Roof rail: wing edge, A-pillar, cant rail, rear pillar. The head of the side glass. */
  rail: Pt[];
  /** Half-width at the roof rail. */
  railPlan: Pt[];
  /** Bumper rounding. The section shrinks toward (0, y) over `plan` metres in plan and `elev` in elevation. */
  cap: { front: { y: number; plan: number; elev: number; p: number }; rear: { y: number; plan: number; elev: number; p: number } };
  style: SectionStyle;
}

/** Control ring: index of the belt knot, the roof-rail knot and the roof centreline in the half ring. */
export const K_SILL = 2;
export const K_WAIST = 4;
export const K_BELT = 6;
export const K_RAIL = 8;
export const K_TOP = 11;
const N_RING = 2 * K_TOP;
/** Samples per control span of the half ring. Denser where the section turns. */
const SPAN_SAMPLES = [4, 5, 5, 6, 6, 5, 6, 6, 6, 5, 4];

export interface SurfVertex {
  id: number;
  u: number;
  v: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  /** Metres back from the front bumper. */
  xr: number;
  /** Ring parameter folded onto one side: 0 underside centre .. K_TOP roof centre. */
  tt: number;
  /** -1 left of the centreline, +1 right. */
  side: number;
}

export type Tri = [SurfVertex, SurfVertex, SurfVertex];
/** A scalar field over the surface. A region is where it is negative. */
export type Field = (p: SurfVertex) => number;

export interface Surface {
  curves: BodyCurves;
  length: number;
  vertex(u: number, v: number): SurfVertex;
  /** The whole skin as triangles, outward-facing. */
  grid(nu?: number): Tri[];
  /** Height of a curve at xr, after the bumper rounding. */
  at(xr: number): { hw: number; yb: number; yt: number; belt: number; rail: number; railW: number };
  /** Surface point at a station and folded ring parameter, on one side. */
  point(xr: number, tt: number, side: number): [number, number, number];
  /** Outward unit normal there. */
  normalAt(xr: number, tt: number, side: number): [number, number, number];
}

function capScale(d: number, a: number, p: number): number {
  if (a <= 0 || d >= a) return 1;
  const t = Math.max(0, d / a);
  return Math.pow(1 - Math.pow(1 - t, p), 1 / p);
}

export function makeSurface(c: BodyCurves): Surface {
  const L = c.length;
  const fTop = pchip(c.top);
  const fBot = pchip(c.bottom);
  const fPlan = pchip(c.plan);
  const fBelt = pchip(c.belt);
  const fRail = pchip(c.rail);
  const fRailW = pchip(c.railPlan);
  const st = c.style;
  let nextId = 1;

  function raw(xr: number) {
    const yt = fTop(xr);
    const yb = fBot(xr);
    const hw = fPlan(xr);
    const belt = Math.min(fBelt(xr), yt - 0.06);
    const rail = Math.max(belt + 0.02, Math.min(fRail(xr), yt - 0.012));
    const railW = Math.min(fRailW(xr), hw * (1 - st.barrel) - 0.004);
    return { hw, yb, yt, belt, rail, railW };
  }

  /** The half ring of control points at a station, bumper rounding applied. [z, y] pairs. */
  function ring(xr: number): Pt[] {
    const s = raw(xr);
    const { hw, yb, yt, belt, rail, railW } = s;
    const wb = hw * (1 - st.barrel);
    const waistY = yb + 0.5 * (belt - yb);
    const topEdgeY = rail + (yt - rail) * (1 - st.crown);
    const pts: Pt[] = [
      [0, yb],
      [hw * 0.55, yb],
      [hw * 0.9, yb + 0.015],
      [hw * (1 - st.tuck), yb + Math.min(0.17, 0.3 * (belt - yb))],
      [hw, waistY],
      [wb + (hw - wb) * 0.35, belt - Math.min(0.09, 0.25 * (belt - yb))],
      [wb, belt],
      [(wb + railW) / 2 + st.glassBow, (belt + rail) / 2],
      [railW, rail],
      [railW * 0.66, topEdgeY],
      [railW * 0.33, yt - (yt - topEdgeY) * 0.12],
      [0, yt],
    ];
    // The spline at a knot is (a + 4b + c) / 6: put the widest point and the roof centre exactly on their marks.
    const zAtWaist = (pts[K_WAIST - 1][0] + 4 * pts[K_WAIST][0] + pts[K_WAIST + 1][0]) / 6;
    const zs = hw / zAtWaist;
    for (const p of pts) p[0] *= zs;
    pts[K_TOP][1] = (6 * yt - 2 * pts[K_TOP - 1][1]) / 4;
    // Bumper rounding.
    const front = xr < L / 2;
    const cap = front ? c.cap.front : c.cap.rear;
    const d = front ? xr : L - xr;
    const fz = capScale(d, cap.plan, cap.p);
    const fy = capScale(d, cap.elev, cap.p);
    if (fz < 1 || fy < 1) for (const p of pts) { p[0] *= fz; p[1] = cap.y + (p[1] - cap.y) * fy; }
    return pts;
  }

  function at(xr: number) {
    const r = ring(xr);
    return {
      hw: (r[K_WAIST - 1][0] + 4 * r[K_WAIST][0] + r[K_WAIST + 1][0]) / 6,
      yb: r[0][1],
      yt: (2 * r[K_TOP - 1][1] + 4 * r[K_TOP][1]) / 6,
      belt: r[K_BELT][1], rail: r[K_RAIL][1], railW: r[K_RAIL][0],
    };
  }

  /** Closed uniform cubic B-spline over the mirrored ring. t in [0, N_RING). */
  function section(pts: Pt[], t: number): Pt {
    const i = Math.floor(t);
    const f = t - i;
    const cp = (k: number): Pt => {
      const m = ((k % N_RING) + N_RING) % N_RING;
      return m <= K_TOP ? pts[m] : [-pts[N_RING - m][0], pts[N_RING - m][1]];
    };
    const a = cp(i - 1);
    const b = cp(i);
    const cc = cp(i + 1);
    const dd = cp(i + 2);
    const f2 = f * f;
    const f3 = f2 * f;
    const w0 = (1 - 3 * f + 3 * f2 - f3) / 6;
    const w1 = (4 - 6 * f2 + 3 * f3) / 6;
    const w2 = (1 + 3 * f + 3 * f2 - 3 * f3) / 6;
    const w3 = f3 / 6;
    return [w0 * a[0] + w1 * b[0] + w2 * cc[0] + w3 * dd[0], w0 * a[1] + w1 * b[1] + w2 * cc[1] + w3 * dd[1]];
  }

  // u -> xr, clustered toward both bumpers where the surface turns fastest.
  const xrOf = (u: number) => L * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u))));
  const uOf = (xr: number) => Math.acos(1 - 2 * Math.min(1, Math.max(0, xr / L))) / Math.PI;

  let ringCacheXr = NaN;
  let ringCache: Pt[] = [];
  function pos(u: number, v: number): [number, number, number] {
    const xr = xrOf(u);
    if (xr !== ringCacheXr) { ringCache = ring(xr); ringCacheXr = xr; }
    const t = (((v % 1) + 1) % 1) * N_RING;
    const [z, y] = section(ringCache, t);
    return [L / 2 - xr, y, z];
  }

  function normal(u: number, v: number, p: [number, number, number]): [number, number, number] {
    const eu = 2e-4;
    const ev = 2e-4;
    const u0 = Math.max(0, u - eu);
    const u1 = Math.min(1, u + eu);
    const a = pos(u0, v);
    const b = pos(u1, v);
    const cM = pos(u, v - ev);
    const dP = pos(u, v + ev);
    const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const dv = [dP[0] - cM[0], dP[1] - cM[1], dP[2] - cM[2]];
    let nx = dv[1] * du[2] - dv[2] * du[1];
    let ny = dv[2] * du[0] - dv[0] * du[2];
    let nz = dv[0] * du[1] - dv[1] * du[0];
    let len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) { nx = p[0] > 0 ? 1 : -1; ny = 0; nz = 0; len = 1; }
    return [nx / len, ny / len, nz / len];
  }

  function vertex(u: number, v: number): SurfVertex {
    const vv = ((v % 1) + 1) % 1;
    const p = pos(u, vv);
    const n = normal(u, vv, p);
    const t = vv * N_RING;
    const tt = t <= K_TOP ? t : N_RING - t;
    return { id: nextId++, u, v: vv, x: p[0], y: p[1], z: p[2], nx: n[0], ny: n[1], nz: n[2], xr: L / 2 - p[0], tt, side: t <= K_TOP ? 1 : -1 };
  }

  function grid(nu = 230): Tri[] {
    const vs: number[] = [];
    for (let k = 0; k < N_RING; k++) {
      const span = k < K_TOP ? k : N_RING - 1 - k;
      const n = SPAN_SAMPLES[span];
      for (let j = 0; j < n; j++) vs.push((k + j / n) / N_RING);
    }
    const nv = vs.length;
    const rows: SurfVertex[][] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      if (i === 0 || i === nu) { const pole = vertex(u, 0.25); rows.push(vs.map(() => pole)); }
      else rows.push(vs.map((v) => vertex(u, v)));
    }
    const tris: Tri[] = [];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const j1 = (j + 1) % nv;
        const a = rows[i][j];
        const b = rows[i + 1][j];
        const cV = rows[i + 1][j1];
        const d = rows[i][j1];
        if (i > 0) tris.push([a, d, cV]);
        if (i < nu - 1) tris.push([a, cV, b]);
      }
    }
    // Orient outward: one mid-body triangle decides, and every triangle follows the same winding rule.
    const probe = tris[Math.floor(tris.length / 2)];
    const [pa, pb, pc] = probe;
    const px = (pb.y - pa.y) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.y - pa.y);
    const py = (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z);
    const pz = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    const inverted = px * pa.nx + py * pa.ny + pz * pa.nz < 0;
    return inverted ? tris.map(([a, b, cV]) => [a, cV, b] as Tri) : tris;
  }

  function point(xr: number, tt: number, side: number): [number, number, number] {
    const v = (side >= 0 ? tt : N_RING - tt) / N_RING;
    return pos(uOf(xr), v);
  }
  function normalAt(xr: number, tt: number, side: number): [number, number, number] {
    const v = (side >= 0 ? tt : N_RING - tt) / N_RING;
    const u = uOf(xr);
    return normal(u, v, pos(u, v));
  }

  return { curves: c, length: L, vertex, grid, at, point, normalAt };
}

/**
 * Cut a triangle set along the zero line of a field. Returns the part where it is negative and the rest.
 * New vertices are found on the surface itself (the parameters are interpolated and the point re-evaluated), and
 * an edge shared by two triangles gets one new vertex, so the cut stays watertight and its two sides share a curve.
 */
export function split(s: Surface, tris: Tri[], f: Field): { inside: Tri[]; outside: Tri[] } {
  const val = new Map<number, number>();
  const fv = (p: SurfVertex) => {
    let x = val.get(p.id);
    if (x === undefined) { x = f(p); if (x === 0) x = 1e-9; val.set(p.id, x); }
    return x;
  };
  const edge = new Map<string, SurfVertex>();
  const lerpParam = (a: SurfVertex, b: SurfVertex, t: number): SurfVertex => {
    let va = a.v;
    let vb = b.v;
    // A pole has no ring position of its own.
    if (a.u === 0 || a.u === 1) va = vb;
    if (b.u === 0 || b.u === 1) vb = va;
    if (va - vb > 0.5) vb += 1;
    else if (vb - va > 0.5) va += 1;
    return s.vertex(a.u + (b.u - a.u) * t, va + (vb - va) * t);
  };
  const cross = (a: SurfVertex, b: SurfVertex): SurfVertex => {
    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    const hit = edge.get(key);
    if (hit) return hit;
    const [p, q] = a.id < b.id ? [a, b] : [b, a];
    let lo = 0;
    let hi = 1;
    let flo = fv(p);
    let fhi = fv(q);
    let m = p;
    for (let it = 0; it < 5; it++) {
      const t = lo + (hi - lo) * (flo / (flo - fhi));
      m = lerpParam(p, q, t);
      const fm = f(m);
      if (Math.abs(fm) < 2e-5) break;
      if ((fm < 0) === (flo < 0)) { lo = t; flo = fm; } else { hi = t; fhi = fm; }
    }
    val.set(m.id, 0);
    edge.set(key, m);
    return m;
  };
  const inside: Tri[] = [];
  const outside: Tri[] = [];
  for (const t of tris) {
    const fa = fv(t[0]);
    const fb = fv(t[1]);
    const fc = fv(t[2]);
    const neg = (fa < 0 ? 1 : 0) + (fb < 0 ? 1 : 0) + (fc < 0 ? 1 : 0);
    if (neg === 3) { inside.push(t); continue; }
    if (neg === 0) { outside.push(t); continue; }
    // Rotate so that vertex `a` is the odd one out.
    const oddNeg = neg === 1;
    const i0 = oddNeg ? (fa < 0 ? 0 : fb < 0 ? 1 : 2) : (fa >= 0 ? 0 : fb >= 0 ? 1 : 2);
    const a = t[i0];
    const b = t[(i0 + 1) % 3];
    const c = t[(i0 + 2) % 3];
    const ab = cross(a, b);
    const ca = cross(c, a);
    const one: Tri[] = [[a, ab, ca]];
    const two: Tri[] = [[ab, b, c], [ab, c, ca]];
    if (oddNeg) { inside.push(...one); outside.push(...two); }
    else { outside.push(...one); inside.push(...two); }
  }
  return { inside, outside };
}

/** The part of a triangle set where EVERY field is negative, and the rest. Sequential cuts keep corners sharp. */
export function splitAll(s: Surface, tris: Tri[], fields: Field[]): { inside: Tri[]; outside: Tri[] } {
  let cur = tris;
  const outside: Tri[] = [];
  for (const f of fields) {
    const r = split(s, cur, f);
    outside.push(...r.outside);
    cur = r.inside;
    if (!cur.length) break;
  }
  return { inside: cur, outside };
}

/** Edges used by exactly one triangle: the rim of a panel. Returned in the triangle's own winding. */
export function boundaryEdges(tris: Tri[]): [SurfVertex, SurfVertex][] {
  const count = new Map<string, { a: SurfVertex; b: SurfVertex; n: number }>();
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const a = t[i];
      const b = t[(i + 1) % 3];
      if (a.id === b.id) continue;
      const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      const e = count.get(key);
      if (e) e.n++;
      else count.set(key, { a, b, n: 1 });
    }
  }
  const out: [SurfVertex, SurfVertex][] = [];
  for (const e of count.values()) if (e.n === 1) out.push([e.a, e.b]);
  return out;
}
