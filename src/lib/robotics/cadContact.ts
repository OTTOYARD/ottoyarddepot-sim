/**
 * WHAT HOLDS EACH PART, AS THE EYE SEES IT. cad/clash.py proves on the B-rep that every part touches another within
 * 0.3 mm, but it counts the flexible lines as holders: a fitting that hangs on its hose passes. A viewer sees a fitting
 * in the air. This measures the drawn meshes instead, with the lines left out: two placed parts TOUCH when their
 * triangles come within `tolerance` of each other (three-mesh-bvh's closest distance between 2 meshes: 0 where they
 * cross, as a screw's shank does a part's face), and the parts that touch, directly or through others, form a group.
 * The robot is the group that holds its ground (the deck plane, or the site steel the robot hangs from); every other
 * group is FLOATING.
 *
 * It is the check for the yard's models too: a part the yard model keeps whose every holder it drops floats in the yard
 * though it is held in the CAD (cadDetail.test.ts runs it on the full, the detail and the depot models).
 */
import * as THREE from 'three';
import { MeshBVH, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';

export interface ContactOptions {
  /** two parts closer than this touch, metres */
  tolerance?: number;
  /** a part that reaches within `tolerance` of this height (metres, the robot's frame) stands on the ground */
  groundY?: number;
  /** part ids that are the site the robot hangs from or stands on (they hold, whatever they touch) */
  site?: (partId: string) => boolean;
  /** placements left out of the check altogether */
  skip?: (partId: string, name: string) => boolean;
}

export interface ContactPlacement { part: string; name: string }
export interface ContactResult {
  placements: ContactPlacement[];
  /** each group as indices into `placements`; groups[0] holds the ground or the site (or is the largest) */
  groups: number[][];
  /** every placement outside groups[0] */
  floating: ContactPlacement[];
}

function partOf(o: THREE.Object3D | null): { part: string; node: THREE.Object3D | null } {
  for (; o; o = o.parent) {
    const p = (o.userData as { part?: unknown }).part;
    if (typeof p === 'string') return { part: p, node: o };
  }
  return { part: '', node: null };
}

interface Piece { part: string; name: string; tris: Float32Array; box: THREE.Box3; verts: Float32Array; bvh?: MeshBVH; geo?: THREE.BufferGeometry }

export function contactGroups(scene: THREE.Object3D, opts: ContactOptions = {}): ContactResult {
  const tol = opts.tolerance ?? 0.001;
  scene.updateMatrixWorld(true);
  const raw: { part: string; name: string; tris: number[]; verts: number[]; box: THREE.Box3 }[] = [];
  const byNode = new Map<THREE.Object3D, number>();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const { part, node } = partOf(m);
    if (!node) return;
    if (opts.skip && opts.skip(part, node.name)) return;
    let k = byNode.get(node);
    if (k === undefined) {
      k = raw.length;
      byNode.set(node, k);
      raw.push({ part, name: node.name, tris: [], verts: [], box: new THREE.Box3() });
    }
    const pc = raw[k];
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      pc.tris.push(v.x, v.y, v.z);
      pc.box.expandByPoint(v);
    }
    // the mesh's own vertices (each once), at most 400 a mesh, evenly
    const stride = Math.max(1, Math.ceil(pos.count / 400));
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pc.verts.push(v.x, v.y, v.z);
    }
  });
  const pieces: Piece[] = raw.map((r) => ({ part: r.part, name: r.name, box: r.box, tris: Float32Array.from(r.tris), verts: Float32Array.from(r.verts) }));
  const N = pieces.length;
  const parent = Array.from({ length: N + 1 }, (_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a: number, b: number) => { const ra = root(a), rb = root(b); if (ra !== rb) parent[ra] = rb; };
  const GROUND = N;
  for (let k = 0; k < N; k++) {
    if (opts.site && opts.site(pieces[k].part)) join(k, GROUND);
    // a part stands on the ground when its lowest point is on the deck plane, and is set in it when its top is the deck's
    // own height (a cover plate, flush) (a part through the deck, a channel liner, is held by what it is cast into)
    if (opts.groundY !== undefined) {
      const b = pieces[k].box;
      if (Math.abs(b.min.y - opts.groundY) <= tol || (Math.abs(b.max.y - opts.groundY) <= tol && b.min.y < opts.groundY)) join(k, GROUND);
    }
  }

  // 1. quick: a vertex of one part within tolerance of a triangle of another, over one hierarchy of every triangle
  let total = 0;
  for (const pc of pieces) total += pc.tris.length;
  const all = new Float32Array(total);
  const ownerOfTri: number[] = [];
  let off = 0;
  pieces.forEach((pc, k) => {
    all.set(pc.tris, off);
    off += pc.tris.length;
    for (let t = 0; t < pc.tris.length / 9; t++) ownerOfTri.push(k);
  });
  const geoAll = new THREE.BufferGeometry();
  geoAll.setAttribute('position', new THREE.BufferAttribute(all, 3));
  const bvhAll = new MeshBVH(geoAll, { maxLeafTris: 8 });
  const index = geoAll.index!;                       // the hierarchy's own order: triangle t is vertices index[3t..3t+2]
  const p = new THREE.Vector3(), cp = new THREE.Vector3();
  for (let k = 0; k < N; k++) {
    const V = pieces[k].verts;
    const touched = new Set<number>();
    for (let i = 0; i < V.length; i += 3) {
      p.set(V[i], V[i + 1], V[i + 2]);
      bvhAll.shapecast({
        intersectsBounds: (box) => (box.distanceToPoint(p) > tol ? NOT_INTERSECTED : INTERSECTED),
        intersectsTriangle: (tri, triIndex) => {
          const o = ownerOfTri[Math.floor(index.getX(triIndex * 3) / 3)];
          if (o === k || touched.has(o)) return false;
          if (tri.closestPointToPoint(p, cp).distanceTo(p) <= tol) touched.add(o);
          return false;
        },
      });
    }
    for (const o of touched) join(k, o);
  }
  geoAll.dispose();

  // 2. exact, only where a part is still apart from the robot: the closest distance between 2 meshes (0 where they cross)
  const bvhOf = (pc: Piece): MeshBVH => {
    if (!pc.bvh) {
      pc.geo = new THREE.BufferGeometry();
      pc.geo.setAttribute('position', new THREE.BufferAttribute(pc.tris, 3));
      pc.bvh = new MeshBVH(pc.geo, { maxLeafTris: 8 });
    }
    return pc.bvh;
  };
  const I = new THREE.Matrix4();
  const t1 = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const t2 = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const grown = new THREE.Box3();
  for (let pass = 0; pass < 3; pass++) {
    let joined = false;
    for (let i = 0; i < N; i++) {
      if (root(i) === root(GROUND)) continue;
      grown.copy(pieces[i].box).expandByScalar(tol);
      for (let j = 0; j < N; j++) {
        if (j === i || root(j) === root(i)) continue;
        if (!grown.intersectsBox(pieces[j].box)) continue;
        const A = pieces[i], B = pieces[j];
        const [S, L] = A.tris.length <= B.tris.length ? [A, B] : [B, A];
        bvhOf(S);
        const hit = bvhOf(L).closestPointToGeometry(S.geo!, I, t1, t2, 0, tol);
        if (hit && t1.distance <= tol) { join(i, j); joined = true; }
      }
    }
    if (!joined) break;
  }
  for (const pc of pieces) { pc.geo?.dispose(); pc.geo = undefined; pc.bvh = undefined; }

  const placements = pieces.map((p) => ({ part: p.part, name: p.name }));
  const groupsMap = new Map<number, number[]>();
  for (let k = 0; k < N; k++) {
    const r = root(k);
    const g = groupsMap.get(r) ?? [];
    g.push(k);
    groupsMap.set(r, g);
  }
  const groundRoot = root(GROUND);
  const groups = [...groupsMap.entries()]
    .sort((a, b) => (a[0] === groundRoot ? -1 : b[0] === groundRoot ? 1 : b[1].length - a[1].length))
    .map(([, g]) => g);
  const floating = groups.slice(1).flat().map((k) => placements[k]);
  return { placements, groups, floating };
}
