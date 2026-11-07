/**
 * THE ENGINEERING CAD IN THE YARD. The depot draws each robot from its CAD (cad/build.py): `<robot>.depot.glb`,
 * the parts you can see from the yard, tessellated coarse (cad/otto_cad/glb.py `depot_keep`). This file turns that
 * model into what the depot renderer instances, and poses it from the twin.
 *
 *   SEGMENTS  The model is cut into rigid segments: the robot's root, then everything each CAD joint carries (the
 *             joint nodes carry the twin's joints: J1..J6 on the charge arm, CA_J1..CA_Nozzle on the clean arm,
 *             GANTRY and the tool slides on the wash machine), and any part that moves on its own (a turning
 *             brush). Each segment's meshes are merged per material into one geometry in the segment's own frame.
 *             Each (segment, material, shadow) group is one draw: every robot of a kind shares it, instanced.
 *   SKELETON  One robot's joint hierarchy with no meshes: the joint nodes, the moving parts' nodes and their
 *             ancestors. Each robot poses its own skeleton and writes each segment's world matrix into its slot.
 *   POSE      Joint values by the CAD's joint names (radians, metres for a slide), applied about each joint's own
 *             axis from its rest transform, as the Robotics tab poses the full CAD (cadModel.poseCad). The values
 *             come from the twin's own pose code (catalog.ts maps them), so the yard and the tab cannot disagree.
 *
 * The renderer decides nothing here: what a robot does is the twin's session; this only draws it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CadJointInfo } from './cadModel';
import type { RobotKey } from './catalog';

/** The depot model's file in public/cad (the manifest names it too, as `files.depot`). */
export const depotFile = (robot: RobotKey): string => `${robot}.depot.glb`;

/** Parse a GLB held in memory into a three.js scene (metres, Y up, node extras as userData). */
export async function parseGlb(data: ArrayBuffer | Uint8Array): Promise<THREE.Group> {
  // GLTFLoader tells a binary file from JSON by `instanceof ArrayBuffer`, so hand it one of this realm's buffers
  let ab: ArrayBuffer;
  if (data instanceof ArrayBuffer) ab = data;
  else {
    ab = new ArrayBuffer(data.byteLength);
    new Uint8Array(ab).set(data);
  }
  const gltf = await new GLTFLoader().parseAsync(ab, '');
  return gltf.scene;
}

export interface DepotPart {
  /** index into the skeleton's segments (0 is the robot's root) */
  segment: number;
  /** merged, in the segment's frame */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  /** a status light (the CAD's `led` material, light channel 0): drawn with a colour and a glow per robot */
  status: boolean;
  /** a light on another channel (DepotCadOptions.lights), with its own colour and glow per robot */
  light?: number;
  /** the CAD part ids merged into this draw, for tests and for the dev check */
  partIds: string[];
}

export interface DepotJoint {
  info: CadJointInfo;
  node: THREE.Object3D;
  baseQuat: THREE.Quaternion;
  basePos: THREE.Vector3;
  /** the joint axis in the node's rest frame, unit */
  axis: THREE.Vector3;
}

export interface DepotSkeleton {
  root: THREE.Object3D;
  /** segment nodes, index-aligned with DepotCad.segmentNames */
  segments: THREE.Object3D[];
  /** by the CAD's joint name ('J1', 'CA_J1', 'GANTRY', ...) */
  joints: Map<string, DepotJoint>;
  /** a node by its node name or its joint name; throws if the model has none */
  node(name: string): THREE.Object3D;
}

export interface DepotCad {
  robot: RobotKey;
  /** each segment's node name ('' for the root), in segment order */
  segmentNames: string[];
  parts: DepotPart[];
  /** a fresh skeleton for one robot */
  skeleton(): DepotSkeleton;
  /** what the depot model holds, for the dev check and the tests */
  stats: { parts: number; draws: number; shadowDraws: number; triangles: number; partIds: Set<string> };
}

