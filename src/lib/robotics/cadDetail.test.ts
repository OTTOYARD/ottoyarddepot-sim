// ============================================================================
// cadDetail.test.ts — the robots the yard draws near the camera (cadDetail.ts, `<robot>.near.glb`) and what holds
// together in every model the twin draws. Chase, 2026-11-15: "There cannot be gaps between cables randomly plugging into
// charging system or just floating off of robotic arms with gaps ... I need super high-level 4K detail".
//   1. The detail model is the full CAD's machine: the same joints, the depot model's segments (one skeleton poses both),
//      and every part of the full CAD but those it may leave out, each for a stated reason: sealed in an actuator,
//      the site context, or out of the yard's sight (under its deck, inside the cabinet's pad).
//   2. A part sealed in an actuator is out of sight: no line of sight reaches it at the twin's poses (cadVisibility).
//   3. Nothing floats, as drawn: every part touches another (cadContact), in the detail model within 1 mm, in the depot
//      model within its own meshing (10 mm). The full CAD's contact is the clash check's (cad/clash.py, on the solids).
//   4. Every cable's, hose's and duct's end is seated in what holds it, in all 3 models: its end touches a part, and its
//      centre is within its radius of it.
//   5. Every line a chain carries lies inside the chain's links, and is the same length at every pose.
//   6. The director: the nearest robots in view, at most a kind's capacity, kept until they are well out of range.
// No network: the models are read from disk.
// ============================================================================
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshBVH } from 'three-mesh-bvh';
import { depotSceneFromDisk, fullSceneFromDisk, nearSceneFromDisk, PUBLIC_CAD } from '@/test/cadDisk';
import { buildDepotCad, type DepotCad } from './cadDepot';
import { DEPOT_CAD_OPTIONS } from '@/components/canvas/three/cadFleet';
import { indexCad, poseCad, stowedAngles } from './cadModel';
import { measureVisibility } from './cadVisibility';
import { contactGroups } from './cadContact';
import { contentPolyline, contentSamples, flexDefs, polylineLength, solveFlex, type FlexDefJson } from './flexLines';
import { DETAIL_RULES, DetailDirector } from './cadDetail';
import { ROBOT_KEYS, type Manifest, type RobotKey } from './catalog';
import { MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';

const manifest = JSON.parse(readFileSync(`${PUBLIC_CAD}/manifest.json`, 'utf8')) as Manifest & {
  robots: { key: string; files: { near?: string }; nearSha256?: string }[];
};
const poses = JSON.parse(readFileSync('cad/spec/poses.json', 'utf8')).robots as Record<string, { id: string; angles: Record<string, number> }[]>;
/** the yard's deck in each robot's own frame, metres (the charge arm's J1 is MOUNT_HEIGHT_M over it) */
const DECK: Record<RobotKey, number> = { charge_arm: -MOUNT_HEIGHT_M, clean_arm: 0, wash_gantry: 0, tire_bay: 0 };
/** what a robot hangs from in the yard, drawn by the site: the clean arm's canopy steel */
const SITE: Record<RobotKey, readonly string[]> = { charge_arm: [], clean_arm: ['CLN-HDR', 'CLN-COL', 'CLN-CLP'], wash_gantry: [], tire_bay: [] };
/** site works the yard models draw with the robot (glb.py DEPOT_SITE_KEEP) */
const SITE_KEEP = new Set(['CHG-BGB']);
/** a few of each robot's twin poses, spread over its cycle: the stowed pose, its first tab poses, its cycle */
const somePoses = (k: RobotKey) => {
  const all = poses[k] ?? [];
  const picked = [all[0], all[1], all[3], all[Math.floor(all.length / 2)], all[all.length - 2]].filter(Boolean);
  return [...new Map(picked.map((p) => [p.id, p])).values()];
};

const scenes = new Map<string, THREE.Group>();
/** Each scene indexed once, at rest: indexCad reads every joint's rest frame from the scene as it stands. */
const indexed = new WeakMap<THREE.Object3D, ReturnType<typeof indexCad>>();
const load = async (k: RobotKey, which: 'full' | 'near' | 'depot'): Promise<THREE.Group> => {
  const key = `${k}:${which}`;
  if (!scenes.has(key)) {
    const scene = await (which === 'full' ? fullSceneFromDisk(k) : which === 'near' ? nearSceneFromDisk(k) : depotSceneFromDisk(k));
    indexed.set(scene, indexCad(scene));
    scenes.set(key, scene);
  }
  return scenes.get(key)!;
};

interface PlacementInfo { part: string; sealed: boolean; yardHidden: boolean }
function placements(root: THREE.Object3D): Map<string, PlacementInfo> {
  const out = new Map<string, PlacementInfo>();
  root.traverse((o) => {
    const u = o.userData as { part?: unknown; sealed?: unknown; yardHidden?: unknown };
    if (typeof u.part === 'string') out.set(o.name, { part: u.part, sealed: u.sealed === true, yardHidden: u.yardHidden === true });
  });
  return out;
}
function bomOf(k: RobotKey): Map<string, { reference: boolean; category: string }> {
  const bom = JSON.parse(readFileSync(`${PUBLIC_CAD}/${k}.bom.json`, 'utf8')) as { lines: { id: string; reference: boolean; category: string }[] };
  return new Map(bom.lines.map((l) => [l.id, l]));
}
function pose(scene: THREE.Object3D, angles: Record<string, number>): void {
  let m = indexed.get(scene);
  if (!m) { m = indexCad(scene); indexed.set(scene, m); }
  poseCad(m, { ...stowedAngles(m), ...angles });
  scene.updateMatrixWorld(true);
}

describe.each([...ROBOT_KEYS])('%s: the detail model the yard draws near the camera', (k) => {
  let near: THREE.Group;
  let full: THREE.Group;
  beforeAll(async () => {
    near = await load(k, 'near');
    full = await load(k, 'full');
  });

  it('is in the manifest with its own digest', () => {
    const entry = manifest.robots.find((r) => r.key === k)!;
    expect(entry.files.near).toBe(`${k}.near.glb`);
    expect(createHash('sha256').update(readFileSync(`${PUBLIC_CAD}/${k}.near.glb`)).digest('hex').slice(0, 16)).toBe(entry.nearSha256);
  });

  it('has the full CAD\'s joints at their rest frames, and the depot model\'s segments in order', async () => {
    const joints = (root: THREE.Object3D) => {
      root.updateMatrixWorld(true);
      const out = new Map<string, THREE.Object3D>();
      root.traverse((o) => { const j = (o.userData as { joint?: { name: string } }).joint; if (j) out.set(j.name, o); });
      return out;
    };
    const jf = joints(full), jn = joints(near);
    expect([...jn.keys()].sort()).toEqual([...jf.keys()].sort());
    for (const [name, o] of jf) {
      const a = o.matrixWorld.elements, b = jn.get(name)!.matrixWorld.elements;
      for (let i = 0; i < 16; i++) expect(b[i], `${name}[${i}]`).toBeCloseTo(a[i], 6);
    }
    const nearCad: DepotCad = buildDepotCad(k, (await nearSceneFromDisk(k)), { ...DEPOT_CAD_OPTIONS[k], indexed: true });
    const depotCad: DepotCad = buildDepotCad(k, (await depotSceneFromDisk(k)), DEPOT_CAD_OPTIONS[k]);
    expect(nearCad.segmentNames).toEqual(depotCad.segmentNames);
  }, 120_000);

  it('keeps every part of the full CAD but the sealed, the site context and what the yard cannot see', () => {
    const pf = placements(full), pn = placements(near);
    const bom = bomOf(k);
    const out: string[] = [];
    for (const [name, p] of pf) {
      const ref = bom.get(p.part)?.reference === true && !SITE_KEEP.has(p.part);
      const leaves = ref || p.sealed || p.yardHidden;
      if (leaves === pn.has(name)) out.push(`${name} ${leaves ? 'should be left out' : 'is missing'} (sealed ${p.sealed}, hidden ${p.yardHidden}, reference ${ref})`);
    }
    expect(out, out.slice(0, 20).join('\n')).toEqual([]);
    for (const name of pn.keys()) expect(pf.has(name), name).toBe(true);
    // every screw, washer and nut you can see is drawn: the detail model keeps most of the full CAD's fasteners
    const fasteners = (m: Map<string, PlacementInfo>) => [...m.values()].filter((p) => bom.get(p.part)?.category === 'fastener').length;
    expect(fasteners(pn)).toBeGreaterThan(fasteners(pf) * 0.6);
  });

  it('leaves out only what no line of sight reaches: every sealed placement is unseen at the twin\'s poses', () => {
    const sealed = new Set([...placements(full)].filter(([, p]) => p.sealed).map(([n]) => n));
    if (!sealed.size) return;
    // a sealed part is inside its own actuator: the housing, the rear cover and the output flange close round it, and the
    // seam between them turns about the joint's own axis, so no pose opens a line of sight to it. At rest and mid-cycle.
    const some = somePoses(k);
    const seen: string[] = [];
    for (const p of [some[0], some[Math.floor(some.length / 2)]]) {
      pose(full, p.angles);
      const vis = measureVisibility(full, { deckY: DECK[k], samples: 24, directions: 48, only: (_id, name) => sealed.has(name) });
      seen.push(...[...vis.values()].filter((e) => e.visible > 0).map((e) => `${p.id}: ${e.part}`));
    }
    pose(full, {});
    expect(seen).toEqual([]);
  }, 300_000);

  it('holds together: every part touches another within 1 mm as drawn, in the detail model', () => {
    // the detail model leaves parts out, so a part held only by one of them would float here. The full CAD's own contact
    // is the clash check's (cad/clash.py, on the solids, within 0.3 mm), held to no loose part by cad.test.ts.
    pose(near, {});
    const r = contactGroups(near, { tolerance: 0.001, groundY: DECK[k], site: (id) => SITE[k].includes(id) });
    expect(r.floating.map((f) => f.name)).toEqual([]);
  }, 300_000);
});

describe.each([...ROBOT_KEYS])('%s: the depot model holds together within its meshing', (k) => {
  it('every part touches another within 10 mm, its coarsest facet (glb.py _depot_tolerance)', async () => {
    const depot = await load(k, 'depot');
    pose(depot, {});
    const r = contactGroups(depot, { tolerance: 0.010, groundY: DECK[k], site: (id) => SITE[k].includes(id) });
    expect(r.floating.map((f) => f.name)).toEqual([]);
  }, 120_000);
});

/** Every part's triangles at a pose, in one hierarchy, to measure a point against the solid parts. */
/** Every part's triangles in the scene's frame, as one BVH; with `near`, only the parts within `reach` metres of one of those
 *  points (a line's end is held by a part beside it, so the rest of a 400,000-triangle robot need not be built each pose). */
function partsBvh(scene: THREE.Object3D, near?: THREE.Vector3[], reach = 0.2): MeshBVH {
  scene.updateMatrixWorld(true);
  const tris: number[] = [];
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (near) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).expandByScalar(reach);
      if (!near.some((q) => box.containsPoint(q))) return;
    }
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld); tris.push(v.x, v.y, v.z); }
  });
  if (!tris.length) tris.push(1e6, 1e6, 1e6, 1e6 + 1, 1e6, 1e6, 1e6, 1e6 + 1, 1e6);   // nothing near: every distance is huge
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(tris), 3));
  return new MeshBVH(g);
}
function nodeMatrix(scene: THREE.Object3D): (name: string) => THREE.Matrix4 {
  const byName = new Map<string, THREE.Object3D>();
  scene.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  return (n) => byName.get(n)!.matrixWorld;
}

