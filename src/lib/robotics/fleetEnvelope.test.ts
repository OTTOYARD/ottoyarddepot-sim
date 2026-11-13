// fleetEnvelope.test.ts — the two machines that work over and around a whole car, against the SIZE of each fleet
// vehicle. cadYard.test.ts holds them to the yard's one generic car (4.69 m x 1.91 m, 1.64 m to the top of its roof
// sensor). The six real ones are up to 5.03 m long, 2.00 m wide and 1.94 m tall. This measures:
//   - OTTO-CLEAN ARM parked and swinging over the stall: how far its lowest part is above each vehicle's top;
//   - OTTO-WASH stowed, a car driving through the bay: how far the machine is from each vehicle's swept box.
// It does NOT cover the work inside a cabin or on a body. The cleaning arm's path through each vehicle's own doors is
// held by ottoCleanArm/cleanArmFleet.test.ts (which also measures the arm over each vehicle's roof EQUIPMENT: this
// file measures against dims.height, and the Ojai's roof lidar stands 0.285 m over that). The wash arms' pad
// positions are still written for the generic car's sensors (docs/CHARGE-ARM-REACH.md, "What is not built").
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { depotSceneFromDisk } from '@/test/cadDisk';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { cleanJointsAt, sidesFor, type CleanSides } from '@/lib/ottoCleanArm/cleanArmPose';
import { CLEAN_CHAIN, type CleanPhase } from '@/lib/ottoCleanArm/cleanArmSpec';
import { washPoseAt } from '@/lib/ottoWash/washPose';
import { WASH_TRAVEL } from '@/lib/ottoWash/washSpec';
import { partOfMesh } from './cadClearance';
import { indexCad, poseCad, type CadModel } from './cadModel';
import { cleanAngles, washJoints } from './catalog';

/** The least room a machine keeps over or beside a vehicle it does not touch, metres. */
const OVER_M = 0.05;
const BESIDE_M = 0.25;

function vertices(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean, visit: (p: THREE.Vector3, part: string) => void): void {
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !keep(m)) return;
    const a = (m.geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>;
    const part = partOfMesh(m) ?? m.name;
    for (let j = 0; j < a.length; j += 3) visit(v.set(a[j], a[j + 1], a[j + 2]).applyMatrix4(m.matrixWorld), part);
  });
}

describe('each fleet vehicle\'s size against the machines that stand over it', () => {
  let clean: CadModel;
  let wash: CadModel;
  let cleanLow = Infinity;
  const washPts: { x: number; y: number; part: string }[] = [];
  beforeAll(async () => {
    clean = indexCad(await depotSceneFromDisk('clean_arm'));
    wash = indexCad(await depotSceneFromDisk('wash_gantry'));
    // the cleaning arm, parked and swinging, both columns: its lowest point over the widest vehicle's plan
    const widest = Math.max(...FLEET_SPECS.map((s) => s.dims.width));
    for (const sides of [sidesFor(1), sidesFor(-1)] as CleanSides[]) {
      for (const phase of CLEAN_CHAIN as readonly CleanPhase[]) {
        if (!['home', 'doors_open', 'swing_a', 'swing_b', 'return', 'doors_close'].includes(phase)) continue;
        for (let k = 0; k <= 8; k++) {
          poseCad(clean, cleanAngles(cleanJointsAt(phase, k / 8, sides)));
          clean.root.updateMatrixWorld(true);
          vertices(clean.root, (m) => !['CLN-HDR', 'CLN-COL', 'CLN-CLP'].includes(partOfMesh(m) ?? ''),
            (p) => { if (Math.abs(p.z) < widest / 2 + 0.3) cleanLow = Math.min(cleanLow, p.y); });
        }
      }
    }
    // the wash machine stowed, wherever its gantry stands
    const home = washPoseAt({ phase: 'home', t: 1, from: null });
    for (const dy of [WASH_TRAVEL.north, -5, -2.5, 0, 2.5, 5, WASH_TRAVEL.south, WASH_TRAVEL.home]) {
      poseCad(wash, washJoints({ ...home, dy }));
      wash.root.updateMatrixWorld(true);
      vertices(wash.root, () => true, (p, part) => { washPts.push({ x: Math.abs(p.x), y: p.y, part }); });
    }
  }, 120_000);

  it.each(FLEET_SPECS.map((s) => ({ key: s.key, spec: s })))('$key: the cleaning arm parks over it, and it drives through the wash bay', ({ spec }) => {
    const over = cleanLow - spec.dims.height;
    expect(over, `${spec.key}: the cleaning arm's lowest parked point is ${over.toFixed(3)} m over the vehicle's top`).toBeGreaterThan(OVER_M);
    let beside = Infinity, at = '';
    for (const p of washPts) {
      const out = Math.max(p.x - spec.dims.width / 2, p.y - spec.dims.height);
      if (out < beside) { beside = out; at = p.part; }
    }
    expect(beside, `${spec.key}: ${at} stands ${beside.toFixed(3)} m from the vehicle's swept box`).toBeGreaterThan(BESIDE_M);
    console.log(`ENV ${spec.key}: clean arm ${over.toFixed(3)} m over the top; wash ${beside.toFixed(3)} m from the swept box (${at})`);
  });
});
