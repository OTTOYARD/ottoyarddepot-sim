/**
 * THE ROBOTS' FLEXIBLE LINES, DRAWN. flexLines.ts solves each line (cable, hose, duct, energy chain) at a pose,
 * exactly as cad/otto_cad/flex.py does; this file turns the solutions into meshes that bend with the robot.
 *
 *   tube     a loop, a cable on a reel, a coiled cable (its helix): rings around the solved centreline, written in
 *            place into one merged buffer per material, so every robot of a kind shares one draw per material
 *   bellows  a box from end to end (a rectangular duct on a slide)
 *   chain    an energy chain: one instanced link per link, along the solved fixed run, bend and moving run
 *
 * One fleet serves every robot of a kind: the yard (capacity = the robots of that kind) and the Robotics tab
 * (capacity 1, a mesh per line so a line can be picked out). A slot is re-solved only when its anchors moved.
 *
 * The renderer decides nothing here: the pose is the twin's, the line's shape is the CAD's rule for it.
 */
import * as THREE from 'three';
import { N_SEG, solveFlex, type FlexDefJson, type Polyline } from './flexLines';

/** What a fleet needs of one robot: its root (the CAD frame) and its nodes by name, with world matrices current. */
export interface FlexSkeleton {
  root: THREE.Object3D;
  node(name: string): THREE.Object3D;
}

export interface FlexFleetOptions {
  /** sides of each tube's section (the yard: 6; the tab: 12) */
  radial?: number;
  /** points per turn of a coiled cable's helix */
  coilPerTurn?: number;
  /** one mesh and material per line (the tab, to pick a line out) instead of one per material (the yard) */
  split?: boolean;
  castShadow?: boolean;
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
  dispose(): void;
}

const isTube = (d: FlexDefJson) => d.kind === 'loop' || (d.kind === 'stretch' && d.style !== 'bellows');
const isBellows = (d: FlexDefJson) => d.kind === 'stretch' && d.style === 'bellows' && (d.w ?? 0) > 0;

/** How many rings a tube line draws: its solved points, or for a coil its helix. */
function ringsOf(d: FlexDefJson, perTurn: number): number {
  if (d.kind === 'loop') return N_SEG + 1;
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
function resample(P: Polyline, n: number, out: Polyline): Polyline {
  const m = P.length / 3;
  if (m === n) { out.set(P); return out; }
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
    for (let k = 0; k < 3; k++) out[3 * i + k] = P[3 * j + k] + (P[3 * j + 3 + k] - P[3 * j + k]) * f;
  }
  return out;
}

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/**
 * Write a tube of radius r round the centreline P (n points, CAD frame) into pos/nrm at vertex `at`, through the
 * matrix W (CAD frame to the mesh's frame). Rings follow parallel-transported frames, so the tube does not twist.
 */
function writeTube(P: Polyline, n: number, r: number, radial: number, W: THREE.Matrix4, pos: Float32Array, nrm: Float32Array, at: number): void {
  _n.getNormalMatrix(W);
  let ux = 0, uy = 0, uz = 0;
  let tx = 0, ty = 0, tz = 0;
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
    tx = dx; ty = dy; tz = dz;
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
      _p.set(P[3 * i] + nx * r, P[3 * i + 1] + ny * r, P[3 * i + 2] + nz * r).applyMatrix4(W);
      _q.set(nx, ny, nz).applyMatrix3(_n).normalize();
      const o = 3 * (at + i * radial + j);
      pos[o] = _p.x; pos[o + 1] = _p.y; pos[o + 2] = _p.z;
      nrm[o] = _q.x; nrm[o + 1] = _q.y; nrm[o + 2] = _q.z;
    }
  }
}

/** Triangles of a tube of n rings x radial sides starting at vertex `base`. */
function tubeIndex(n: number, radial: number, base: number, out: number[]): void {
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * radial + j, b = base + i * radial + ((j + 1) % radial);
      const c = base + (i + 1) * radial + j, d = base + (i + 1) * radial + ((j + 1) % radial);
      out.push(a, c, b, b, c, d);
    }
  }
}

function lineMaterial(d: FlexDefJson): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(d.material?.color ?? '#202326'), metalness: d.material?.metal ?? 0.05, roughness: d.material?.rough ?? 0.8,
  });
  m.name = `flex:${d.material?.key ?? 'cable'}`;
  return m;
}

interface TubeBlock { def: FlexDefJson; rings: number; slotVerts: number; offset: number }
interface TubeGroup { key: string; blocks: TubeBlock[]; vertsPerSlot: number; geo: THREE.BufferGeometry; mesh: THREE.Mesh; pos: Float32Array; nrm: Float32Array }