describe.each([...ROBOT_KEYS])('%s: every line\'s end is seated in what holds it', (k) => {
  it.each(['full', 'near', 'depot'] as const)('in the %s model, at the twin\'s poses', async (which) => {
    const scene = await load(k, which);
    const defs = flexDefs(scene).filter((d) => d.kind !== 'chain');
    const open: string[] = [];
    for (const p of somePoses(k)) {
      pose(scene, p.angles);
      const M = nodeMatrix(scene);
      const ends = defs.flatMap((d) => (['a', 'b'] as const).map((e) => new THREE.Vector3(...d[e].p).applyMatrix4(M(d[e].node))));
      const bvh = partsBvh(scene, ends);
      for (const d of defs) {
        for (const end of ['a', 'b'] as const) {
          const an = d[end];
          const W = M(an.node);
          const c = new THREE.Vector3(...an.p).applyMatrix4(W);
          const dir = new THREE.Vector3(...an.d).transformDirection(W).normalize();
          // the end disc: its centre, rings at 0.5, 0.7 and 0.9 of its radius, and its rim
          const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
          const w = new THREE.Vector3().crossVectors(dir, u);
          let touch = Infinity;
          for (const f of [0.5, 0.7, 0.9, 1.0]) {
            for (let j = 0; j < 12; j++) {
              const a = (j / 12) * Math.PI * 2;
              const q = c.clone().addScaledVector(u, Math.cos(a) * d.r * f).addScaledVector(w, Math.sin(a) * d.r * f);
              touch = Math.min(touch, bvh.closestPointToPoint(q)!.distance);
            }
          }
          const centre = bvh.closestPointToPoint(c)!.distance;
          if (!(touch <= 0.0005 && centre <= d.r + 0.002)) {
            open.push(`${p.id} ${d.id}:${end} touches ${(touch * 1000).toFixed(1)} mm, centre ${(centre * 1000).toFixed(1)} mm from a part (r ${(d.r * 1000).toFixed(1)})`);
          }
        }
      }
    }
    expect(open, open.slice(0, 12).join('\n')).toEqual([]);
  }, 300_000);
});

