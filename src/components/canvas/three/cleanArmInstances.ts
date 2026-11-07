import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCleanArm, CLEAN_ARM_NODES, type CleanArmHandles, type CleanArmNode } from '@/lib/ottoCleanArm/buildCleanArm';
import { makeInstancedFleet, writeFleetSlot, clearFleetSlot, type InstancedFleet, type RigidPart } from './instancedFleet';

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

/** One rigid segment's meshes of one material; `status` marks the status lights (J1's ring, the mast strip, the nozzle ring). */
export type CleanArmPart = RigidPart;

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

/** Every cleaning arm on the site, instanced (instancedFleet.ts): the procedural arm's parts, or the CAD arm's. */
export type CleanArmFleet = InstancedFleet;

export function makeCleanArmFleet(capacity: number, parts: readonly RigidPart[] = CLEAN_PARTS): CleanArmFleet {
  return makeInstancedFleet(parts, capacity, { receiveShadow: true });
}

/** Write one arm's segments and status lights into its slot (after its world matrices are current). */
export function writeCleanArm(fleet: CleanArmFleet, slot: number, segments: readonly THREE.Object3D[], statusHex: number, glow: number): void {
  writeFleetSlot(fleet, slot, segments, statusHex, glow);
}

/** Hide a slot (its arm unmounted). */
export function clearCleanArm(fleet: CleanArmFleet, slot: number): void {
  clearFleetSlot(fleet, slot);
}
