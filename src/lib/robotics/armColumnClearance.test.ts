// armColumnClearance.test.ts — the OTTO-CHARGE ARM (its CAD: rail bed, carriage, cross-slide and arm) against the
// canopy's spine columns, at every fast charger, with the base wherever a fleet vehicle's mate puts it. A column
// is drawn in three tiers (SolarCanopy.tsx): a 2.0 u plinth to 0.5 u, a 1.6 u banded pier to 1.7 u, the 1.2 u
// steel above. The arm's rail runs toward the car's nose, which is toward the spine the columns stand on.
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { depotSceneFromDisk } from '@/test/cadDisk';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { mateTarget } from '@/lib/fleetModels/ports';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import type { ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';
import { STOWED, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { METRES_PER_PLAN_UNIT, MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import { placeArm } from '@/lib/ottoChargeArm/depotPlacement';
import { ARM_REACH, BASE_JOINT_NAMES, HEAD_JOINT_NAMES, bedCentreX, solveMate } from '@/lib/ottoChargeArm/mateSolver';
import { AT_INLET } from '@/lib/ottoChargeArm/mateSequence';
import { generateStallsV2 } from '@/lib/sitePlan';
import { canopyColumnSolids } from '@/lib/structurePlan';
import { partOfMesh } from './cadClearance';
import { indexCad, poseCad, type CadModel } from './cadModel';

const U = METRES_PER_PLAN_UNIT;
/** Steel and concrete the arm does not touch: the least room, metres. */
const COLUMN_CLEAR_M = 0.05;
/** A column's half-size at a height above grade, metres (SolarCanopy.tsx). */
const columnHalf = (h: number) => (h < 0.5 * U ? 1.0 : h < 1.7 * U ? 0.8 : 0.6) * U;

interface Column { cx: number; cz: number; cos: number; sin: number; stall: string }

describe('OTTO-CHARGE ARM and its rail bed against the canopy columns', () => {
  let model: CadModel;
  const meshes: { m: THREE.Mesh; a: ArrayLike<number>; part: string; moves: boolean }[] = [];
  beforeAll(async () => {
    model = indexCad(await depotSceneFromDisk('charge_arm'));
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let moves = false;
      for (let n: THREE.Object3D | null = m; n; n = n.parent) if ((n.userData as { joint?: { name?: string } }).joint?.name === BASE_JOINT_NAMES[1]) moves = true;
      meshes.push({ m, a: (m.geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>, part: partOfMesh(m) ?? m.name, moves });
    });
  });

  it.each([1, -1] as const)('stalls facing %i: every part stays 0.05 m off every column, at every vehicle\'s mate', (toward) => {
    // each column near a stall of this facing, in that stall's arm frame (metres; the inverse of robotPlan.armToPlan)
    const cols: Column[] = [];
    for (const s of generateStallsV2()) {
      if (s.type !== 'dcfc') continue;
      const p = placeArm(s.id, s.position.x, s.position.y, s.position.angle);
      if (p.toward !== toward) continue;
      const c = Math.cos(p.rotationY), n = Math.sin(p.rotationY);
      for (const k of canopyColumnSolids()) {
        const dx = (150 - (k.r.x0 + k.r.x1) / 2 - p.world[0]) / p.scale;
        const dz = (110 - (k.r.y0 + k.r.y1) / 2 - p.world[2]) / p.scale;
        const cx = dx * c - dz * n, cz = dx * n + dz * c;
        if (Math.hypot(cx, cz) < 7) cols.push({ cx, cz, cos: c, sin: n, stall: s.id });
      }
    }
    // every charger stands on its car's left since 2026-11-13: no stall has the other sign, and there is nothing to measure
    if (!cols.length) { expect(toward).toBe(1); return; }
    const v = new THREE.Vector3();
    let worst = Infinity, where = '';
    let fixed = Infinity, fixedWhere = '';
    const look = (tag: string) => {
      model.root.updateMatrixWorld(true);
      for (const { m, a, part, moves } of meshes) {
        for (let j = 0; j < a.length; j += 3) {
          v.set(a[j], a[j + 1], a[j + 2]).applyMatrix4(m.matrixWorld);
          const half = columnHalf(v.y + MOUNT_HEIGHT_M);
          for (const k of cols) {
            // into the column's own square axes (the site's): the arm frame is turned rotationY from them
            const rx = v.x - k.cx, rz = v.z - k.cz;
            const sx = Math.abs(rx * k.cos + rz * k.sin) - half, sz = Math.abs(-rx * k.sin + rz * k.cos) - half;
            const d = sx > 0 || sz > 0 ? Math.hypot(Math.max(sx, 0), Math.max(sz, 0)) : Math.max(sx, sz);
            if (moves) { if (d < worst) { worst = d; where = `${tag}, ${part}, the column by ${k.stall}`; } }
            else if (d < fixed) { fixed = d; fixedWhere = `${part}, the column by ${k.stall}`; }
          }
        }
      }
    };
    const set = (a: JointAngles, slide: number, cross: number, head: string | null) => poseCad(model, {
      J1: a.j1, J2: a.j2, J3: a.j3, J4: a.j4, J5: a.j5, J6: a.j6,
      [BASE_JOINT_NAMES[0]]: bedCentreX(toward), [BASE_JOINT_NAMES[1]]: slide, [BASE_JOINT_NAMES[2]]: cross,
      [HEAD_JOINT_NAMES.CCS1]: head === 'CCS1' ? ARM_REACH.headStrokeM : 0, [HEAD_JOINT_NAMES.NACS]: head === 'NACS' ? ARM_REACH.headStrokeM : 0,
    });
    // the folded arm along the whole rail
    const lo = toward > 0 ? -ARM_REACH.railNoseM : -ARM_REACH.railTailM, hi = toward > 0 ? ARM_REACH.railTailM : ARM_REACH.railNoseM;
    for (let k = 0; k <= 16; k++) { set(STOWED, lo + ((hi - lo) * k) / 16, 0, null); look(`folded on the rail ${k}/16`); }
    for (const spec of FLEET_SPECS) {
      const m = solveMate(mateTarget(spec)!, toward === 1);
      if (!m.ok) continue;
      const target = { port: m.axisPort, normal: m.normal };
      for (const phase of ['unstow', 'approach', 'align', 'insert', 'charging', 'extract', 'retract'] as ArmPhase[]) {
        const at = AT_INLET.has(phase);
        for (let k = 0; k <= (phase === 'charging' ? 0 : 6); k++) {
          const a = { ...poseFor({ phase, t: k / 6 }, target).angles, j6: m.ik!.j6 };
          set(a, at ? m.slideM : m.unfoldSlideM, at ? m.crossM : 0, at ? m.head : null);
          look(`${spec.key} ${phase} ${k}/6`);
        }
      }
    }
    console.log(`COL toward ${toward}: moving ${worst.toFixed(3)} m at ${where}; fixed bed ${fixed.toFixed(3)} m at ${fixedWhere}`);
    expect(fixed, `the rail bed: ${fixed.toFixed(3)} m at ${fixedWhere}`).toBeGreaterThan(COLUMN_CLEAR_M);
    expect(worst, `${worst.toFixed(3)} m at ${where}`).toBeGreaterThan(COLUMN_CLEAR_M);
  }, 600_000);
});
