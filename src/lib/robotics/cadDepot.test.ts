// ============================================================================
// cadDepot.test.ts — the depot draws each robot from its CAD depot model (cadDepot.ts, cadFleet.ts). These hold
// that the drawing is the model and that the model moves as the twin moves:
//   1. The depot model is the full CAD's machine: the same joints, at the same rest frames, and every part it keeps
//      is a part of the full CAD; what it leaves out is small, hidden or site work.
//   2. Cut into instanced parts and redrawn from a skeleton, it is the same geometry in the same place (nothing is
//      lost or moved by the instancing), in a bounded number of draws.
//   3. Posed by the twin's own joints, the CAD's working points stand where the twin's are: the charge arm's
//      joints where the procedural arm's are, the clean arm's wrist and nozzle where cleanArmPose puts them, the
//      wash machine's brushes and knives where washPose puts them.
// No network: the models are read from disk.
// ============================================================================
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { depotSceneFromDisk, fullSceneFromDisk, PUBLIC_CAD } from '@/test/cadDisk';
import { buildDepotCad, poseSkeleton, type DepotCad } from './cadDepot';
import { DEPOT_CAD_OPTIONS, CLEAN_CANOPY_STEEL } from '@/components/canvas/three/cadFleet';
import { armSkeleton } from '@/components/canvas/three/armInstances';
import { cleanJointsAt, cleanArmPoints, sidesFor } from '@/lib/ottoCleanArm/cleanArmPose';
import { CLEAN_CHAIN } from '@/lib/ottoCleanArm/cleanArmSpec';
import { washPoseAt } from '@/lib/ottoWash/washPose';
import { WASH_GANTRY as G } from '@/lib/ottoWash/washSpec';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { cleanAngles, washJoints, ROBOT_KEYS, type Manifest, type RobotKey } from './catalog';

const manifest = JSON.parse(readFileSync(`${PUBLIC_CAD}/manifest.json`, 'utf8')) as Manifest;
const M = METRES_PER_PLAN_UNIT;

const cads = new Map<RobotKey, DepotCad>();
const scenes = new Map<RobotKey, THREE.Group>();
beforeAll(async () => {
  for (const k of ROBOT_KEYS) {
    const scene = await depotSceneFromDisk(k);
    scenes.set(k, scene);
    cads.set(k, buildDepotCad(k, scene, DEPOT_CAD_OPTIONS[k]));
  }
});

/** Every placed part id in a scene, with how many times it is placed. */
function placed(root: THREE.Object3D): Map<string, number> {
  const out = new Map<string, number>();
  root.traverse((o) => {
    const p = (o.userData as { part?: unknown }).part;
    if (typeof p === 'string') out.set(p, (out.get(p) ?? 0) + 1);
  });
  return out;
}

