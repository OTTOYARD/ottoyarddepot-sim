// catalog.test.ts — the Robotics tab's poses and steps are the twin's own: the charge arm's "connected" pose is the
// twin's IK solution and puts the connector on the port, the clean arm's poses are cleanJointsAt's, the wash machine's
// are washPoseAt's, and the run steps are the twin's phase tables. Plus the parts-list filter.
import { describe, expect, it } from 'vitest';
import { forwardTCP } from '@/lib/ottoChargeArm/cobotIK';
import { ARM_TIMING_DEFAULTS } from '@/lib/ottoChargeArm/armStateMachine';
import { FLANK_STANDOFF_M, MOUNT_HEIGHT_M, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { CLEAN_MOTION_S } from '@/lib/ottoCleanArm/cleanArmSpec';
import { SIDE_BRUSH_CONTACT_X } from '@/lib/ottoWash/washPose';
import { WASH_GANTRY, WASH_HOME_DY, PASSES_NOMINAL_S } from '@/lib/ottoWash/washSpec';
import { SAMPLE_PORT, cycleSteps, filterLines, posePresets, washAngles, type BomLine } from './catalog';

describe('pose presets come from the twin\'s own code', () => {
  it('charge arm: "connected" is the twin\'s IK, and puts the connector tip on the port', () => {
    const p = posePresets('charge_arm').find((x) => x.id === 'connected')!;
    const a = p.angles;
    const tip = forwardTCP({ j1: a.J1, j2: a.J2, j3: a.J3, j4: a.J4, j5: a.J5, j6: a.J6 });
    expect(tip.x).toBeCloseTo(SAMPLE_PORT.along, 6);
    expect(tip.y).toBeCloseTo(SAMPLE_PORT.height - MOUNT_HEIGHT_M, 6);
    expect(tip.z).toBeCloseTo(FLANK_STANDOFF_M, 6);
  });
  it('wash: home is the north end with every tool retracted; a brush pass closes the side brushes on the flank', () => {
    const home = washAngles('home', 1);
    expect(home.GANTRY).toBeCloseTo(-WASH_HOME_DY * METRES_PER_PLAN_UNIT, 6);
    for (const k of ['TOP_BRUSH', 'SIDE_BRUSH_L', 'DRYER_TOP', 'WAND_L_DROP1', 'WAND_R_REACH1', 'WAND_R_REACH2']) expect(home[k]).toBeCloseTo(0, 6);
    const brush = washAngles('wash_1', 0.5);
    expect(brush.SIDE_BRUSH_L).toBeCloseTo((WASH_GANTRY.sideBrush.retractX - SIDE_BRUSH_CONTACT_X) * METRES_PER_PLAN_UNIT, 6);
    expect(brush.SIDE_BRUSH_R).toBe(brush.SIDE_BRUSH_L);
    const vac = washAngles('vacuum', 0.5);
    expect(vac.WAND_L_DROP1 + vac.WAND_L_DROP2 + vac.WAND_L_DROP3).toBeCloseTo((WASH_GANTRY.wand.topY - WASH_GANTRY.wand.workY) * METRES_PER_PLAN_UNIT, 6);
    // the 2 reach tubes each take half the twin's reach (cad wash_gantry.WAND_REACH_STAGES)
    const reachIn = washAngles('wands_in', 1);
    expect(reachIn.WAND_L_REACH1).toBeCloseTo((WASH_GANTRY.wand.x - WASH_GANTRY.wand.reachX) * METRES_PER_PLAN_UNIT / 2, 6);
    expect(reachIn.WAND_L_REACH2).toBe(reachIn.WAND_L_REACH1);
  });
  it('clean arm: home stows the mast; in the cabin the mast is down and the wand out', () => {
    const [home, , clean] = posePresets('clean_arm');
    expect(home.angles.CA_Mast2).toBe(0);
    expect(clean.angles.CA_Mast2).toBeGreaterThan(0.3);
    expect(clean.angles.CA_Wand2).toBeGreaterThan(0);
    // 3 sliding tubes, a third of the twin's extension each (cad clean_arm.WAND_SLIDES)
    expect(clean.angles.CA_Wand3).toBe(clean.angles.CA_Wand2);
    expect(clean.angles.CA_Wand4).toBe(clean.angles.CA_Wand2);
  });
});

describe('run steps are the twin\'s phase tables', () => {
  it('charge arm: the 9 timed and charge phases, with the default timings', () => {
    const s = cycleSteps('charge_arm');
    expect(s.map((x) => x.id)).toEqual(['unstow', 'approach', 'align', 'insert', 'latch', 'charging', 'unlatch', 'extract', 'retract']);
    expect(s.find((x) => x.id === 'retract')!.seconds).toBe(ARM_TIMING_DEFAULTS.retract);
    expect(s.find((x) => x.id === 'charging')!.seconds).toBeNull();
  });
  it('clean arm: its fixed moves sum to CLEAN_MOTION_S', () => {
    const fixed = cycleSteps('clean_arm').filter((x) => !x.note);
    expect(fixed.reduce((a, x) => a + (x.seconds ?? 0), 0)).toBeCloseTo(CLEAN_MOTION_S, 6);
  });
  it('wash: the 6 passes sum to PASSES_NOMINAL_S', () => {
    const passes = cycleSteps('wash_gantry').filter((x) => x.label.startsWith('Pass'));
    expect(passes).toHaveLength(6);
    expect(passes.reduce((a, x) => a + (x.seconds ?? 0), 0)).toBe(PASSES_NOMINAL_S);
  });
});

describe('the parts filter', () => {
  const L = (id: string, category: string, sub: string, extra: Partial<BomLine> = {}): BomLine => ({
    id, name: id, category, make: 'buy', standard: '', size: '', grade: '', material: 'Steel', materialKey: 'steel', qty: 2,
    massKg: 1, totalMassKg: 2, torqueNm: null, function: '', spec: {}, uses: [{ sub, qty: 2 }], ...extra,
  });
  const lines = [L('A', 'fastener', 'J1', { size: 'M8 x 30' }), L('B', 'drive', 'J1'), L('C', 'fastener', 'J2'), L('R', 'structure', 'J1', { reference: true })];
  it('drops reference parts, and filters by subsystem, fasteners and text', () => {
    expect(filterLines(lines, {}).map((l) => l.id)).toEqual(['A', 'B', 'C']);
    expect(filterLines(lines, { sub: 'J1' }).map((l) => l.id)).toEqual(['A', 'B']);
    expect(filterLines(lines, { fasteners: 'only' }).map((l) => l.id)).toEqual(['A', 'C']);
    expect(filterLines(lines, { fasteners: 'none' }).map((l) => l.id)).toEqual(['B']);
    expect(filterLines(lines, { query: 'm8' }).map((l) => l.id)).toEqual(['A']);
  });
});

describe('the cycle played on the CAD is the twin\'s choreography', () => {
  it('charge arm: starts stowed, ends the insert on the port, and runs the twin\'s phase times', async () => {
    const { cycleScript, SHORT_STEP_S } = await import('./catalog');
    const { STOWED } = await import('@/lib/ottoChargeArm/cobotIK');
    const s = cycleScript('charge_arm');
    const timed = Object.values(ARM_TIMING_DEFAULTS).reduce((a, x) => a + x, 0);
    expect(s.total).toBeCloseTo(timed + SHORT_STEP_S, 6);
    const start = s.at(0).angles;
    expect(start.J2).toBeCloseTo(STOWED.j2, 6);
    expect(start.J3).toBeCloseTo(STOWED.j3, 6);
    const insertEnd = s.steps.slice(0, s.steps.findIndex((x) => x.id === 'insert') + 1).reduce((a, x) => a + x.seconds, 0) - 1e-6;
    const a = s.at(insertEnd).angles;
    const tip = forwardTCP({ j1: a.J1, j2: a.J2, j3: a.J3, j4: a.J4, j5: a.J5, j6: a.J6 });
    expect(Math.hypot(tip.x - SAMPLE_PORT.along, tip.y - (SAMPLE_PORT.height - MOUNT_HEIGHT_M), tip.z - FLANK_STANDOFF_M)).toBeLessThan(1e-3);
    expect(s.steps.find((x) => x.id === 'charging')!.short).toBe(true);
  });
  it('clean arm and wash: every step of the twin\'s chain, in order, and the wands reach the floor in the vacuum', async () => {
    const { cycleScript } = await import('./catalog');
    const { CLEAN_CHAIN } = await import('@/lib/ottoCleanArm/cleanArmSpec');
    const { washChain } = await import('@/lib/ottoWash/washSpec');
    expect(cycleScript('clean_arm').steps.map((x) => x.id)).toEqual([...CLEAN_CHAIN]);
    const w = cycleScript('wash_gantry');
    expect(w.steps.map((x) => x.id)).toEqual([...washChain(true)]);
    const i = w.steps.findIndex((x) => x.id === 'vacuum');
    const mid = w.steps.slice(0, i).reduce((a, x) => a + x.seconds, 0) + w.steps[i].seconds / 2;
    const v = w.at(mid).angles;
    expect(v.WAND_L_DROP1 + v.WAND_L_DROP2 + v.WAND_L_DROP3).toBeCloseTo((WASH_GANTRY.wand.topY - WASH_GANTRY.wand.workY) * METRES_PER_PLAN_UNIT, 6);
  });
});
