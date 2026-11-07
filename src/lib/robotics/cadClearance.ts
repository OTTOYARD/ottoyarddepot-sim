/**
 * THE ENGINEERING CAD, MEASURED AS THE TWIN MEASURES ITS ROBOTS. The depot draws the CAD robots (cadDepot.ts), so
 * the clearance tests that held the procedural robots to the car, the cabinet, the doors and the building must hold
 * the CAD to them too: the same solids, the same poses, the drawn geometry. This file adapts a CAD scene to those
 * measurements; robotics/cadYard.test.ts runs them.
 */
import * as THREE from 'three';
import { OTTO_CHARGE_ARM, TCP_NODE_NAME, type CobotSpec } from '@/lib/ottoChargeArm/cobotSpec';
import type { ArmRigSource } from '@/lib/ottoChargeArm/armClearance';

/** The charge arm's joint nodes, J1..J6: the procedural arm's names, which the CAD carries too (cad.test.ts). */
export const CHARGE_JOINT_NODES = [
  'J1_BaseYaw', 'J2_Shoulder', 'J3_Elbow', 'J4_ForearmRoll', 'J5_WristPitch', 'J6_ToolRoll',
] as const;

/** The CAD subsystem a mesh belongs to (its part node's `sub`), or null. */
export function subOf(o: THREE.Object3D): string | null {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const u = n.userData as { part?: unknown; sub?: unknown };
    if (typeof u.part === 'string') return typeof u.sub === 'string' ? u.sub : null;
  }
  return null;
}

/** The CAD part id a mesh belongs to, or null. */
export function partOfMesh(o: THREE.Object3D): string | null {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const p = (n.userData as { part?: unknown }).part;
    if (typeof p === 'string') return p;
  }
  return null;
}

/**
 * The CAD charge arm as an arm the clearance rig can pose and measure (armClearance.armClearanceRig). Its joints
 * rest at zero and turn about the twin's axes (cad.test.ts holds both), so the twin's joint angles pose it exactly
 * as they pose the procedural arm. The TCP is `spec.tool` past the J6 flange, on the tool axis; the connector is
 * the CAD's TOOL subsystem.
 */
export function cadArmRigSource(scene: THREE.Object3D, spec: CobotSpec = OTTO_CHARGE_ARM): ArmRigSource {
  const joints = CHARGE_JOINT_NODES.map((n) => {
    const o = scene.getObjectByName(n);
    if (!o) throw new Error(`cadClearance: the CAD arm has no ${n}`);
    if (Math.abs(o.quaternion.w) < 1 - 1e-9) throw new Error(`cadClearance: ${n} does not rest at zero`);
    return o;
  }) as unknown as ArmRigSource['joints'];
  const j6 = joints[5];
  const tcp = new THREE.Object3D();
  tcp.name = TCP_NODE_NAME;
  tcp.position.y = spec.tool;
  j6.add(tcp);
  return { root: scene, joints, tcp, toolAxis: j6, isTool: (m) => subOf(m) === 'TOOL' };
}
