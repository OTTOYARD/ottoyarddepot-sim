/**
 * WHICH PARTS OF A ROBOT CAN BE SEEN AT ALL. The yard draws each robot near the camera from its detail model
 * (`<robot>.near.glb`, cad/otto_cad/glb.py `near_keep`): every part of the CAD but the ones sealed inside a joint
 * actuator (the gear set, the motor, the brake, the encoders, the drive board, the bearings and the seals behind the
 * housing). This measures that claim instead of trusting the part names: a part is VISIBLE when a straight line of
 * sight reaches some point of its surface from outside the robot, at some pose.
 *
 * How: every mesh of the posed robot goes into one bounding-volume hierarchy (three-mesh-bvh). For each placed part,
 * points are sampled on its surface (area-weighted, a fixed seed), each lifted 0.2 mm off its face, and a ray is cast
 * from it along each of a set of directions that leave the face. A ray that hits nothing has seen the outside: the part
 * is visible. The yard's deck is opaque, so a ray that goes down through the deck plane is blocked, and a part that lies
 * wholly under the deck (a cable trench, the chain in its channel) cannot be seen in the yard at all.
 *
 * The test errs toward VISIBLE (it keeps a part) only through its sampling: a part with a visible patch smaller than the
 * gap between its samples can read hidden. So the detail model never drops a part on this test alone: it drops the
 * actuators' sealed parts by name, and cadDetail.test.ts uses this to prove that none of them is visible.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface VisibilityOptions {
  /** the deck's height in the robot's frame, metres: rays may not pass below it, and parts under it are hidden */
  deckY?: number;
  /** surface samples a placed part, at most (area-weighted) */
  samples?: number;
  /** directions over the sphere (a Fibonacci set); only those leaving each sample's face are cast */
  directions?: number;
  /** the lowest direction cast, as its y component (an eye stands above the deck, so not far below a part) */
  minDirY?: number;
  /** placements to measure, by part id and placement (node) name (default every placed part) */
  only?: (partId: string, name: string) => boolean;
}

export interface PartVisibility {
  part: string;
  /** placements of this part id */
  placements: number;
  /** placements seen from outside */
  visible: number;
  /** rays cast for this part id, and the ones that escaped */
  rays: number;
  escaped: number;
}

/** The lowest an eye stands over the deck, and the nearest it comes to a part, metres (the yard's orbit camera). */
export const EYE_MIN_M = 0.3;
export const EYE_NEAR_M = 0.5;

function partOf(o: THREE.Object3D | null): { part: string; name: string } {
  for (; o; o = o.parent) {
    const p = (o.userData as { part?: unknown }).part;
    if (typeof p === 'string') return { part: p, name: o.name };
  }
  return { part: '', name: '' };
}

/** A Fibonacci sphere: n unit directions, near evenly spread. */
export function sphereDirections(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return out;
}

/** A small seeded generator, so a measurement is the same every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

interface Placed { part: string; name: string; mesh: THREE.Mesh; tri: Float32Array; area: Float64Array; total: number }

/**
 * Measure, at the scene's current pose (call scene.updateMatrixWorld first, or let this do it), which placed parts can
 * be seen from outside. Returns one entry per part id.
 */
export function measureVisibility(scene: THREE.Object3D, opts: VisibilityOptions = {}): Map<string, PartVisibility> {
  const deckY = opts.deckY ?? -Infinity;
  const nSamp = opts.samples ?? 48;
  const dirs = sphereDirections(opts.directions ?? 64).filter((d) => d.y >= (opts.minDirY ?? -0.35));
  scene.updateMatrixWorld(true);

  // every mesh, in the scene's frame, into one buffer; each placed part's own triangles kept for sampling
  const placed: Placed[] = [];
  const all: number[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const tri = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      tri[i * 3] = v.x; tri[i * 3 + 1] = v.y; tri[i * 3 + 2] = v.z;
    }
    for (let i = 0; i < tri.length; i++) all.push(tri[i]);
    const nt = n / 3;
    const area = new Float64Array(nt);
    let total = 0;
    for (let t = 0; t < nt; t++) {
      const o9 = t * 9;
      const ax = tri[o9 + 3] - tri[o9], ay = tri[o9 + 4] - tri[o9 + 1], az = tri[o9 + 5] - tri[o9 + 2];
      const bx = tri[o9 + 6] - tri[o9], by = tri[o9 + 7] - tri[o9 + 1], bz = tri[o9 + 8] - tri[o9 + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
      area[t] = total;
    }
    const pn = partOf(m);
    placed.push({ part: pn.part, name: pn.name, mesh: m, tri, area, total });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(all), 3));
  const bvh = new MeshBVH(geo, { maxLeafTris: 8 });

  const out = new Map<string, PartVisibility>();
  const ray = new THREE.Ray();
  const p = new THREE.Vector3(), nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const rand = rng(0x5eed);
  for (const pl of placed) {
    if (opts.only && !opts.only(pl.part, pl.name)) continue;
    let e = out.get(pl.part);
    if (!e) { e = { part: pl.part, placements: 0, visible: 0, rays: 0, escaped: 0 }; out.set(pl.part, e); }
    e.placements++;
    if (pl.total <= 0) continue;
    let seen = false;
    for (let s = 0; s < nSamp && !seen; s++) {
      // an area-weighted triangle, a uniform point in it
      const target = rand() * pl.total;
      let lo = 0, hi = pl.area.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (pl.area[mid] < target) lo = mid + 1; else hi = mid; }
      const o9 = lo * 9, T = pl.tri;
      let r1 = rand(), r2 = rand();
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      e1.set(T[o9 + 3] - T[o9], T[o9 + 4] - T[o9 + 1], T[o9 + 5] - T[o9 + 2]);
      e2.set(T[o9 + 6] - T[o9], T[o9 + 7] - T[o9 + 1], T[o9 + 8] - T[o9 + 2]);
      nrm.crossVectors(e1, e2);
      if (nrm.lengthSq() < 1e-18) continue;
      nrm.normalize();
      p.set(T[o9], T[o9 + 1], T[o9 + 2]).addScaledVector(e1, r1).addScaledVector(e2, r2);
      if (p.y < deckY - 1e-4) continue;                 // under the deck: the yard's ground hides it
      p.addScaledVector(nrm, 0.0002);
      for (const d of dirs) {
        if (d.dot(nrm) < 0.05) continue;
        ray.origin.copy(p);
        ray.direction.copy(d);
        e.rays++;
        // looking up at the part from below it: an eye may stand anywhere along the ray down to EYE_MIN_M over the
        // deck, if it is EYE_NEAR_M or more from the part. Clear of the robot that far, the part is seen.
        if (d.y < 0 && Number.isFinite(deckY)) {
          const tEye = (p.y - (deckY + EYE_MIN_M)) / -d.y;
          if (tEye < EYE_NEAR_M) continue;
          const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
          if (hit && hit.distance < tEye) continue;
          e.escaped++; seen = true; break;
        }
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
        if (!hit) { e.escaped++; seen = true; break; }
      }
    }
    if (seen) e.visible++;
  }
  geo.dispose();
  return out;
}
