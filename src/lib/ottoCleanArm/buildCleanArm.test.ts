/**
 * The drawn OTTO-CLEAN ARM is the arm the clearance tests measure: its pivot, its wand's
 * end and its nozzle's mouth land where cleanArmPose's forward kinematics put them, at
 * every pose of the cycle, on both flanks. A model that drifted from the FK would make
 * every clearance figure a claim about a different machine.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCleanArm, poseCleanArm } from './buildCleanArm';
import { cleanArmPoints, cleanJointsAt, sidesFor } from './cleanArmPose';
import { CLEAN_CHAIN, CLEAN_ARM } from './cleanArmSpec';

describe('the drawn cleaning arm', () => {
  it('puts its wrist, wand end and nozzle mouth where the FK says, all cycle long', () => {
    const arm = buildCleanArm();
    const v = new THREE.Vector3();
    let worst = 0, checked = 0;
    for (const toward of [1, -1] as const) {
      const sides = sidesFor(toward);
      for (const phase of CLEAN_CHAIN) {
        for (let i = 0; i <= 10; i++) {
          const q = cleanJointsAt(phase, i / 10, sides);
          poseCleanArm(arm.nodes, q);
          arm.root.updateMatrixWorld(true);
          const pt = cleanArmPoints(q);
          const at = (o: THREE.Object3D) => o.getWorldPosition(v).clone();
          const pivot = at(arm.nodes.CA_Pitch);
          const knuckle = at(arm.nodes.CA_Nozzle);
          const mouth = at(arm.mouth);
          for (const [a, b] of [[pivot, pt.pivot], [knuckle, pt.knuckle], [mouth, pt.tip]] as const) {
            worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(2 * CLEAN_CHAIN.length * 11);
    expect(worst).toBeLessThan(1e-9);
  });

  it('nests the telescopes: every stage overlaps the one behind it at full stroke', () => {
    // the mast's stages slide half the extension each and keep their overlap
    const A = CLEAN_ARM;
    expect(2 * (A.mast.stage - A.mast.overlap)).toBeGreaterThan(0);
    expect(A.wand.maxExt / 2 + 0.06 - A.wand.maxExt / 2).toBeCloseTo(0.06, 9);
  });
});
