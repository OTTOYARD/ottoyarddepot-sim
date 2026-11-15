/**
 * THE ROBOTS' FLEXIBLE LINES, DRAWN. flexLines.ts solves each line (cable, hose, duct, energy chain) at a pose,
 * exactly as cad/otto_cad/flex.py does; this file turns the solutions into meshes that bend with the robot.
 *
 *   tube     a loop, a cable on a reel, a coiled cable (its helix): rings around the solved centreline, written in
 *            place into one merged buffer per material, so every robot of a kind shares one draw per material. Each
 *            tube is closed at both ends, and with `seat` it runs on a few millimetres past each anchor along its own
 *            direction, into the gland, collar or box face that holds it: an end never shows a slit to its fitting.
 *   bellows  a box from end to end (a rectangular duct on a slide)
 *   chain    an energy chain: one instanced link per link, along the solved fixed run, bend and moving run. With `links`
 *            each link is the CAD's own link (side bands, crossbars, a shelf), from the GLB; else a box.
 *   contents with `contents`, every line a chain carries, as a tube in its own lane through the chain, from a lead in
 *            its fixed end's fitting to a lead in its moving end's (FlexDefJson.contents)
 *
 * One fleet serves every robot of a kind: the yard (capacity = the robots of that kind, or the few drawn in detail) and
 * the Robotics tab (capacity 1, a mesh per line so a line can be picked out). A slot is re-solved only when its anchors
 * moved.
 *
 * The renderer decides nothing here: the pose is the twin's, the line's shape is the CAD's rule for it.
 */
import * as THREE from 'three';
import { N_SEG, solveFlex, contentPolyline, contentSamples, type FlexContentJson, type FlexDefJson, type Polyline } from './flexLines';

/** What a fleet needs of one robot: its root (the CAD frame) and its nodes by name, with world matrices current. */
export interface FlexSkeleton {
  root: THREE.Object3D;
  node(name: string): THREE.Object3D;
}

export interface FlexFleetOptions {
  /** sides of each tube's section (the yard's far model: 8; its detail model and the tab: 16) */
  radial?: number;
  /** points per turn of a coiled cable's helix */
  coilPerTurn?: number;
  /** one mesh and material per line (the tab, to pick a line out) instead of one per material (the yard) */
  split?: boolean;
  castShadow?: boolean;
  /** each chain's link as the CAD draws it (the GLB's flexlink nodes, cadDepot.takeFlexLinks), by the chain's id */
  links?: ReadonlyMap<string, THREE.BufferGeometry>;
  /** draw every line a chain carries, in its lane */
  contents?: boolean;
  /** how far a tube runs on past each of its anchors, into what holds it, metres */
  seat?: number;
  /** leave out a chain that lies wholly under this height (metres, the robot's frame): the yard's ground hides it */
  under?: number;
}

export interface FlexFleet {
  group: THREE.Group;
  /** the line ids each mesh draws, for the tab's highlight and for tests */
  meshes: { mesh: THREE.Mesh | THREE.InstancedMesh; ids: string[]; material: THREE.MeshStandardMaterial }[];
  /** solve and write one robot's lines; returns false if nothing moved since the last write */
  write(slot: number, skel: FlexSkeleton): boolean;
  /** hide one robot's lines */
  clear(slot: number): void;
  /** the last solution of each line in a slot (CAD frame, metres): for the tab's readout and the tests */
  last(slot: number): Map<string, { ok: boolean; minRadius?: number; length?: number }>;
  /** the last centreline drawn for each tube in a slot (the robot's frame, metres, seats and leads included): for tests */
  centreline(slot: number, id: string): Float64Array | null;
  dispose(): void;
}

const isTube = (d: FlexDefJson) => d.kind === 'loop' || (d.kind === 'stretch' && d.style !== 'bellows');
const isBellows = (d: FlexDefJson) => d.kind === 'stretch' && d.style === 'bellows' && (d.w ?? 0) > 0;

/** How many rings a line's tube draws: its solved points, or for a coil its helix (seats excluded). A loop's leads are
 *  points of their own (flexLines.solveFlex), so a boot draws straight in its fitting's collar, exactly as solved. */
