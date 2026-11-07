/**
 * The engineering CAD in the twin: load a robot's GLB (cad/build.py), index its parts, subsystems and
 * joints, and pose, explode, isolate and highlight it. Pure three.js, so the Robotics tab, the dev check
 * page (cad-check.html) and the tests all drive the same model.
 *
 * What the GLB carries (cad/otto_cad/glb.py): metres, Y up, in the twin's own frame for the robot; node
 * `extras` arrive in three.js as `userData`:
 *   part instance  { part: id, sub: subsystem, explode?: [x, y, z] }   explode is metres, parent frame
 *   joint node     { sub, joint: { name, axis, limits, kind, stowed } }
 *   root           { robot, title, frame, specVersion }
 * The renderer decides nothing here: a pose is a set of joint angles handed to it (the twin's own
 * STOWED pose, or angles the twin's IK solved), and an explode is a view, not a world fact.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface CadJointInfo {
  name: string;
  axis: [number, number, number];
  limits: [number, number];
  kind: 'revolute' | 'prismatic';
  stowed?: number;
}

export interface CadJoint extends CadJointInfo {
  node: THREE.Object3D;
  baseQuat: THREE.Quaternion;
  basePos: THREE.Vector3;
}

export interface CadPartNode {
  obj: THREE.Object3D;
  part: string;
  sub: string;
  basePos: THREE.Vector3;
  explode: THREE.Vector3;
  meshes: THREE.Mesh[];
}

export interface CadModel {
  root: THREE.Object3D;
  robot: string;
  parts: CadPartNode[];
  joints: Map<string, CadJoint>;
  /** every part instance node, by its three.js object id, for picking */
  byObject: Map<number, CadPartNode>;
  /** each mesh's original material, so a highlight can be undone */
  baseMaterial: Map<number, THREE.Material>;
}

const v3 = (a?: number[]): THREE.Vector3 => (a && a.length === 3 ? new THREE.Vector3(a[0], a[1], a[2]) : new THREE.Vector3());

/** Index a loaded GLB scene. Exported for tests, which build a scene by hand. */
export function indexCad(root: THREE.Object3D): CadModel {
  const parts: CadPartNode[] = [];
  const joints = new Map<string, CadJoint>();
  const byObject = new Map<number, CadPartNode>();
  const baseMaterial = new Map<number, THREE.Material>();
  let robot = '';
  root.traverse((o) => {
    const u = o.userData as Record<string, unknown>;
    if (typeof u.robot === 'string') robot = u.robot;
    if (u.joint && typeof u.joint === 'object') {
      const j = u.joint as CadJointInfo;
      joints.set(j.name, { ...j, node: o, baseQuat: o.quaternion.clone(), basePos: o.position.clone() });
    }
    if (typeof u.part === 'string') {
      const meshes: THREE.Mesh[] = [];
      o.traverse((c) => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
      const p: CadPartNode = {
        obj: o, part: u.part, sub: String(u.sub ?? ''), basePos: o.position.clone(),
        explode: v3(u.explode as number[] | undefined), meshes,
      };
      parts.push(p);
      byObject.set(o.id, p);
      for (const m of meshes) {
        byObject.set(m.id, p);
        baseMaterial.set(m.id, m.material as THREE.Material);
      }
    }
  });
  return { root, robot, parts, joints, byObject, baseMaterial };
}

export async function loadCad(url: string): Promise<CadModel> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return indexCad(gltf.scene);
}

/** Set joint angles (radians, or metres for a prismatic joint). Joints not named keep their angle. */
export function poseCad(m: CadModel, angles: Record<string, number>): void {
  for (const [name, v] of Object.entries(angles)) {
    const j = m.joints.get(name);
    if (!j) continue;
    const lim = Math.min(j.limits[1], Math.max(j.limits[0], v));
    const axis = new THREE.Vector3(...j.axis).normalize();
    if (j.kind === 'prismatic') {
      j.node.position.copy(j.basePos).addScaledVector(axis.applyQuaternion(j.baseQuat), lim);
    } else {
      j.node.quaternion.copy(j.baseQuat).multiply(new THREE.Quaternion().setFromAxisAngle(axis, lim));
    }
  }
}

/** The pose each joint carries as `stowed` in the GLB (the twin's STOWED for the charge arm). */
export function stowedAngles(m: CadModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, j] of m.joints) out[name] = j.stowed ?? 0;
  return out;
}

export function zeroAngles(m: CadModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of m.joints.keys()) out[name] = 0;
  return out;
}

/** Move every part along its explode vector, k = 0 (assembled) .. 1 (fully exploded). */
export function explodeCad(m: CadModel, k: number): void {
  for (const p of m.parts) p.obj.position.copy(p.basePos).addScaledVector(p.explode, k);
}

export interface CadHighlight {
  /** show only these subsystems at full strength (null: all) */
  isolate?: string | null;
  /** the selected part id: drawn in the highlight colour */
  selected?: string | null;
  /** hover: a lighter highlight */
  hover?: string | null;
  /** ghost everything outside the isolation instead of hiding it */
  ghostOthers?: boolean;
  /** hide every fastener */
  hideFasteners?: boolean;
  /** part ids that are fasteners (from the bill of materials) */
  fasteners?: ReadonlySet<string>;
  /** with a part selected, draw every other part as a ghost, so a part inside an assembly shows through it */
  xraySelected?: boolean;
}

const ghostMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b4, transparent: true, opacity: 0.08, depthWrite: false, metalness: 0, roughness: 1 });
const selMat = new THREE.MeshStandardMaterial({ color: 0xff3b55, emissive: new THREE.Color(0xc8102e), emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 });
const hovMat = new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: new THREE.Color(0x6b4a00), emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.45 });

/** Apply isolation, selection and hover. Idempotent: always computed from the base materials. */
export function highlightCad(m: CadModel, h: CadHighlight): void {
  for (const p of m.parts) {
    const isFast = !!h.fasteners?.has(p.part);
    const outside = !!h.isolate && p.sub !== h.isolate;
    const hidden = (h.hideFasteners && isFast) || (outside && !h.ghostOthers);
    p.obj.visible = !hidden;
    const xrayed = !!h.xraySelected && !!h.selected && p.part !== h.selected;
    for (const mesh of p.meshes) {
      let mat = m.baseMaterial.get(mesh.id) as THREE.Material;
      if ((outside && h.ghostOthers) || xrayed) mat = ghostMat;
      if (h.hover && p.part === h.hover) mat = hovMat;
      if (h.selected && p.part === h.selected) mat = selMat;
      mesh.material = mat;
    }
  }
}

/** The part instance under a raycast hit (climbs from the mesh to its part node). */
export function partAt(m: CadModel, obj: THREE.Object3D | null): CadPartNode | null {
  let o: THREE.Object3D | null = obj;
  while (o) {
    const p = m.byObject.get(o.id);
    if (p) return p;
    o = o.parent;
  }
  return null;
}

/** World-space bounds of what is visible (for framing the camera). */
export function visibleBounds(m: CadModel): THREE.Box3 {
  const box = new THREE.Box3();
  m.root.updateMatrixWorld(true);
  for (const p of m.parts) {
    if (!p.obj.visible) continue;
    for (const mesh of p.meshes) {
      if (mesh.material === ghostMat) continue;
      box.expandByObject(mesh);
    }
  }
  return box;
}