describe.each([...ROBOT_KEYS])('%s: the depot model', (k) => {
  it('is in the manifest with its own digest', () => {
    const entry = manifest.robots.find((r) => r.key === k)!;
    expect(entry.files.depot).toBe(`${k}.depot.glb`);
    expect(createHash('sha256').update(readFileSync(`${PUBLIC_CAD}/${k}.depot.glb`)).digest('hex').slice(0, 16)).toBe(entry.depotSha256);
  });

  it('carries every joint of the full CAD, at the same rest frame', async () => {
    const full = await fullSceneFromDisk(k);
    full.updateMatrixWorld(true);
    const depot = scenes.get(k)!;
    depot.updateMatrixWorld(true);
    const joints = (root: THREE.Object3D) => {
      const out = new Map<string, THREE.Object3D>();
      root.traverse((o) => { const j = (o.userData as { joint?: { name: string } }).joint; if (j) out.set(j.name, o); });
      return out;
    };
    const jf = joints(full), jd = joints(depot);
    expect([...jd.keys()].sort()).toEqual([...jf.keys()].sort());
    for (const [name, o] of jf) {
      const a = o.matrixWorld.elements, b = jd.get(name)!.matrixWorld.elements;
      for (let i = 0; i < 16; i++) expect(b[i], `${name}[${i}]`).toBeCloseTo(a[i], 6);
    }
  });

  it('keeps only parts of the full CAD, and leaves out only small, hidden or site parts', async () => {
    const full = placed(await fullSceneFromDisk(k));
    const depot = placed(scenes.get(k)!);
    for (const [id, n] of depot) expect(full.get(id), id).toBe(n);
    // the moving machine is all there: every joint carries parts in the depot model (checked by drawing below)
    expect(depot.size).toBeGreaterThan(full.size * 0.25);
  });

  it('redraws exactly from its instanced parts: the same geometry, in the same place, in a bounded number of draws', () => {
    const cad = cads.get(k)!;
    const scene = scenes.get(k)!;
    scene.updateMatrixWorld(true);
    // the scene as drawn directly (less what the site draws itself)
    const exclude = DEPOT_CAD_OPTIONS[k].exclude ?? (() => false);
    const direct = new THREE.Box3();
    let triangles = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let id = '';
      for (let n: THREE.Object3D | null = m; n && !id; n = n.parent) id = String((n.userData as { part?: unknown }).part ?? '');
      if (exclude(id)) return;
      direct.expandByObject(m);
      const idx = m.geometry.index;
      triangles += (idx ? idx.count : m.geometry.getAttribute('position').count) / 3;
    });
    // the instanced parts, placed by a fresh skeleton's segments at rest
    const skel = cad.skeleton();
    skel.root.updateMatrixWorld(true);
    const drawn = new THREE.Box3();
    let drawnTris = 0;
    for (const p of cad.parts) {
      expect(p.segment).toBeLessThan(skel.segments.length);
      const g = p.geometry.clone().applyMatrix4(skel.segments[p.segment].matrixWorld);
      g.computeBoundingBox();
      drawn.union(g.boundingBox!);
      drawnTris += g.getAttribute('position').count / 3;
    }
    expect(drawnTris).toBe(triangles);
    for (const [a, b] of [[drawn.min, direct.min], [drawn.max, direct.max]] as const) {
      expect(a.x).toBeCloseTo(b.x, 5); expect(a.y).toBeCloseTo(b.y, 5); expect(a.z).toBeCloseTo(b.z, 5);
    }
    // a whole robot kind is one set of draws, whatever the number of robots (instancedFleet.ts)
    expect(cad.stats.draws).toBeLessThanOrEqual(k === 'wash_gantry' ? 120 : 90);
  });
});

