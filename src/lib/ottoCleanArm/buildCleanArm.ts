/**
 * OTTO-CLEAN ARM — procedural geometry, the same family as the OTTO-CHARGE ARM
 * (buildCobot.ts): its aluminium and charcoal, its red band, its teal status light.
 *
 * Depends on nothing but three and the spec, so the sandbox page, the depot renderer
 * and the tests all build the same machine. METRES, in the authored car frame
 * (cleanArmSpec.ts); the renderer converts at the point of insertion, as it does the car.
 *
 * NODES AND JOINTS. Each node below carries one joint; set them with poseCleanArm().
 *   CA_J1     shoulder yaw   rotation.y = -t1        (at J1's axis, link 1's height)
 *   CA_J2     elbow yaw      rotation.y = -t2        (link 2 rides link2Drop below)
 *   CA_J3     mast yaw       rotation.y = -(yaw - t1 - t2)
 *   CA_Mast2  middle stage   position.y = -E/2       (E = MAST_FOOT_MAX - foot)
 *   CA_Mast3  inner stage    position.y = -E/2
 *   CA_Pitch  wrist pitch    rotation.z = pitch      (local +x is the wand)
 *   CA_Wand2  wand stage 2   position.x = ext/2
 *   CA_Wand3  wand stage 3   position.x = ext/2
 *   CA_Nozzle nozzle pitch   rotation.z = nozzle
 * Three.js's Ry(a) sends +x to (cos a, 0, -sin a), so a yaw of psi in this file's
 * convention (atan2(dz, dx)) is rotation.y = -psi. buildCleanArm.test.ts checks the
 * drawn pivot, knuckle and nozzle tip against cleanArmPose's FK.
 */

import * as THREE from 'three';
import { makeCobotMaterials, type CobotMaterials } from '@/lib/ottoChargeArm/buildCobot';
import { CLEAN_ARM, MAST_FOOT_MAX } from './cleanArmSpec';
import type { CleanJoints } from './cleanArmPose';

export const CLEAN_ARM_NODES = [
  'CA_J1', 'CA_J2', 'CA_J3', 'CA_Mast2', 'CA_Mast3', 'CA_Pitch', 'CA_Wand2', 'CA_Wand3', 'CA_Nozzle',
] as const;
export type CleanArmNode = (typeof CLEAN_ARM_NODES)[number];

export interface CleanArmHandles {
  root: THREE.Group;
  nodes: Record<CleanArmNode, THREE.Group>;
  /** the nozzle's mouth, for the hose and the work light */
  mouth: THREE.Object3D;
  /** the hose's fixed end on the J3 carriage */
  hoseRoot: THREE.Object3D;
  statusMaterial: THREE.MeshStandardMaterial;
  materials: CobotMaterials;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** A link: a box with rounded ends, from x = 0 to x = len, centred on y = 0. */
function link(len: number, w: number, h: number, mats: CobotMaterials, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const body = mesh(new THREE.BoxGeometry(len, h, w), mats.alu, `${name}_Body`);
  body.position.x = len / 2;
  g.add(body);
  for (const [x, r] of [[0, w / 2], [len, w / 2 * 0.9]] as const) {
    const cap = mesh(new THREE.CylinderGeometry(r, r, h, 24), mats.alu, `${name}_Cap`);
    cap.position.x = x;
    g.add(cap);
  }
  // the cable carrier on top: an energy chain, dark, the length of the link
  const chain = mesh(new THREE.BoxGeometry(len * 0.82, 0.035, w * 0.42), mats.rubber, `${name}_Chain`, false);
  chain.position.set(len / 2, h / 2 + 0.0175, 0);
  g.add(chain);
  // a red band where the link leaves its joint
  const band = mesh(new THREE.BoxGeometry(0.022, h * 1.02, w * 1.02), mats.accent, `${name}_Band`, false);
  band.position.x = w * 0.75;
  g.add(band);
  return g;
}

/** A vertical drum (yaw joint housing): radius r, height h, centred on y = 0. */
function yawDrum(r: number, h: number, mats: CobotMaterials, name: string, withStatus: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.add(mesh(new THREE.CylinderGeometry(r, r, h, 28), mats.charcoal, `${name}_Drum`));
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.02, 28), mats.alu, `${name}_Cap`);
    cap.position.y = s * (h / 2 + 0.01);
    g.add(cap);
  }
  if (withStatus) {
    const ring = mesh(new THREE.TorusGeometry(r * 1.01, 0.008, 8, 32), mats.status, `${name}_StatusRing`, false);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -h * 0.32;
    g.add(ring);
  }
  return g;
}

/** A square telescope stage, `size` across, from y = top down to y = top - len. */
function stage(size: number, top: number, len: number, mat: THREE.Material, name: string): THREE.Mesh {
  const m = mesh(new THREE.BoxGeometry(size, len, size), mat, name);
  m.position.y = top - len / 2;
  return m;
}

