import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCleanArm, CLEAN_ARM_NODES, type CleanArmHandles, type CleanArmNode } from '@/lib/ottoCleanArm/buildCleanArm';
import { statusMaterial } from './armInstances';

/**
 * OTTO-CLEAN ARMS, INSTANCED — every cleaning arm on the site in a fixed number of
 * draw calls, exactly as armInstances.ts does for the OTTO-CHARGE ARMS and for the
 * same reason: one clone per fast charger costs 38 meshes and 27 shadow casters an
 * arm (measured), so ten arms would be ~650 draw calls a frame with the shadow pass;
 * instanced, every arm on the site is 28 parts (17 casting), at ten arms or twenty.
 *
 * The template (buildCleanArm, metres, the car frame) is cut into its RIGID SEGMENTS
 * — the arm's root (the base drum on the drop column), then everything each joint
 * node carries (CA_J1 .. CA_Nozzle) — and each segment's meshes are merged per
 * material into one geometry in the segment's own frame. Each (segment, material,
 * shadow) group is one InstancedMesh holding every arm. Each CleanArm keeps a
 * SKELETON (the template with its meshes removed), poses it with poseCleanArm, and
 * writes each segment's world matrix into its slot.
 */

export const CLEAN_TEMPLATE: CleanArmHandles = buildCleanArm();

/** Segment index 0 is the arm's root; 1.. are the joint nodes, in CLEAN_ARM_NODES order. */
export const CLEAN_SEGMENT_COUNT = CLEAN_ARM_NODES.length + 1;

export interface CleanArmPart {
  segment: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  /** the status lights (J1's ring, the mast strip, the nozzle ring): colour and glow per instance */
  status: boolean;
}

function segmentOf(o: THREE.Object3D, root: THREE.Object3D): { index: number; node: THREE.Object3D } {
  let p: THREE.Object3D | null = o.parent;
  while (p && p !== root) {
    const i = (CLEAN_ARM_NODES as readonly string[]).indexOf(p.name);
    if (i >= 0) return { index: i + 1, node: p };
    p = p.parent;
  }
  return { index: 0, node: root };
}

function buildParts(t: CleanArmHandles): CleanArmPart[] {
  t.root.updateMatrixWorld(true);
  const groups = new Map<string, { segment: number; material: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  const inv = new THREE.Matrix4();
  t.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const { index, node } = segmentOf(m, t.root);
    const material = m.material as THREE.Material;
    const key = `${index}|${material.uuid}|${m.castShadow}`;
    const rel = inv.copy(node.matrixWorld).invert().multiply(m.matrixWorld);
    let g = m.geometry.clone().applyMatrix4(rel);
    g = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const entry = groups.get(key) ?? { segment: index, material, cast: m.castShadow, geos: [] };
    entry.geos.push(g);
    groups.set(key, entry);
  });
  const parts: CleanArmPart[] = [];
  for (const e of groups.values()) {
    const geometry = mergeGeometries(e.geos, false);
    if (!geometry) throw new Error('cleanArmInstances: could not merge a segment');
    parts.push({ segment: e.segment, geometry, material: e.material, castShadow: e.cast, status: e.material === t.statusMaterial });
  }
  return parts;
}

export const CLEAN_PARTS: CleanArmPart[] = buildParts(CLEAN_TEMPLATE);

/** One arm's joint hierarchy with every mesh removed: posed and read, never drawn. */
export function cleanSkeleton(): { root: THREE.Object3D; nodes: Record<CleanArmNode, THREE.Group>; segments: THREE.Object3D[]; hoseRoot: THREE.Object3D } {
  const root = CLEAN_TEMPLATE.root.clone(true);
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
  for (const m of meshes) m.removeFromParent();
  const nodes = Object.fromEntries(CLEAN_ARM_NODES.map((n) => {
    const node = root.getObjectByName(n);
    if (!node) throw new Error(`cleanArmInstances: skeleton has no ${n}`);
    return [n, node as THREE.Group];
  })) as Record<CleanArmNode, THREE.Group>;
  const hoseRoot = root.getObjectByName('CA_HoseRoot');
  if (!hoseRoot) throw new Error('cleanArmInstances: skeleton has no CA_HoseRoot');
  return { root, nodes, segments: [root, ...CLEAN_ARM_NODES.map((n) => nodes[n])], hoseRoot };
}

export interface CleanArmFleet {
  capacity: number;
  /** meshes[i] draws CLEAN_PARTS[i]. */
  meshes: THREE.InstancedMesh[];
  statusColor: THREE.InstancedBufferAttribute;
  glow: THREE.InstancedBufferAttribute;
  dispose(): void;
}

export function makeCleanArmFleet(capacity: number): CleanArmFleet {
  const statusColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  statusColor.setUsage(THREE.DynamicDrawUsage);
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  glow.setUsage(THREE.DynamicDrawUsage);
  const owned: { dispose(): void }[] = [];
  let ledMaterial: THREE.MeshStandardMaterial | null = null;
  const meshes = CLEAN_PARTS.map((p) => {
    let geometry = p.geometry;
    let material = p.material;
    if (p.status) {
      geometry = p.geometry.clone();
      geometry.setAttribute('aGlow', glow);
      owned.push(geometry);
      if (!ledMaterial) { ledMaterial = statusMaterial(p.material as THREE.MeshStandardMaterial); owned.push(ledMaterial); }
      material = ledMaterial;
    }
    const im = new THREE.InstancedMesh(geometry, material, capacity);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = p.castShadow;
    im.receiveShadow = true;
    im.frustumCulled = false;
    (im.instanceMatrix.array as Float32Array).fill(0);
    if (p.status) im.instanceColor = statusColor;
    return im;
  });
  return {
    capacity, meshes, statusColor, glow,
    dispose() {
      for (const m of meshes) m.dispose();
      for (const o of owned) o.dispose();
    },
  };
}

const scratch = new THREE.Color();

/** Write one arm's segments and status lights into its slot (after its world matrices are current). */
export function writeCleanArm(fleet: CleanArmFleet, slot: number, segments: THREE.Object3D[], statusHex: number, glow: number): void {
  for (let i = 0; i < CLEAN_PARTS.length; i++) {
    const im = fleet.meshes[i];
    im.setMatrixAt(slot, segments[CLEAN_PARTS[i].segment].matrixWorld);
    im.instanceMatrix.needsUpdate = true;
  }
  scratch.setHex(statusHex).toArray(fleet.statusColor.array as Float32Array, slot * 3);
  fleet.statusColor.needsUpdate = true;
  fleet.glow.setX(slot, glow);
  fleet.glow.needsUpdate = true;
}

/** Hide a slot (its arm unmounted). */
export function clearCleanArm(fleet: CleanArmFleet, slot: number): void {
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const im of fleet.meshes) { im.setMatrixAt(slot, zero); im.instanceMatrix.needsUpdate = true; }
}