describe('the yard\'s robots move as the twin\'s do', () => {
  it('the CAD charge arm\'s joints stand where the procedural arm\'s do, so the twin\'s angles pose it', () => {
    const skel = cads.get('charge_arm')!.skeleton();
    const proc = armSkeleton();
    skel.root.updateMatrixWorld(true);
    proc.updateMatrixWorld(true);
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    // J1, J2, J3 and J5 (the wrist centre) coincide; the CAD puts J4 on the forearm axis 0.104 m before the wrist centre
    // (cad.test.ts), and a turn about an axis moves the same wherever its frame stands on that axis
    for (const n of ['J1_BaseYaw', 'J2_Shoulder', 'J3_Elbow', 'J5_WristPitch']) {
      const a = at(skel.node(n)), b = at(proc.getObjectByName(n)!);
      expect(a.distanceTo(b), n).toBeLessThan(1e-6);
    }
    for (const n of ['J1_BaseYaw', 'J2_Shoulder', 'J3_Elbow', 'J4_ForearmRoll', 'J5_WristPitch', 'J6_ToolRoll']) {
      expect(skel.node(n).quaternion.angleTo(new THREE.Quaternion()), `${n} rests at zero`).toBeLessThan(1e-9);
    }
  });

  it('the CAD clean arm\'s wrist pivot and nozzle stand where cleanArmPose puts them, all cycle, both columns', () => {
    const skel = cads.get('clean_arm')!.skeleton();
    let worstPivot = 0, worstNozzle = 0;
    for (const sides of [sidesFor(1), sidesFor(-1)]) {
      for (const phase of CLEAN_CHAIN) {
        for (let i = 0; i <= 10; i++) {
          const q = cleanJointsAt(phase, i / 10, sides);
          poseSkeleton(skel, cleanAngles(q));
          skel.root.updateMatrixWorld(true);
          const pt = cleanArmPoints(q);
          const pv = skel.node('CA_Pitch').getWorldPosition(new THREE.Vector3());
          const nz = skel.node('CA_Nozzle').getWorldPosition(new THREE.Vector3());
          worstPivot = Math.max(worstPivot, pv.distanceTo(new THREE.Vector3(pt.pivot.x, pt.pivot.y, pt.pivot.z)));
          worstNozzle = Math.max(worstNozzle, nz.distanceTo(new THREE.Vector3(pt.knuckle.x, pt.knuckle.y, pt.knuckle.z)));
        }
      }
    }
    expect(worstPivot, 'wrist pivot, metres').toBeLessThan(1e-3);
    expect(worstNozzle, 'nozzle knuckle, metres').toBeLessThan(1e-3);
  });

  it('the CAD clean arm leaves its canopy steel to the canopy', () => {
    const ids = cads.get('clean_arm')!.stats.partIds;
    for (const id of CLEAN_CANOPY_STEEL) expect(ids.has(id), id).toBe(false);
    expect(placed(scenes.get('clean_arm')!).has('CLN-HDR')).toBe(true);
  });

  it("the CAD wash machine's gantry, knives and wipe arms stand where washPose puts them", () => {
    const skel = cads.get('wash_gantry')!.skeleton();
    for (const [phase, t] of [['home', 1], ['wash_1', 0.5], ['dry_1', 0.45], ['wipe_roof', 0.7], ['wipe_front', 0.7], ['wipe_rear', 0.7]] as const) {
      const p = washPoseAt({ phase, t, from: null });
      poseSkeleton(skel, washJoints(p));
      skel.root.updateMatrixWorld(true);
      // the gantry rides its rails: its frame stands at z = -dy (metres)
      expect(skel.joints.get('GANTRY')!.node.getWorldPosition(new THREE.Vector3()).z, phase).toBeCloseTo(-p.dy * M, 6);
      // the top knife comes down on its lift columns by what the pose asks
      const drop = (pre: string, n: number) => Array.from({ length: n }, (_, i) => i + 1).reduce((s, k) => s - skel.joints.get(`${pre}${k}`)!.node.position.y, 0);
      expect(drop('DRYER_TOP', 3), phase).toBeCloseTo((G.dryer.top.retractY - p.dryerTopY) * M, 6);
      // each wipe arm's carriage slides in from its park, and its mast comes down, by what the pose asks
      for (const side of ['L', 'R']) {
        expect(Math.abs(skel.joints.get(`WIPE_${side}_X`)!.node.position.x), phase).toBeCloseTo((G.wipe.parkX - p.mastX) * M, 3);
        expect(drop(`WIPE_${side}_DROP`, 2), phase).toBeCloseTo((G.wipe.stowY - p.padY) * M, 3);
      }
      // each pad's hinge: the two arms mirror each other across the drive line, at the same place along the bay and the
      // same height, 0.09 m behind the twin's pad centre (cad wash_gantry.WIPE_HINGE) along the way the wrist points
      const hl = skel.joints.get('WIPE_L_TILT')!.node.getWorldPosition(new THREE.Vector3());
      const hr = skel.joints.get('WIPE_R_TILT')!.node.getWorldPosition(new THREE.Vector3());
      expect(hl.x, phase).toBeCloseTo(-hr.x, 6);
      expect(hl.z, phase).toBeCloseTo(hr.z, 6);
      expect(hl.y, phase).toBeCloseTo(p.padY * M, 3);   // the spec file carries heights to 0.1 mm
      const back = 0.09, a = (p.padYaw * Math.PI) / 2;
      expect(Math.abs(hl.x), phase).toBeCloseTo(p.padX * M + back * Math.cos(a), 3);
      expect(hl.z, phase).toBeCloseTo(-(p.padDy * M - back * Math.sin(a)), 3);
    }
  });
});