describe('every line a chain carries lies inside its links, the same length at every pose', () => {
  const chains: [RobotKey, FlexDefJson][] = [];
  beforeAll(async () => {
    for (const k of ROBOT_KEYS) for (const d of flexDefs(await load(k, 'full'))) if (d.kind === 'chain' && d.contents?.length) chains.push([k, d]);
  });
  it('the charge arm\'s 2 chains, the wash machine\'s 3 and the tire bay\'s 5 carry their lines', () => {
    expect(chains.map(([k, d]) => `${k}:${d.id}`).sort()).toEqual(
      ['charge_arm:CHG-BCN', 'charge_arm:CHG-BZN', 'tire_bay:TB-FCN', 'tire_bay:TB-TCNE', 'tire_bay:TB-TCNW', 'tire_bay:TB-ZCNE',
        'tire_bay:TB-ZCNW', 'wash_gantry:WSH-DCH', 'wash_gantry:WSH-DCHL', 'wash_gantry:WSH-DCHR']);
  });
  it('each line keeps clear of its links (resting on a crossbar at most) and keeps its length', async () => {
    const bad: string[] = [];
    for (const [k, d] of chains) {
      const scene = await load(k, 'full');
      const link = (scene.userData as { flexLinks?: Map<string, THREE.BufferGeometry> }).flexLinks?.get(d.id);
      expect(link, `${d.id}: its link mesh`).toBeTruthy();
      for (const p of somePoses(k)) {
        pose(scene, p.angles);
        const M = nodeMatrix(scene);
        const MA = M(d.a.node), MB = M(d.b.node);
        // the links where the chain puts them at this pose, as one mesh in the scene's frame
        const sol = solveFlex(d, MA, MB, M);
        const parts: THREE.BufferGeometry[] = [];
        const F = new THREE.Matrix4(), xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3();
        for (const l of sol.links ?? []) {
          xa.set(...l.t).normalize(); ya.set(...l.n).normalize(); za.crossVectors(xa, ya);
          F.makeBasis(xa, ya, za).setPosition(l.c[0], l.c[1], l.c[2]);
          parts.push(link!.clone().applyMatrix4(F));
        }
        const all = new THREE.BufferGeometry();
        const pos: number[] = [];
        for (const g of parts) {
          const pa = g.getAttribute('position'), ix = g.index;
          const n = ix ? ix.count : pa.count;
          for (let i = 0; i < n; i++) pos.push(pa.getX(ix ? ix.getX(i) : i), pa.getY(ix ? ix.getX(i) : i), pa.getZ(ix ? ix.getX(i) : i));
        }
        all.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3));
        const bvh = new MeshBVH(all);
        const n = contentSamples(d);
        for (const c of d.contents!) {
          const P = contentPolyline(d, c, MA, MB, n, new Float64Array((n + 2) * 3));
          // between the chain's ends (not the leads): no point of the line's axis nearer a link than its radius, less the
          // 0.5 mm it may rest on a crossbar with and the links' own facets (1 mm)
          let worst = Infinity;
          for (let i = 1; i <= n; i++) {
            const q = new THREE.Vector3(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
            worst = Math.min(worst, bvh.closestPointToPoint(q)!.distance - c.d / 2);
          }
          if (worst < -0.0015) bad.push(`${p.id} ${d.id} ${c.id}: ${(worst * 1000).toFixed(1)} mm into a link`);
          const L = polylineLength(P.subarray(3, 3 * (n + 1)) as Float64Array);
          if (Math.abs(L - c.length) > c.length * 0.003) bad.push(`${p.id} ${d.id} ${c.id}: ${L.toFixed(4)} m drawn against ${c.length} m`);
        }
      }
      pose(scene, {});
    }
    expect(bad, bad.slice(0, 12).join('\n')).toEqual([]);
  }, 300_000);
});