/** One robot kind's lines, for `capacity` robots. */
export function makeFlexFleet(defs: readonly FlexDefJson[], capacity: number, opts: FlexFleetOptions = {}): FlexFleet {
  const radial = opts.radial ?? 6;
  const perTurn = opts.coilPerTurn ?? 12;
  const group = new THREE.Group();
  group.name = 'flexLines';
  const meshes: FlexFleet['meshes'] = [];

  // tubes, merged per material (or per line)
  const tubes = new Map<string, TubeGroup>();
  for (const d of defs) {
    if (!isTube(d)) continue;
    const key = opts.split ? d.id : d.material?.key ?? 'cable';
    let g = tubes.get(key);
    if (!g) {
      g = { key, blocks: [], vertsPerSlot: 0, geo: new THREE.BufferGeometry(), mesh: null as unknown as THREE.Mesh, pos: new Float32Array(0), nrm: new Float32Array(0) };
      tubes.set(key, g);
    }
    const rings = ringsOf(d, perTurn);
    g.blocks.push({ def: d, rings, slotVerts: rings * radial, offset: g.vertsPerSlot });
    g.vertsPerSlot += rings * radial;
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
    const mat = lineMaterial(g.blocks[0].def);
    g.mesh = new THREE.Mesh(g.geo, mat);
    g.mesh.frustumCulled = false;            // the lines move every frame; their bounds would have to follow
    g.mesh.castShadow = opts.castShadow ?? false;
    g.mesh.name = `flex:${g.key}`;
    group.add(g.mesh);
    meshes.push({ mesh: g.mesh, ids: g.blocks.map((b) => b.def.id), material: mat });
  }

  // chains and bellows, instanced
  const chains: { def: FlexDefJson; mesh: THREE.InstancedMesh; links: number }[] = [];
  const bellows: { def: FlexDefJson; mesh: THREE.InstancedMesh }[] = [];
  for (const d of defs) {
    if (d.kind === 'chain') {
      const links = d.links ?? 0;
      const geo = new THREE.BoxGeometry(d.pitch ?? 0.05, d.h ?? 0.03, d.w ?? 0.05);
      const mat = lineMaterial(d);
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
      const mat = lineMaterial(d);
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
  const maxRings = Math.max(2, ...[...tubes.values()].flatMap((g) => g.blocks.map((b) => b.rings)));
  const line = new Float64Array(maxRings * 3);
  const rootInv = new THREE.Matrix4();
  const MA = new THREE.Matrix4(), MB = new THREE.Matrix4(), W = new THREE.Matrix4(), F = new THREE.Matrix4();
  const nodeM = new Map<string, THREE.Matrix4>();
  // the anchor nodes every line needs, in a fixed order, for the moved-since-last-write test
  const anchorNames = [...new Set(defs.flatMap((d) => [d.a.node, d.b.node, d.pairA?.node, d.pairB?.node].filter((x): x is string => !!x)))];
  const keyLen = 16 * (anchorNames.length + 1);
  const key = new Float32Array(keyLen);
  const lastKey: Float32Array[] = Array.from({ length: capacity }, () => new Float32Array(keyLen).fill(Number.NaN));
  const lastSol: Map<string, { ok: boolean; minRadius?: number; length?: number }>[] = Array.from({ length: capacity }, () => new Map());
  const xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3();

  function rel(skel: FlexSkeleton, name: string): THREE.Matrix4 {
    let m = nodeM.get(name);
    if (!m) { m = new THREE.Matrix4(); nodeM.set(name, m); }
    return m.multiplyMatrices(rootInv, skel.node(name).matrixWorld);
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
    const nodeMatrix = (n: string) => nodeM.get(n) ?? rel(skel, n);

    for (const g of tubes.values()) {
      for (const b of g.blocks) {
        const d = b.def;
        MA.copy(nodeMatrix(d.a.node));
        MB.copy(nodeMatrix(d.b.node));
        const sol = solveFlex(d, MA, MB, nodeMatrix);
        sols.set(d.id, { ok: sol.ok, minRadius: sol.minRadius, length: sol.length });
        let P: Polyline;
        if (d.kind === 'stretch' && d.style === 'coil') P = coilPolyline(sol.points, d.turns ?? 8, d.coilR ?? 0.03, b.rings, line);
        else P = resample(sol.points, b.rings, line);
        writeTube(P, b.rings, d.r, radial, W, g.pos, g.nrm, slot * g.vertsPerSlot + b.offset);
      }
      (g.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
    }
    for (const c of chains) {
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
    dispose() {
      for (const { mesh, material } of meshes) { mesh.geometry.dispose(); material.dispose(); }
    },
  };
}