function ringsOf(d: FlexDefJson, perTurn: number): number {
  if (d.kind === 'loop') return N_SEG + 1 + ((d.leadA ?? 0) > 0 ? 1 : 0) + ((d.leadB ?? 0) > 0 ? 1 : 0);
  if (d.style === 'coil') return Math.max(2, Math.round((d.turns ?? 8) * perTurn) + 1);
  return 2;
}

/** A coiled cable's centreline: a helix of `turns` turns of radius coilR round the straight line from A to B. */
export function coilPolyline(P: Polyline, turns: number, coilR: number, rings: number, out: Polyline): Polyline {
  const ax = [P[3] - P[0], P[4] - P[1], P[5] - P[2]];
  const L = Math.hypot(ax[0], ax[1], ax[2]) || 1e-9;
  const t = [ax[0] / L, ax[1] / L, ax[2] / L];
  const a = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]];
  const un = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / un, u[1] / un, u[2] / un];
  const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  for (let i = 0; i < rings; i++) {
    const k = i / (rings - 1);
    const th = k * turns * 2 * Math.PI;
    // the coil's ends come in to the axis over the first and last quarter turn, where the clamps hold it
    const ramp = Math.min(1, (k * turns) / 0.25, ((1 - k) * turns) / 0.25);
    const c = Math.cos(th) * coilR * ramp, s = Math.sin(th) * coilR * ramp;
    out[3 * i] = P[0] + ax[0] * k + u[0] * c + v[0] * s;
    out[3 * i + 1] = P[1] + ax[1] * k + u[1] * c + v[1] * s;
    out[3 * i + 2] = P[2] + ax[2] * k + u[2] * c + v[2] * s;
  }
  return out;
}

/** Resample a polyline to n points evenly along its length (a 2-point line, or a solved loop with N_SEG + 1). */
function resample(P: Polyline, m: number, n: number, out: Polyline, at = 0): Polyline {
  if (m === n) { for (let i = 0; i < 3 * n; i++) out[3 * at + i] = P[i]; return out; }
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    cum[i] = cum[i - 1] + Math.hypot(P[3 * i] - P[3 * i - 3], P[3 * i + 1] - P[3 * i - 2], P[3 * i + 2] - P[3 * i - 1]);
  }
  const L = cum[m - 1];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (L * i) / (n - 1);
    while (j < m - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    for (let k = 0; k < 3; k++) out[3 * (at + i) + k] = P[3 * j + k] + (P[3 * j + 3 + k] - P[3 * j + k]) * f;
  }
  return out;
}

/** Add a seat to each end of a centreline of n points held in `Q` from index 1: Q[0] and Q[n + 1] run on `seat` metres. */
function seatEnds(Q: Polyline, n: number, seat: number): void {
  const p0 = 3, p1 = 6, pn = 3 * n, pm = 3 * (n - 1);
  let dx = Q[p1] - Q[p0], dy = Q[p1 + 1] - Q[p0 + 1], dz = Q[p1 + 2] - Q[p0 + 2];
  let l = Math.hypot(dx, dy, dz) || 1;
  Q[0] = Q[p0] - (dx / l) * seat; Q[1] = Q[p0 + 1] - (dy / l) * seat; Q[2] = Q[p0 + 2] - (dz / l) * seat;
  dx = Q[pn] - Q[pm]; dy = Q[pn + 1] - Q[pm + 1]; dz = Q[pn + 2] - Q[pm + 2];
  l = Math.hypot(dx, dy, dz) || 1;
  const e = 3 * (n + 1);
  Q[e] = Q[pn] + (dx / l) * seat; Q[e + 1] = Q[pn + 1] + (dy / l) * seat; Q[e + 2] = Q[pn + 2] + (dz / l) * seat;
}

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/**
 * Write a closed tube of radius r round the centreline P (n points, CAD frame) into pos/nrm at vertex `at`, through the
 * matrix W (CAD frame to the mesh's frame): n rings of `radial` vertices, then each end's cap (a centre and a ring of its
 * own, facing along the line). Rings follow parallel-transported frames, so the tube does not twist.
 */