describe('the director: which robots the yard draws in detail', () => {
  const cam = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
    const c = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 2000);
    c.position.set(x, y, z);
    c.lookAt(tx, ty, tz);
    c.updateMatrixWorld();
    return c;
  };
  const U = 2;                                           // world units a metre, for the test
  it('takes the nearest robots in view, at most a kind\'s capacity', () => {
    const d = new DetailDirector(U);
    for (let i = 0; i < 8; i++) d.place('charge_arm', i, i * 3, 0, 0, 2);   // 9 m, 10.5 m, ... from the camera
    d.update(cam(-20, 2, 0, 100, 0, 0), () => true);
    const cap = DETAIL_RULES.charge_arm.capacity;
    expect(d.count('charge_arm')).toBe(cap);
    for (let i = 0; i < cap; i++) expect(d.slotOf('charge_arm', i)).toBeGreaterThanOrEqual(0);
    for (let i = cap; i < 8; i++) expect(d.slotOf('charge_arm', i)).toBe(-1);
  });
  it('draws none of a kind until its model is ready, and asks for the model the first time one is in range', () => {
    const d = new DetailDirector(U);
    const asked: RobotKey[] = [];
    d.onFirstWant = (k) => asked.push(k);
    d.place('wash_gantry', 0, 0, 0, 0, 3);
    d.update(cam(-10, 2, 0, 0, 0, 0), () => false);
    expect(d.slotOf('wash_gantry', 0)).toBe(-1);
    expect(asked).toEqual(['wash_gantry']);
    d.update(cam(-10, 2, 0, 0, 0, 0), () => true);
    expect(d.slotOf('wash_gantry', 0)).toBe(0);
    expect(asked).toEqual(['wash_gantry']);
  });
  it('keeps a robot in detail until it is past leaveM, enters it only inside enterM, and never behind the camera', () => {
    const d = new DetailDirector(U);
    const r = DETAIL_RULES.clean_arm;
    d.place('clean_arm', 0, 0, 0, 0, 1);
    const at = (m: number) => cam(-(m * U + 1), 0, 0, 0, 0, 0);   // the sphere's surface m metres from the camera
    d.update(at((r.enterM + r.leaveM) / 2), () => true);
    expect(d.slotOf('clean_arm', 0)).toBe(-1);                    // between enter and leave, not yet held: not taken
    d.update(at(r.enterM - 1), () => true);
    expect(d.slotOf('clean_arm', 0)).toBe(0);
    d.update(at((r.enterM + r.leaveM) / 2), () => true);
    expect(d.slotOf('clean_arm', 0)).toBe(0);                     // held: kept until leaveM
    const rel = d.update(at(r.leaveM + 1), () => true);
    expect(d.slotOf('clean_arm', 0)).toBe(-1);
    expect(rel.get('clean_arm')).toEqual([0]);                   // and its slot is handed back to be cleared
    d.update(cam(5, 0, 0, 100, 0, 0), () => true);               // the robot right behind the camera
    expect(d.slotOf('clean_arm', 0)).toBe(-1);
  });
  it('gives a freed slot to the next robot, and reports it to be cleared', () => {
    const d = new DetailDirector(U);
    d.place('wash_gantry', 0, 0, 0, 0, 3);
    d.place('wash_gantry', 1, 30, 0, 0, 3);
    d.place('wash_gantry', 2, 60, 0, 0, 3);
    d.update(cam(-8, 2, 0, 100, 0, 0), () => true);
    expect([0, 1, 2].map((i) => d.slotOf('wash_gantry', i))).toEqual([0, 1, -1]);
    d.remove('wash_gantry', 0);
    const rel = d.update(cam(20, 2, 0, 100, 0, 0), () => true);   // 1 keeps its slot, 2 takes the freed one
    expect(d.slotOf('wash_gantry', 2)).toBe(0);
    expect(d.slotOf('wash_gantry', 1)).toBe(1);
    expect(rel.get('wash_gantry')).toContain(0);
  });
});