export interface DepotCadOptions {
  /** CAD part ids the depot does not draw from the CAD (the site draws them, for instance the canopy steel) */
  exclude?: (partId: string) => boolean;
  /** CAD part ids that move on their own (a brush turning on its shaft): each placed one becomes its own segment */
  ownSegment?: (partId: string) => boolean;
  /** a part casts a shadow when its world bounds' diagonal is at least this, metres */
  shadowMinM?: number;
  /** CAD material names drawn as lights, by channel: `led` is channel 0 (the status light) unless named here */
  lights?: Readonly<Record<string, number>>;
}

const jointOf = (o: THREE.Object3D): CadJointInfo | null => {
  const j = (o.userData as { joint?: CadJointInfo }).joint;
  return j && typeof j === 'object' && typeof j.name === 'string' ? j : null;
};
const partOf = (o: THREE.Object3D): string | null => {
  const p = (o.userData as { part?: unknown }).part;
  return typeof p === 'string' ? p : null;
};

/** The CAD part a mesh belongs to: the nearest ancestor that carries `part`. */
function partIdOf(m: THREE.Object3D): string | null {
  for (let o: THREE.Object3D | null = m; o; o = o.parent) {
    const p = partOf(o);
    if (p) return p;
  }
  return null;
}

/**
 * Cut a loaded depot model (parseGlb) into instanced parts and a skeleton factory. The scene must be at rest: every
 * joint at zero, as the GLB stores it.
 */
