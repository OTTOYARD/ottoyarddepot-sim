// catalog.test.ts — the Robotics tab's poses and steps are the twin's own: the charge arm's "connected" pose is the
// twin's IK solution and puts the connector on the port, the clean arm's poses are cleanJointsAt's, the wash machine's
// are washPoseAt's, and the run steps are the twin's phase tables. Plus the parts-list filter.
import { describe, expect, it } from 'vitest';
import { forwardTCP } from '@/lib/ottoChargeArm/cobotIK';
import { ARM_TIMING_DEFAULTS } from '@/lib/ottoChargeArm/armStateMachine';
import { FLANK_STANDOFF_M, MOUNT_HEIGHT_M, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { CLEAN_MOTION_S } from '@/lib/ottoCleanArm/cleanArmSpec';
import { WASH_HOME_DY, PASSES_NOMINAL_S } from '@/lib/ottoWash/washSpec';
import { DETAIL_SPEC, POLISH_TURN, SENSORS, stowAngles } from '@/lib/ottoWash/detailArm';
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
  it('wash: home is the entrance end with every tool stowed and both arms docked; a pad goes onto a sensor and turns', () => {
    const home = washAngles('home', 1);
    expect(home.GANTRY).toBeCloseTo(-WASH_HOME_DY * METRES_PER_PLAN_UNIT, 6);
    for (const k of ['DRYER_TOP1', 'DRYER_TOP3', 'DRYER_SIDE_L', 'DARM_L_RAIL', 'DARM_R_RAIL']) expect(home[k]).toBeCloseTo(0, 6);
    expect(home.DARM_L_J2).toBeCloseTo(stowAngles(1).j2, 9);
    expect(home.DARM_R_J1).toBeCloseTo(stowAngles(-1).j1, 9);
    expect(Object.keys(home).filter((k) => /BRUSH|WAND|WIPE/.test(k))).toEqual([]);
    // the "roof lidar" pose: the east arm's pad is on the lidar's front side, and its carriage has left the dock
    const roof = washAngles('wipe_roof', 0.19);
    const tip = forwardTCP({ j1: roof.DARM_L_J1, j2: roof.DARM_L_J2, j3: roof.DARM_L_J3, j4: roof.DARM_L_J4, j5: roof.DARM_L_J5, j6: roof.DARM_L_J6 }, DETAIL_SPEC);
    const sen = SENSORS[1].find((x) => x.id === 'pod_fore')!;
    expect(tip.y + MOUNT_HEIGHT_M).toBeCloseTo(sen.p.y, 6);
    expect(roof.DARM_L_RAIL).toBeGreaterThan(4);
    // and the pad is turning on it, inside its quarter turn each way
    expect(Math.abs(roof.DARM_L_J6)).toBeGreaterThan(0.2);
    expect(Math.abs(roof.DARM_L_J6)).toBeLessThanOrEqual(POLISH_TURN + 1e-9);
    // every preset is inside the arm's joint limits
    for (const p of posePresets('wash_gantry')) for (const s of ['L', 'R']) for (const j of ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'] as const) {
      const v = p.angles[`DARM_${s}_${j.toUpperCase()}`];
      expect(v, `${p.id} ${s} ${j}`).toBeGreaterThanOrEqual(DETAIL_SPEC.limits[j][0] - 1e-9);
      expect(v, `${p.id} ${s} ${j}`).toBeLessThanOrEqual(DETAIL_SPEC.limits[j][1] + 1e-9);
    }
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
  it('clean arm and wash: every step of the twin\'s chain, in order, and the wash program is one motion', async () => {
    const { cycleScript } = await import('./catalog');
    const { CLEAN_CHAIN } = await import('@/lib/ottoCleanArm/cleanArmSpec');
    const { washChain } = await import('@/lib/ottoWash/washSpec');
    expect(cycleScript('clean_arm').steps.map((x) => x.id)).toEqual([...CLEAN_CHAIN]);
    const w = cycleScript('wash_gantry');
    expect(w.steps.map((x) => x.id)).toEqual([...washChain(true)]);
    // the detail arms are out at the roof lidar in that step: both carriages are near the car's middle, 5 m from their docks
    const i = w.steps.findIndex((x) => x.id === 'wipe_roof');
    const at = w.steps.slice(0, i).reduce((a, x) => a + x.seconds, 0) + w.steps[i].seconds * 0.7;
    const v = w.at(at).angles;
    expect(v.DARM_L_RAIL).toBeGreaterThan(4.5);
    expect(v.DARM_R_RAIL).toBeGreaterThan(4.5);
    // and the program is one motion: no joint jumps from the end of a step to the start of the next
    let start = 0;
    for (let k = 0; k + 1 < w.steps.length; k++) {
      start += w.steps[k].seconds;
      const a = w.at(start - 1e-6).angles, b = w.at(start + 1e-6).angles;
      for (const key of Object.keys(a)) expect(Math.abs(a[key] - b[key]), `${w.steps[k].id} -> ${w.steps[k + 1].id}: ${key}`).toBeLessThan(1e-3);
    }
  });
});
