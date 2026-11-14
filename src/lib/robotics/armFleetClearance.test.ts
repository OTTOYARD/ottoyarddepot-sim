// The OTTO-CHARGE ARM, as the yard draws it (its CAD), against each fleet vehicle's own body, with its base where
// that vehicle's mate puts it and the connector that vehicle takes forward. cadYard.test.ts holds the arm to the
// yard's one generic car; this holds it to the six real ones, through the whole cycle, on every stall side that
// can charge them.
import { beforeAll, describe, expect, it } from 'vitest';
import { depotSceneFromDisk } from '@/test/cadDisk';
import { armClearanceRig, type ArmClearanceRig } from '@/lib/ottoChargeArm/armClearance';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { STRUCTURAL_MARGIN_M } from '@/lib/ottoChargeArm/armSweeps';
import type { ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';
import { STOWED } from '@/lib/ottoChargeArm/cobotIK';
import { OTTO_CHARGE_ARM } from '@/lib/ottoChargeArm/cobotSpec';
import { ARM_REACH, solveMate } from '@/lib/ottoChargeArm/mateSolver';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { fleetCarSolid } from '@/lib/fleetModels/carSolid';
import { mateTarget } from '@/lib/fleetModels/ports';
import { cadArmRigSource } from './cadClearance';

const CYCLE: ArmPhase[] = ['unstow', 'approach', 'align', 'insert', 'latch', 'charging', 'unlatch', 'extract', 'retract'];
const AT_INLET = new Set<ArmPhase>(['align', 'insert', 'latch', 'charging', 'unlatch', 'extract']);

describe('OTTO-CHARGE ARM (its CAD) against each fleet vehicle, base and connector where the mate puts them', () => {
  let rig: ArmClearanceRig;
  beforeAll(async () => { rig = armClearanceRig(cadArmRigSource(await depotSceneFromDisk('charge_arm'))); });

  const cases = FLEET_SPECS.flatMap((spec) => ([1, -1] as const).map((toward) => ({ key: spec.key, spec, toward })))
    .filter(({ spec, toward }) => solveMate(mateTarget(spec)!, toward === 1).ok);

  it('covers every vehicle on every stall side that can charge it', () => {
    // 4 left-port vehicles on the left-arm side, the Zoox and the Cybercab on both
    expect(cases.length).toBe(8);
  });

  it.each(cases)('$key, stall facing $toward: every part but the connector stays 0.10 m off the car all cycle, and the connector reaches the inlet', ({ spec, toward }) => {
    const m = solveMate(mateTarget(spec)!, toward === 1);
    // THE ORDER OF A MATE (ChargingArm.tsx plays it): the carriage goes along the rail with the arm folded, to
    // where it unfolds; the arm unfolds to its standoff pose with the cross-slide OUT; the carriage and then the
    // cross-slide carry it to the mate; it aligns and inserts. A release is the same backwards.
    const carOut = fleetCarSolid(spec, toward, m.unfoldSlideM, 0);
    const carIn = fleetCarSolid(spec, toward, m.slideM, m.crossM);
    const target = { port: m.axisPort, normal: m.normal };
    const plunge = (out: boolean) => {
      rig.root.getObjectByName('Head_CCS')!.position.y = out && m.head === 'CCS1' ? ARM_REACH.headStrokeM : 0;
      rig.root.getObjectByName('Head_NACS')!.position.y = out && m.head === 'NACS' ? ARM_REACH.headStrokeM : 0;
    };
    let worst = Infinity, where = '';
    const look = (car: typeof carIn, tag: string, tool: boolean) => {
      const c = rig.clearance(car, 'structure', 2 * STRUCTURAL_MARGIN_M);
      if (c.min < worst) { worst = c.min; where = `${tag} ${c.part}`; }
      if (tool) {
        const t = rig.clearance(car, 'tool', 2 * STRUCTURAL_MARGIN_M);
        if (t.min < worst) { worst = t.min; where = `${tag} tool ${t.part}`; }
      }
    };
    for (const phase of CYCLE) {
      const steps = phase === 'charging' ? 0 : 8;
      const atInlet = AT_INLET.has(phase);
      plunge(atInlet);
      for (let k = 0; k <= steps; k++) {
        const p = poseFor({ phase, t: steps ? k / steps : 0 }, target, OTTO_CHARGE_ARM);
        expect(p.ok, `${spec.key} ${phase}: the arm refused`).toBe(true);
        rig.pose({ ...p.angles, j6: m.ik!.j6 });
        // away from the inlet the connectors stay off the car too
        look(atInlet ? carIn : carOut, `${phase} ${k}/${steps}`, !atInlet);
      }
    }
    // the cross-slide's own move, in and back: the arm holds its standoff pose, both connectors back
    plunge(false);
    const hold = poseFor({ phase: 'approach', t: 1 }, target, OTTO_CHARGE_ARM);
    rig.pose({ ...hold.angles, j6: m.ik!.j6 });
    for (let k = 0; k <= 8; k++) look(fleetCarSolid(spec, toward, m.unfoldSlideM + ((m.slideM - m.unfoldSlideM) * k) / 8, 0), `carriage in ${k}/8`, true);
    for (let k = 0; k <= 8; k++) look(fleetCarSolid(spec, toward, m.slideM, (m.crossM * k) / 8), `cross-slide ${k}/8`, true);
    // and the carriage's run along the rail, arm folded, cross-slide out
    rig.pose(STOWED);
    for (let k = 0; k <= 16; k++) look(fleetCarSolid(spec, toward, (m.unfoldSlideM * k) / 16, 0), `rail ${k}/16`, true);
    expect(worst, `${spec.key}: the arm comes within ${worst.toFixed(3)} m of the car at ${where}`).toBeGreaterThan(STRUCTURAL_MARGIN_M);
    // at full mate the connector is on the car
    plunge(true);
    const p = poseFor({ phase: 'charging', t: 0 }, target, OTTO_CHARGE_ARM);
    rig.pose({ ...p.angles, j6: m.ik!.j6 });
    expect(rig.clearance(carIn, 'tool').min, `${spec.key}: the connector at full mate`).toBeLessThan(0.03);
    plunge(false);
  }, 300_000);
});