export function buildDepotCad(robot: RobotKey, scene: THREE.Object3D, opts: DepotCadOptions = {}): DepotCad {
  const exclude = opts.exclude ?? (() => false);
  const own = opts.ownSegment ?? (() => false);
  // a part's shadow reads at the yard's distances when the part is a hand's width or more; smaller ones only cost
  const shadowMin = opts.shadowMinM ?? 0.3;
  const lights: Readonly<Record<string, number>> = opts.lights ?? { led: 0 };
  scene.updateMatrixWorld(true);

  // segment nodes: the root, every joint node, every part node that moves on its own
  const segNodes: THREE.Object3D[] = [scene];
  scene.traverse((o) => {
    if (o === scene) return;
    const p = partOf(o);
    if (jointOf(o) || (p && own(p))) segNodes.push(o);
  });
  const segIndex = new Map(segNodes.map((n, i) => [n, i]));
  const segmentOf = (m: THREE.Object3D): number => {
    for (let o: THREE.Object3D | null = m.parent; o; o = o.parent) {
      const i = segIndex.get(o);
      if (i !== undefined) return i;
    }
    return 0;
  };
  // a mesh that IS an own-segment part (the part node carries the mesh) belongs to that segment
  const segmentOfMesh = (m: THREE.Object3D): number => segIndex.get(m) ?? segmentOf(m);

  const groups = new Map<string, { segment: number; material: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[]; ids: Set<string> }>();
  const inv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  const box = new THREE.Box3();
  const partIds = new Set<string>();
  let triangles = 0;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const id = partIdOf(mesh) ?? '';
    if (id && exclude(id)) return;
    if (id) partIds.add(id);
    const segment = segmentOfMesh(mesh);
    const material = mesh.material as THREE.Material;
    box.setFromObject(mesh);
    const cast = box.min.distanceTo(box.max) >= shadowMin;
    const key = `${segment}|${material.uuid}|${cast}`;
    rel.copy(inv.copy(segNodes[segment].matrixWorld).invert()).multiply(mesh.matrixWorld);
    let g = mesh.geometry.clone();
    g = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    // float normals: the GLB's are int8, and a merged, transformed buffer is simplest kept in one type
    const n = g.getAttribute('normal');
    if (n && !(n.array instanceof Float32Array)) {
      const f = new Float32Array(n.count * 3);
      for (let i = 0; i < n.count; i++) { f[i * 3] = n.getX(i); f[i * 3 + 1] = n.getY(i); f[i * 3 + 2] = n.getZ(i); }
      g.setAttribute('normal', new THREE.BufferAttribute(f, 3));
    }
    g.applyMatrix4(rel);
    triangles += g.getAttribute('position').count / 3;
    const e = groups.get(key) ?? { segment, material, cast, geos: [], ids: new Set<string>() };
    e.geos.push(g);
    if (id) e.ids.add(id);
    groups.set(key, e);
  });

  const parts: DepotPart[] = [];
  for (const e of groups.values()) {
    const geometry = mergeGeometries(e.geos, false);
    if (!geometry) throw new Error(`cadDepot: could not merge a segment of ${robot}`);
    for (const g of e.geos) g.dispose();
    geometry.computeBoundingSphere();
    const ch = lights[e.material.name];
    parts.push({
      segment: e.segment, geometry, material: e.material, castShadow: e.cast,
      status: ch === 0, light: ch !== undefined && ch > 0 ? ch : undefined, partIds: [...e.ids].sort(),
    });
  }
  // a stable draw order: by segment, then material name
  parts.sort((a, b) => a.segment - b.segment || a.material.name.localeCompare(b.material.name) || Number(b.castShadow) - Number(a.castShadow));

  // the skeleton template: segment nodes and their ancestors, no meshes
  const keep = new Set<THREE.Object3D>();
  for (const n of segNodes) for (let o: THREE.Object3D | null = n; o; o = o.parent) keep.add(o);
  const segmentNames = segNodes.map((n, i) => (i === 0 ? '' : n.name));

  function skeleton(): DepotSkeleton {
    const map = new Map<THREE.Object3D, THREE.Object3D>();
    const copy = (src: THREE.Object3D): THREE.Object3D => {
      const dst = new THREE.Object3D();
      dst.name = src.name;
      dst.position.copy(src.position);
      dst.quaternion.copy(src.quaternion);
      dst.scale.copy(src.scale);
      dst.userData = { ...src.userData };
      map.set(src, dst);
      for (const c of src.children) if (keep.has(c)) dst.add(copy(c));
      return dst;
    };
    const root = copy(scene);
    const segments = segNodes.map((n) => map.get(n)!);
    const joints = new Map<string, DepotJoint>();
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      const j = jointOf(o);
      if (!j) return;
      byName.set(j.name, o);
      joints.set(j.name, {
        info: j, node: o, baseQuat: o.quaternion.clone(), basePos: o.position.clone(),
        axis: new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize(),
      });
    });
    return {
      root, segments, joints,
      node(name: string) {
        const o = byName.get(name);
        if (!o) throw new Error(`cadDepot: ${robot} has no node ${name}`);
        return o;
      },
    };
  }

  return {
    robot,
    segmentNames,
    parts,
    skeleton,
    stats: {
      parts: partIds.size,
      draws: parts.length,
      shadowDraws: parts.filter((p) => p.castShadow).length,
      triangles,
      partIds,
    },
  };
}

const qa = new THREE.Quaternion();
const va = new THREE.Vector3();

/**
 * Set joint values (radians, metres for a slide) on a skeleton, clamped to each joint's limits. Joints not named keep
 * their value. Allocation-free: the depot calls this every frame for every robot.
 */
export function poseSkeleton(s: DepotSkeleton, values: Record<string, number>): void {
  for (const name in values) {
    const j = s.joints.get(name);
    if (!j) continue;
    const [lo, hi] = j.info.limits;
    const v = Math.min(hi, Math.max(lo, values[name]));
    if (j.info.kind === 'prismatic') {
      j.node.position.copy(j.basePos).addScaledVector(va.copy(j.axis).applyQuaternion(j.baseQuat), v);
    } else {
      j.node.quaternion.copy(j.baseQuat).multiply(qa.setFromAxisAngle(j.axis, v));
    }
  }
}

/** Turn a part node (an own segment) about one of its own axes from its rest orientation. */
export function spinNode(node: THREE.Object3D, rest: THREE.Quaternion, axis: THREE.Vector3, angle: number): void {
  node.quaternion.copy(rest).multiply(qa.setFromAxisAngle(axis, angle));
}