function writeTube(P: Polyline, n: number, r: number, radial: number, W: THREE.Matrix4, pos: Float32Array, nrm: Float32Array, at: number): void {
  _n.getNormalMatrix(W);
  let ux = 0, uy = 0, uz = 0;
  const put = (o: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number) => {
    _p.set(px, py, pz).applyMatrix4(W);
    _q.set(nx, ny, nz).applyMatrix3(_n).normalize();
    pos[o] = _p.x; pos[o + 1] = _p.y; pos[o + 2] = _p.z;
    nrm[o] = _q.x; nrm[o + 1] = _q.y; nrm[o + 2] = _q.z;
  };
  const tan = [0, 0, 0], first = [0, 0, 0, 0, 0, 0], lastU = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = P[3 * i1] - P[3 * i0], dy = P[3 * i1 + 1] - P[3 * i0 + 1], dz = P[3 * i1 + 2] - P[3 * i0 + 2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    if (i === 0) {
      // a first normal square to the tangent
      const ax = Math.abs(dx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
      ux = dy * 0 - dz * ay; uy = dz * ax - dx * 0; uz = dx * ay - dy * ax;
    } else {
      // transport the last normal onto the new tangent: remove its part along the tangent
      const k = ux * dx + uy * dy + uz * dz;
      ux -= k * dx; uy -= k * dy; uz -= k * dz;
    }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    if (i === 0) { first.splice(0, 6, ux, uy, uz, vx, vy, vz); tan[0] = -dx; tan[1] = -dy; tan[2] = -dz; }
    if (i === n - 1) lastU.splice(0, 6, ux, uy, uz, vx, vy, vz);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
      put(3 * (at + i * radial + j), P[3 * i] + nx * r, P[3 * i + 1] + ny * r, P[3 * i + 2] + nz * r, nx, ny, nz);
    }
    if (i === n - 1) {
      // the end caps: the first ring's cap faces back along the line, the last one's on along it
      const capAt = at + n * radial;
      const ends: [number, number[], number[]][] = [[0, first, tan], [n - 1, lastU, [dx, dy, dz]]];
      ends.forEach(([pi, uv, d], e) => {
        const o0 = capAt + e * (radial + 1);
        put(3 * o0, P[3 * pi], P[3 * pi + 1], P[3 * pi + 2], d[0], d[1], d[2]);
        for (let j = 0; j < radial; j++) {
          const a = (j / radial) * Math.PI * 2;
          const c = Math.cos(a), s = Math.sin(a);
          const nx = uv[0] * c + uv[3] * s, ny = uv[1] * c + uv[4] * s, nz = uv[2] * c + uv[5] * s;
          put(3 * (o0 + 1 + j), P[3 * pi] + nx * r, P[3 * pi + 1] + ny * r, P[3 * pi + 2] + nz * r, d[0], d[1], d[2]);
        }
      });
    }
  }
}

/** Vertices a closed tube of n rings takes: its rings and its 2 caps. */
const tubeVerts = (n: number, radial: number) => n * radial + 2 * (radial + 1);

/** Triangles of a closed tube of n rings x radial sides starting at vertex `base`, its 2 caps after its rings. */
function tubeIndex(n: number, radial: number, base: number, out: number[]): void {
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * radial + j, b = base + i * radial + ((j + 1) % radial);
      const c = base + (i + 1) * radial + j, d = base + (i + 1) * radial + ((j + 1) % radial);
      // wound so each face's front is outside the tube (until 2026-11-15 they faced in: a viewer saw each tube's far
      // inner wall, lit from behind)
      out.push(a, b, c, b, d, c);
    }
  }
  const cap0 = base + n * radial, cap1 = cap0 + radial + 1;
  for (let j = 0; j < radial; j++) {
    const j1 = (j + 1) % radial;
    out.push(cap0, cap0 + 1 + j1, cap0 + 1 + j);            // faces back along the line
    out.push(cap1, cap1 + 1 + j, cap1 + 1 + j1);            // faces on along it
  }
}

function makeMaterial(m: { key?: string; color?: string; metal?: number; rough?: number } | undefined): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(m?.color ?? '#202326'), metalness: m?.metal ?? 0.05, roughness: m?.rough ?? 0.8,
  });
  mat.name = `flex:${m?.key ?? 'cable'}`;
  return mat;
}

/** A tube the fleet draws: a line (loop, reel, coil) or one line a chain carries. */
interface TubeBlock {
  def: FlexDefJson;
  content?: FlexContentJson;
  /** rings drawn, seats and leads included */
  rings: number;
  r: number;
  offset: number;
  /** a coil: its rings come from the helix, not from a resample */
  coil: boolean;
  /** the id the tab highlights it by: a line's own, a chain's content by its chain */
  key: string;
}
interface TubeGroup { key: string; blocks: TubeBlock[]; vertsPerSlot: number; geo: THREE.BufferGeometry; mesh: THREE.Mesh; pos: Float32Array; nrm: Float32Array }

