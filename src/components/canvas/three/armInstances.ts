import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCobot, type CobotHandles } from '@/lib/ottoChargeArm/buildCobot';
import { OTTO_CHARGE_ARM } from '@/lib/ottoChargeArm/cobotSpec';
import { makeInstancedFleet, writeFleetSlot, clearFleetSlot, type InstancedFleet, type RigidPart } from './instancedFleet';

/**
 * OTTO-CHARGE ARMS, INSTANCED — every arm on the site in a fixed number of draw
 * calls (phone lane, 2026-09-29).
 *
 * Each arm used to be a clone of the template: 38 meshes, 27 of them shadow
 * casters, so ten arms cost ~650 draw calls a frame (main + shadow pass) and a
 * 20-charger build-out would have cost ~1,300. Here the template is cut into
 * RIGID SEGMENTS — the parts that move together: the plinth, then everything
 * each joint (J1..J6) and the connector latch carries — and each segment's
 * meshes are merged per material into one geometry in the segment's own frame.
 * Every (segment, material) pair is then ONE InstancedMesh holding every arm.
 *
 *   draw calls = pairs + shadow-casting pairs, whatever the arm count
 *
 * The joints still animate exactly as before: each ChargingArm keeps its own
 * joint hierarchy (a SKELETON — the template with its meshes removed), drives
 * it through the same IK and rate limits, and writes each segment's world
 * matrix into its slot. What is drawn is the same geometry at the same
 * transforms; only the batching changed.
 */

export const ARM_TEMPLATE: CobotHandles = buildCobot(OTTO_CHARGE_ARM, { withPlinth: true, lod: 'depot' });

/** The nodes whose local transform changes at runtime (ChargingArm drives them). */
export const ARM_SEGMENTS = [
  'J1_BaseYaw', 'J2_Shoulder', 'J3_Elbow', 'J4_ForearmRoll', 'J5_WristPitch', 'J6_ToolRoll', 'Connector_Latch',
] as const;
/** Segment index 0 is the arm's own root (plinth, mount); 1.. are ARM_SEGMENTS. */
export const SEGMENT_COUNT = ARM_SEGMENTS.length + 1;

/** One rigid segment's meshes of one material; `status` marks the per-arm status LEDs (colour and glow per instance). */
export type ArmPart = RigidPart;

function segmentOf(o: THREE.Object3D, root: THREE.Object3D): { index: number; node: THREE.Object3D } {
  let p: THREE.Object3D | null = o.parent;
  while (p && p !== root) {
    const i = (ARM_SEGMENTS as readonly string[]).indexOf(p.name);
    if (i >= 0) return { index: i + 1, node: p };
    p = p.parent;
  }
  return { index: 0, node: root };
}

/** Cut the template into (segment, material, casts) groups, merged in segment space. */
function buildParts(t: CobotHandles): ArmPart[] {
  t.root.updateMatrixWorld(true);
  const groups = new Map<string, { segment: number; material: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  const inv = new THREE.Matrix4();
  t.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const { index, node } = segmentOf(m, t.root);
    const material = m.material as THREE.Material;
    const key = `${index}|${material.uuid}|${m.castShadow}`;
    // mesh transform relative to its segment node
    const rel = inv.copy(node.matrixWorld).invert().multiply(m.matrixWorld);
    let g = m.geometry.clone().applyMatrix4(rel);
    g = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const entry = groups.get(key) ?? { segment: index, material, cast: m.castShadow, geos: [] };
    entry.geos.push(g);
    groups.set(key, entry);
  });
  const parts: ArmPart[] = [];
  for (const e of groups.values()) {
    const geometry = mergeGeometries(e.geos, false);
    if (!geometry) throw new Error('armInstances: could not merge a segment');
    parts.push({ segment: e.segment, geometry, material: e.material, castShadow: e.cast, status: e.material === t.statusMaterial });
  }
  return parts;
}

export const ARM_PARTS: ArmPart[] = buildParts(ARM_TEMPLATE);

/**
 * A skeleton for one arm: the template's node hierarchy with every mesh
 * removed, so the joints can be driven and their world matrices read without
 * anything being drawn from it.
 */
export function armSkeleton(): THREE.Object3D {
  const root = ARM_TEMPLATE.root.clone(true);
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
  for (const m of meshes) m.removeFromParent();
  return root;
}

export { statusMaterial } from './instancedFleet';

/** Every arm on the site, instanced (instancedFleet.ts): the procedural arm's parts, or the CAD arm's (cadFleet.ts). */
export type ArmFleet = InstancedFleet;

export function makeArmFleet(capacity: number, parts: readonly RigidPart[] = ARM_PARTS): ArmFleet {
  return makeInstancedFleet(parts, capacity);
}

/** Segment nodes of a skeleton, in segment-index order (0 = the root). */
export function segmentNodes(skeleton: THREE.Object3D): THREE.Object3D[] {
  return [skeleton, ...ARM_SEGMENTS.map((n) => {
    const node = skeleton.getObjectByName(n);
    if (!node) throw new Error(`armInstances: skeleton has no ${n}`);
    return node;
  })];
}

/**
 * Write one arm's segments and status LED into its slot. Call after the joints
 * are set and the skeleton's world matrices updated.
 */
export function writeArm(fleet: ArmFleet, slot: number, nodes: readonly THREE.Object3D[], statusHex: number, glow: number): void {
  writeFleetSlot(fleet, slot, nodes, statusHex, glow);
}

/** Hide a slot (its arm unmounted). */
export function clearArm(fleet: ArmFleet, slot: number): void {
  clearFleetSlot(fleet, slot);
}
