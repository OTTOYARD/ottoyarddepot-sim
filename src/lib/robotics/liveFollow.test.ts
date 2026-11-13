// liveFollow.test.ts — a followed robot's model pose is the yard's own pose code, in the model's frame.
import { headIK } from '@/lib/ottoChargeArm/mateSolver';
import { describe, expect, it } from 'vitest';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { FLANK_STANDOFF_M, MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import { portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { IDLE_SESSION } from '@/lib/ottoChargeArm/roboticService';
import { CAR_WIDTH_M } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { IDLE_CLEAN } from '@/lib/ottoCleanArm/cleanSession';
import { IDLE_WASH } from '@/lib/ottoWash/washSession';
import { SAMPLE_PORT, cycleScript, cycleSteps, posePresets } from './catalog';
import {
  MODEL_TOWARD, chargeLiveAngles, cleanLiveAngles, followLine, isAtRest, liveUnit, phaseLabel, sortUnits, unitLabel, washLiveAngles,
} from './liveFollow';

const close = (a: Record<string, number>, b: Record<string, number>) => {
  expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b)) expect(a[k], k).toBeCloseTo(b[k], 9);
};
const preset = (robot: Parameters<typeof posePresets>[0], id: string) => posePresets(robot).find((p) => p.id === id)!.angles;

describe('the model frame', () => {
  it('is the frame the tab\'s own presets and cycle are drawn in', () => {
    const p = portInArmFrame(SAMPLE_PORT.along, SAMPLE_PORT.height, CAR_WIDTH_M / 2, MODEL_TOWARD);
    expect(p.x).toBeCloseTo(SAMPLE_PORT.along, 9);
    expect(p.y).toBeCloseTo(SAMPLE_PORT.height - MOUNT_HEIGHT_M, 9);
    expect(p.z).toBeCloseTo(FLANK_STANDOFF_M, 9);
  });
});

describe('the charge arm', () => {
  it('at rest, or with no car\'s port known, reads the stowed preset', () => {
    close(chargeLiveAngles(IDLE_SESSION, SAMPLE_PORT), preset('charge_arm', 'stowed'));
    close(chargeLiveAngles({ phase: 'charging', t: 1 }, null), preset('charge_arm', 'stowed'));
  });

  it('while it charges the sample port, reads the connected preset', () => {
    close(chargeLiveAngles({ phase: 'charging', t: 1 }, SAMPLE_PORT), preset('charge_arm', 'connected'));
  });

  it('through every phase, is the cycle the tab plays for the same port', () => {
    const script = cycleScript('charge_arm');
    let t0 = 0;
    for (const step of script.steps) {
      for (const u of [0, 0.37, 1]) {
        const live = chargeLiveAngles({ phase: step.id as never, t: u }, SAMPLE_PORT);
        const at = script.at(Math.min(t0 + u * step.seconds, t0 + step.seconds - 1e-9));
        if (u < 1) close(live, at.angles);
        else expect(Object.values(live).every(Number.isFinite)).toBe(true);
      }
      t0 += step.seconds;
    }
  });

  it('reaches to its own car\'s port, not to the sample', () => {
    const high = chargeLiveAngles({ phase: 'charging', t: 1 }, { along: 1.4, height: 0.95 });
    // the head's CCS1 connector on that port: the tool axis stands beside it (mateSolver.headIK)
    const own = headIK(portInArmFrame(1.4, 0.95, CAR_WIDTH_M / 2, MODEL_TOWARD), { x: 0, y: 0, z: -1 }, 'CCS1').ik;
    expect(high.J1).toBeCloseTo(own.j1, 9);
    expect(high.J2).toBeCloseTo(own.j2, 9);
    expect(high.J2).not.toBeCloseTo(preset('charge_arm', 'connected').J2, 3);
  });
});

describe('the cleaning arm and the wash machine', () => {
  it('at home read their home presets', () => {
    close(cleanLiveAngles(IDLE_CLEAN), preset('clean_arm', 'home'));
    close(washLiveAngles(IDLE_WASH), preset('wash_gantry', 'home'));
  });

  it('mid-cycle read the pose the tab\'s cycle plays for that phase', () => {
    close(cleanLiveAngles({ ...IDLE_CLEAN, phase: 'clean_a', t: 0.35, vehicleId: 'v1' }), preset('clean_arm', 'clean'));
    close(washLiveAngles({ ...IDLE_WASH, phase: 'wash_1', t: 0.5, vehicleId: 'v1' }), preset('wash_gantry', 'jet'));
  });
});

describe('the words', () => {
  it('names a phase as the step list does, and rest as rest', () => {
    for (const robot of ['charge_arm', 'clean_arm', 'wash_gantry'] as const) {
      for (const s of cycleSteps(robot)) if (!isAtRest(robot, s.id)) expect(phaseLabel(robot, s.id)).toBe(s.label);
    }
    expect(phaseLabel('charge_arm', 'stowed')).toBe('Stowed');
    expect(phaseLabel('charge_arm', 'clear')).toBe('Stowed');
    expect(phaseLabel('clean_arm', 'home')).toBe('Home');
    expect(phaseLabel('wash_gantry', 'some_new_phase')).toBe('some new phase');
  });

  it('names a unit from its id', () => {
    expect(unitLabel('charge_arm', 'dcfc-7')).toBe('Fast charger 07');
    expect(unitLabel('clean_arm', 'A-12')).toBe('Fast charger 12');
    expect(unitLabel('wash_gantry', 'wash-02')).toBe('Wash bay 02');
    expect(unitLabel('wash_gantry', 'bay')).toBe('Wash bay bay');
  });

  it('lists the robots that work first, and says what the followed one does', () => {
    const name = (id: string) => (id === 'v1' ? 'Waymo-AV-012' : null);
    const units = sortUnits([
      liveUnit('charge_arm', 'dcfc-03', IDLE_SESSION, name),
      liveUnit('charge_arm', 'dcfc-09', { phase: 'align', vehicleId: 'v1' }, name),
      liveUnit('charge_arm', 'dcfc-01', { phase: 'charging', vehicleId: 'v2' }, name),
    ]);
    expect(units.map((u) => u.id)).toEqual(['dcfc-01', 'dcfc-09', 'dcfc-03']);
    expect(followLine(units[1])).toBe('Fast charger 09: Align with the cameras · Waymo-AV-012');
    expect(followLine(units[0])).toBe('Fast charger 01: Charge');
    expect(followLine(units[2])).toBe('Fast charger 03: Stowed');
  });
});