/** One robot kind's lines, for `capacity` robots. */
export function makeFlexFleet(defs: readonly FlexDefJson[], capacity: number, opts: FlexFleetOptions = {}): FlexFleet {
  const radial = opts.radial ?? 8;
  const perTurn = opts.coilPerTurn ?? 12;
  const seat = Math.max(0, opts.seat ?? 0);
  const group = new THREE.Group();
  group.name = 'flexLines';
  const meshes: FlexFleet['meshes'] = [];

  // tubes, merged per material (or per line)
  const tubes = new Map<string, TubeGroup>();
  const addBlock = (groupKey: string, b: Omit<TubeBlock, 'offset'>) => {
    let g = tubes.get(groupKey);
    if (!g) {
      g = { key: groupKey, blocks: [], vertsPerSlot: 0, geo: new THREE.BufferGeometry(), mesh: null as unknown as THREE.Mesh, pos: new Float32Array(0), nrm: new Float32Array(0) };
      tubes.set(groupKey, g);
    }
    g.blocks.push({ ...b, offset: g.vertsPerSlot });
    g.vertsPerSlot += tubeVerts(b.rings, radial);
  };
  const materialOf = new Map<string, FlexDefJson['material']>();
  for (const d of defs) {
    if (isTube(d)) {
      const coil = d.kind === 'stretch' && d.style === 'coil';
      const key = opts.split ? d.id : d.material?.key ?? 'cable';
      materialOf.set(key, d.material);
      addBlock(key, { def: d, rings: ringsOf(d, perTurn) + (coil || seat === 0 ? 0 : 2), r: d.r, coil, key: d.id });
    }
    if (d.kind === 'chain' && opts.contents && d.contents?.length) {
      const n = contentSamples(d) + 2;
      for (const c of d.contents) {
        const key = opts.split ? `${d.id}:${c.material.key}` : c.material.key;
        materialOf.set(key, c.material);
        addBlock(key, { def: d, content: c, rings: n, r: c.d / 2, coil: false, key: d.id });
      }
    }
  }
  for (const g of tubes.values()) {
    const total = g.vertsPerSlot * capacity;
    g.pos = new Float32Array(total * 3);
    g.nrm = new Float32Array(total * 3);
    const idx: number[] = [];
    for (let s = 0; s < capacity; s++) for (const b of g.blocks) tubeIndex(b.rings, radial, s * g.vertsPerSlot + b.offset, idx);
    g.geo.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    const pa = new THREE.BufferAttribute(g.pos, 3);
    const na = new THREE.BufferAttribute(g.nrm, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    na.setUsage(THREE.DynamicDrawUsage);
    g.geo.setAttribute('position', pa);
    g.geo.setAttribute('normal', na);
    const mat = makeMaterial(materialOf.get(g.key) ?? undefined);
    g.mesh = new THREE.Mesh(g.geo, mat);
    g.mesh.frustumCulled = false;            // the lines move every frame; their bounds would have to follow
    g.mesh.castShadow = opts.castShadow ?? false;
    g.mesh.name = `flex:${g.key}`;
    group.add(g.mesh);
    meshes.push({ mesh: g.mesh, ids: [...new Set(g.blocks.map((b) => b.key))], material: mat });
  }

  // chains and bellows, instanced
  const chains: { def: FlexDefJson; mesh: THREE.InstancedMesh; links: number }[] = [];
  const bellows: { def: FlexDefJson; mesh: THREE.InstancedMesh }[] = [];
  for (const d of defs) {
    if (d.kind === 'chain') {
      const links = d.links ?? 0;
      const linkGeo = opts.links?.get(d.id);
      const geo = linkGeo ?? new THREE.BoxGeometry(d.pitch ?? 0.05, d.h ?? 0.03, d.w ?? 0.05);
      const mat = makeMaterial(d.material);
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, links * capacity));
      mesh.count = links * capacity;
      mesh.frustumCulled = false;
      mesh.castShadow = opts.castShadow ?? false;
      mesh.name = `flex:${d.id}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      group.add(mesh);
      chains.push({ def: d, mesh, links });
      meshes.push({ mesh, ids: [d.id], material: mat });
    } else if (isBellows(d)) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0, 0.5);
      const mat = makeMaterial(d.material);
      const mesh = new THREE.InstancedMesh(geo, mat, capacity);
      mesh.frustumCulled = false;
      mesh.castShadow = opts.castShadow ?? false;
      mesh.name = `flex:${d.id}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      group.add(mesh);
      bellows.push({ def: d, mesh });
      meshes.push({ mesh, ids: [d.id], material: mat });
    }
  }

  // scratch
  const maxRings = Math.max(4, ...[...tubes.values()].flatMap((g) => g.blocks.map((b) => b.rings + 2)), N_SEG + 3);
  const line = new Float64Array(maxRings * 3);
  const rootInv = new THREE.Matrix4();
  const W = new THREE.Matrix4(), F = new THREE.Matrix4();
  const nodeM = new Map<string, THREE.Matrix4>();
  // the anchor nodes every line needs, in a fixed order, for the moved-since-last-write test
  const anchorNames = [...new Set(defs.flatMap((d) => [d.a.node, d.b.node, d.pairA?.node, d.pairB?.node].filter((x): x is string => !!x)))];
  const keyLen = 16 * (anchorNames.length + 1);
  const key = new Float32Array(keyLen);
  const lastKey: Float32Array[] = Array.from({ length: capacity }, () => new Float32Array(keyLen).fill(Number.NaN));
  const lastSol: Map<string, { ok: boolean; minRadius?: number; length?: number }>[] = Array.from({ length: capacity }, () => new Map());
  const lastLine: Map<string, Float64Array>[] = Array.from({ length: capacity }, () => new Map());
  const xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3();
  // a chain wholly under the ground is left out (opts.under), decided once from its anchors in the robot's frame
  const hidden = new Map<string, boolean>();

  function rel(skel: FlexSkeleton, name: string): THREE.Matrix4 {
    let m = nodeM.get(name);
    if (!m) { m = new THREE.Matrix4(); nodeM.set(name, m); }
    return m.multiplyMatrices(rootInv, skel.node(name).matrixWorld);
  }

  function underGround(d: FlexDefJson, nodeMatrix: (n: string) => THREE.Matrix4): boolean {
    if (opts.under === undefined || d.kind !== 'chain') return false;
    let h = hidden.get(d.id);
    if (h === undefined) {
      _p.set(d.a.p[0], d.a.p[1], d.a.p[2]).applyMatrix4(nodeMatrix(d.a.node));
      _q.set(d.b.p[0], d.b.p[1], d.b.p[2]).applyMatrix4(nodeMatrix(d.b.node));
      h = Math.max(_p.y, _q.y) + (d.h ?? 0) / 2 < opts.under;
      hidden.set(d.id, h);
    }
    return h;
  }

  function write(slot: number, skel: FlexSkeleton): boolean {
    if (slot < 0 || slot >= capacity) return false;
    W.copy(skel.root.matrixWorld);
    rootInv.copy(W).invert();
    // moved since the last write? the anchors' frames (in the robot's frame) and the robot's place
    anchorNames.forEach((n, i) => key.set(rel(skel, n).elements, 16 * i));
    key.set(W.elements, 16 * anchorNames.length);
    const prev = lastKey[slot];
    let same = true;
    for (let i = 0; i < keyLen && same; i++) if (!(Math.abs(prev[i] - key[i]) <= 1e-7)) same = false;
    if (same) return false;
    prev.set(key);
    const sols = lastSol[slot];
    const lines = lastLine[slot];
    const nodeMatrix = (n: string) => nodeM.get(n) ?? rel(skel, n);

    for (const g of tubes.values()) {
      for (const b of g.blocks) {
        const d = b.def;
        const at = slot * g.vertsPerSlot + b.offset;
        let P: Polyline;
        if (b.content) {
          if (underGround(d, nodeMatrix)) { g.pos.fill(0, 3 * at, 3 * (at + tubeVerts(b.rings, radial))); continue; }
          P = contentPolyline(d, b.content, nodeMatrix(d.a.node), nodeMatrix(d.b.node), b.rings - 2, line);
        } else {
          const sol = solveFlex(d, nodeMatrix(d.a.node), nodeMatrix(d.b.node), nodeMatrix);
          sols.set(d.id, { ok: sol.ok, minRadius: sol.minRadius, length: sol.length });
          const m = sol.points.length / 3;
          if (b.coil) P = coilPolyline(sol.points, d.turns ?? 8, d.coilR ?? 0.03, b.rings, line);
          else if (seat > 0) {
            // the solved centreline from index 1, then a seat past each end along the line's own direction
            const n = b.rings - 2;
            resample(sol.points, m, n, line, 1);
            seatEnds(line, n, seat);
            P = line;
          } else P = resample(sol.points, m, b.rings, line);
        }
        writeTube(P, b.rings, b.r, radial, W, g.pos, g.nrm, at);
        const kept = lines.get(b.content ? `${d.id}:${b.content.id}` : d.id) ?? new Float64Array(b.rings * 3);
        kept.set(P.subarray(0, b.rings * 3));
        lines.set(b.content ? `${d.id}:${b.content.id}` : d.id, kept);
      }
      (g.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
    }
    for (const c of chains) {
      if (underGround(c.def, nodeMatrix)) {
        for (let k = 0; k < c.links; k++) c.mesh.setMatrixAt(slot * c.links + k, _m.makeScale(0, 0, 0));
        c.mesh.instanceMatrix.needsUpdate = true;
        continue;
      }
      const sol = solveFlex(c.def, nodeMatrix(c.def.a.node), nodeMatrix(c.def.b.node), nodeMatrix);
      sols.set(c.def.id, { ok: sol.ok });
      const links = sol.links ?? [];
      for (let k = 0; k < c.links; k++) {
        const l = links[k];
        if (!l) { c.mesh.setMatrixAt(slot * c.links + k, _m.makeScale(0, 0, 0)); continue; }
        xa.set(l.t[0], l.t[1], l.t[2]).normalize();
        ya.set(l.n[0], l.n[1], l.n[2]).normalize();
        za.crossVectors(xa, ya);
        F.makeBasis(xa, ya, za).setPosition(l.c[0], l.c[1], l.c[2]);
        c.mesh.setMatrixAt(slot * c.links + k, _m.multiplyMatrices(W, F));
      }
      c.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const bl of bellows) {
      const d = bl.def;
      const sol = solveFlex(d, nodeMatrix(d.a.node), nodeMatrix(d.b.node), nodeMatrix);
      sols.set(d.id, { ok: sol.ok, length: sol.length });
      const P = sol.points;
      za.set(P[3] - P[0], P[4] - P[1], P[5] - P[2]);
      const L = za.length() || 1e-6;
      za.multiplyScalar(1 / L);
      const xd = d.xd ?? [1, 0, 0];
      xa.set(xd[0], xd[1], xd[2]).transformDirection(nodeMatrix(d.a.node));
      xa.addScaledVector(za, -xa.dot(za)).normalize();
      ya.crossVectors(za, xa);
      F.makeBasis(xa, ya, za).setPosition(P[0], P[1], P[2]);
      F.multiply(_m.makeScale(d.w ?? 0.1, d.h ?? 0.1, L));
      bl.mesh.setMatrixAt(slot, _m.multiplyMatrices(W, F));
      bl.mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  function clear(slot: number): void {
    if (slot < 0 || slot >= capacity) return;
    lastKey[slot].fill(Number.NaN);
    for (const g of tubes.values()) {
      g.pos.fill(0, slot * g.vertsPerSlot * 3, (slot + 1) * g.vertsPerSlot * 3);
      (g.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    for (const c of chains) {
      for (let k = 0; k < c.links; k++) c.mesh.setMatrixAt(slot * c.links + k, _m.makeScale(0, 0, 0));
      c.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const bl of bellows) {
      bl.mesh.setMatrixAt(slot, _m.makeScale(0, 0, 0));
      bl.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group, meshes, write, clear,
    last: (slot) => lastSol[slot] ?? new Map(),
    centreline: (slot, id) => lastLine[slot]?.get(id) ?? null,
    dispose() {
      // a chain's link geometry belongs to the model it came from: dispose only what this fleet made
      for (const { mesh, material } of meshes) {
        const shared = [...(opts.links?.values() ?? [])].includes(mesh.geometry);
        if (!shared) mesh.geometry.dispose();
        material.dispose();
      }
    },
  };
}