/** A wand tube along +x from x0 to x1. */
function tube(r: number, x0: number, x1: number, mat: THREE.Material, name: string): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 18), mat, name);
  m.rotation.z = Math.PI / 2;
  m.position.x = (x0 + x1) / 2;
  return m;
}

export function buildCleanArm(opts: { materials?: CobotMaterials } = {}): CleanArmHandles {
  const A = CLEAN_ARM;
  const mats = opts.materials ?? makeCobotMaterials();
  const root = new THREE.Group();
  root.name = 'OTTO_CLEAN_ARM';

  // ── the base at J1, hung from the drop column (the column itself is the mount's) ──
  const base = new THREE.Group();
  base.name = 'CA_Base';
  base.position.set(A.mountX, A.link1Y, 0);
  root.add(base);
  base.add(yawDrum(A.j1.r, A.j1.h, mats, 'CA_J1Housing', true));
  const flange = mesh(new THREE.CylinderGeometry(A.j1.r * 1.18, A.j1.r * 1.18, 0.04, 28), mats.aluDark, 'CA_Flange');
  flange.position.y = A.j1.h / 2 + 0.03;
  base.add(flange);
  const band = mesh(new THREE.TorusGeometry(A.j1.r * 1.02, 0.01, 8, 32), mats.accent, 'CA_BaseBand', false);
  band.rotation.x = Math.PI / 2;
  band.position.y = A.j1.h * 0.3;
  base.add(band);

  // ── J1 and link 1 ──
  const j1 = new THREE.Group();
  j1.name = 'CA_J1';
  base.add(j1);
  j1.add(link(A.link1.len, A.link1.w, A.link1.h, mats, 'CA_Link1'));
  // the elbow housing joins link 1 (y = 0) to link 2 (y = -link2Drop)
  const elbow = yawDrum(A.j2.r, A.j2.h, mats, 'CA_J2Housing', false);
  elbow.position.set(A.link1.len, -A.link2Drop / 2, 0);
  j1.add(elbow);

  // ── J2 and link 2 ──
  const j2 = new THREE.Group();
  j2.name = 'CA_J2';
  j2.position.set(A.link1.len, -A.link2Drop, 0);
  j1.add(j2);
  j2.add(link(A.link2.len, A.link2.w, A.link2.h, mats, 'CA_Link2'));
  // the mast carriage at link 2's tip: the J3 drive and the top of the hose
  const carriage = mesh(new THREE.BoxGeometry(0.26, 0.2, 0.26), mats.charcoal, 'CA_Carriage');
  carriage.position.set(A.link2.len, 0.02, 0);
  j2.add(carriage);

  // ── J3: the mast's yaw, and the outer sleeve ──
  const j3 = new THREE.Group();
  j3.name = 'CA_J3';
  j3.position.set(A.link2.len, 0, 0);
  j2.add(j3);
  const [s0, s1, s2] = A.mast.sections;
  j3.add(stage(s0, A.mast.outerAbove, A.mast.outerAbove + A.mast.outerBelow, mats.aluDark, 'CA_MastOuter'));
  const collar = mesh(new THREE.BoxGeometry(s0 * 1.25, 0.05, s0 * 1.25), mats.charcoal, 'CA_MastCollar');
  collar.position.y = -A.mast.outerBelow + 0.025;
  j3.add(collar);
  const mastBand = mesh(new THREE.BoxGeometry(s0 * 1.03, 0.035, s0 * 1.03), mats.accent, 'CA_MastBand', false);
  mastBand.position.y = -0.12;
  j3.add(mastBand);
  // a status strip down the sleeve's outboard face (it faces where the wand points)
  const strip = mesh(new THREE.BoxGeometry(0.006, A.mast.outerBelow * 0.7, 0.03), mats.status, 'CA_MastStatus', false);
  strip.position.set(s0 / 2 + 0.003, -A.mast.outerBelow * 0.45, 0);
  j3.add(strip);
  const hoseRoot = new THREE.Object3D();
  hoseRoot.name = 'CA_HoseRoot';
  hoseRoot.position.set(-s0 / 2 - 0.03, -0.05, 0);
  j3.add(hoseRoot);

  // ── the inner stages: each slides half the extension ──
  const mast2 = new THREE.Group();
  mast2.name = 'CA_Mast2';
  j3.add(mast2);
  mast2.add(stage(s1, -A.mast.outerBelow + A.mast.stage, A.mast.stage, mats.alu, 'CA_MastMid'));
  const mast3 = new THREE.Group();
  mast3.name = 'CA_Mast3';
  mast2.add(mast3);
  mast3.add(stage(s2, -A.mast.outerBelow + A.mast.stage, A.mast.stage, mats.aluDark, 'CA_MastInner'));
  // the wrist at the foot: a short neck and the pitch drum (axis across the wand, local z)
  const neck = mesh(new THREE.CylinderGeometry(A.wrist.r * 0.8, A.wrist.r * 0.9, A.pivotBelowFoot, 18), mats.charcoal, 'CA_WristNeck');
  neck.position.y = -A.mast.outerBelow - A.pivotBelowFoot / 2;
  mast3.add(neck);
  const drum = mesh(new THREE.CylinderGeometry(A.wrist.r, A.wrist.r, A.wrist.w, 22), mats.charcoal, 'CA_WristDrum');
  drum.rotation.x = Math.PI / 2;
  drum.position.y = -A.mast.outerBelow - A.pivotBelowFoot;
  mast3.add(drum);
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.CylinderGeometry(A.wrist.r * 0.82, A.wrist.r * 0.82, 0.016, 22), mats.alu, 'CA_WristCap');
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, -A.mast.outerBelow - A.pivotBelowFoot, s * (A.wrist.w / 2 + 0.008));
    mast3.add(cap);
  }

  // ── J4: the wrist pitch, and the wand ──
  const pitch = new THREE.Group();
  pitch.name = 'CA_Pitch';
  pitch.position.y = -A.mast.outerBelow - A.pivotBelowFoot;
  mast3.add(pitch);
  pitch.add(tube(A.wand.r, 0, A.wand.base, mats.alu, 'CA_WandBase'));
  const wandBand = mesh(new THREE.CylinderGeometry(A.wand.r * 1.08, A.wand.r * 1.08, 0.02, 18), mats.accent, 'CA_WandBand', false);
  wandBand.rotation.z = Math.PI / 2;
  wandBand.position.x = A.wrist.r + 0.04;
  pitch.add(wandBand);
  // each extension stage slides half of maxExt and keeps 6 cm inside the stage behind it,
  // so it is longer than the base: retracted, its tail sits in the wrist drum
  const stageLen = A.wand.maxExt / 2 + 0.06;
  const wand2 = new THREE.Group();
  wand2.name = 'CA_Wand2';
  pitch.add(wand2);
  wand2.add(tube(A.wand.rMid, A.wand.base - stageLen, A.wand.base, mats.aluDark, 'CA_WandMid'));
  const wand3 = new THREE.Group();
  wand3.name = 'CA_Wand3';
  wand2.add(wand3);
  wand3.add(tube(A.wand.rInner, A.wand.base - stageLen, A.wand.base, mats.alu, 'CA_WandInner'));

  // ── J5: the nozzle ──
  const nozzle = new THREE.Group();
  nozzle.name = 'CA_Nozzle';
  nozzle.position.x = A.wand.base;
  wand3.add(nozzle);
  const knuckle = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.06, 16), mats.charcoal, 'CA_Knuckle');
  knuckle.rotation.x = Math.PI / 2;
  nozzle.add(knuckle);
  // the head: a flat duct, wide across the wand (local z), tapering to the mouth
  const N = A.nozzle;
  const head = new THREE.Shape();
  head.moveTo(0.02, -N.h * 0.32);
  head.lineTo(N.len - 0.012, -N.h / 2);
  head.lineTo(N.len - 0.012, N.h / 2);
  head.lineTo(0.02, N.h * 0.32);
  head.closePath();
  const headGeo = new THREE.ExtrudeGeometry(head, { depth: N.w, bevelEnabled: false });
  headGeo.translate(0, 0, -N.w / 2);
  nozzle.add(mesh(headGeo, mats.charcoal, 'CA_NozzleHead'));
  // the brush lip at the mouth, and the lit ring at the neck that says it is working
  const lip = mesh(new THREE.BoxGeometry(0.012, N.h * 1.08, N.w * 1.02), mats.rubber, 'CA_NozzleLip', false);
  lip.position.x = N.len - 0.006;
  nozzle.add(lip);
  const ring = mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 20), mats.status, 'CA_NozzleRing', false);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = 0.03;
  nozzle.add(ring);
  const mouth = new THREE.Object3D();
  mouth.name = 'CA_Mouth';
  mouth.position.x = N.len;
  nozzle.add(mouth);

  const nodes = Object.fromEntries(CLEAN_ARM_NODES.map((n) => [n, root.getObjectByName(n) as THREE.Group])) as Record<CleanArmNode, THREE.Group>;
  return { root, nodes, mouth, hoseRoot, statusMaterial: mats.status, materials: mats };
}

/** Set a built arm's joints. The same mapping the header states. */
export function poseCleanArm(nodes: Record<CleanArmNode, THREE.Group>, q: CleanJoints): void {
  const E = Math.max(0, MAST_FOOT_MAX - q.foot);
  nodes.CA_J1.rotation.set(0, -q.t1, 0);
  nodes.CA_J2.rotation.set(0, -q.t2, 0);
  nodes.CA_J3.rotation.set(0, -(q.yaw - q.t1 - q.t2), 0);
  nodes.CA_Mast2.position.y = -E / 2;
  nodes.CA_Mast3.position.y = -E / 2;
  nodes.CA_Pitch.rotation.set(0, 0, q.pitch);
  nodes.CA_Wand2.position.x = q.ext / 2;
  nodes.CA_Wand3.position.x = q.ext / 2;
  nodes.CA_Nozzle.rotation.set(0, 0, q.nozzle);
}
