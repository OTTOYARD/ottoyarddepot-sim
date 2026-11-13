// mateSequence.test.ts — the order of a mate: the base moves only with the arm folded or holding its standoff
// pose, the cross-slide is in only while the arm is at the inlet, a connector is forward only there, and a release
// goes home through the same stops.
import { describe, expect, it } from 'vitest';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { mateTarget } from '@/lib/fleetModels/ports';
import { poseFor } from './armMotion';
import type { ArmPhase } from './armStateMachine';
import { STOWED, type JointAngles } from './cobotIK';
import { ARM_REACH, solveMate } from './mateSolver';
import { newMateSeq, stepMateSeq } from './mateSequence';
import type { ArmMate } from './vehiclePort';

const gap = (x: JointAngles, y: JointAngles) => Math.max(...(['j1', 'j2', 'j3', 'j4', 'j5'] as const).map((k) => Math.abs(x[k] - y[k])));
function mateOf(key: string, toward: 1 | -1): ArmMate {
  const mate = solveMate(mateTarget(FLEET_SPECS.find((s) => s.key === key)!)!, toward === 1);
  return { mate, target: { port: mate.axisPort, normal: mate.normal }, j6: mate.ik?.j6 ?? 0 };
}

describe.each([['tesla_cybercab', 1], ['tesla_cybercab', -1], ['waymo_ojai', -1], ['zoox_robotaxi', 1]] as const)('%s, stall facing %i', (key, toward) => {
  const m = mateOf(key, toward);
  const standoff = { ...poseFor({ phase: 'approach', t: 1 }, m.target).angles, j6: m.j6 };

  it('goes out and comes home in order', () => {
    expect(m.mate.ok).toBe(true);
    const s = newMateSeq();
    const dt = 0.05;
    let sawMate = false;
    const run = (phase: ArmPhase, seconds: number) => {
      for (let i = 0; i < seconds / dt; i++) {
        const before = { slide: s.slide, cross: s.cross };
        stepMateSeq(s, phase, 1, m.target, m, dt);
        const moved = Math.abs(s.slide - before.slide) > 1e-9 || Math.abs(s.cross - before.cross) > 1e-9;
        // the base moves only with the arm folded or at its standoff pose, and both connectors back
        if (moved) {
          expect(Math.min(gap(s.shown, STOWED), gap(s.shown, standoff)), `${phase}: the base moved with the arm in motion`).toBeLessThan(0.2);
          expect(s.ccs + s.nacs).toBeLessThan(0.01);
        }
        // the carriage runs the rail only with the cross-slide out
        if (Math.abs(s.slide - before.slide) > 1e-9) expect(Math.abs(s.cross)).toBeLessThan(0.005);
        // a connector is forward only at the mate
        if (s.ccs + s.nacs > 0.01) {
          expect(s.slide).toBeCloseTo(m.mate.slideM, 6);
          expect(s.cross).toBeCloseTo(m.mate.crossM, 6);
        }
        if (s.stop === 4) sawMate = true;
      }
    };
    run('unstow', 12);
    expect(s.stop).toBe(2);
    expect(s.slide).toBeCloseTo(m.mate.unfoldSlideM, 6);
    run('charging', 20);
    expect(sawMate).toBe(true);
    expect(s.slide).toBeCloseTo(m.mate.slideM, 6);
    expect(s.cross).toBeCloseTo(m.mate.crossM, 6);
    expect(m.mate.head === 'CCS1' ? s.ccs : s.nacs).toBeCloseTo(ARM_REACH.headStrokeM, 6);
    expect(m.mate.head === 'CCS1' ? s.nacs : s.ccs).toBe(0);
    run('retract', 20);
    expect(s.stop).toBe(2);
    expect(s.cross).toBe(0);
    run('stowed', 20);
    expect(s.stop).toBe(0);
    expect(s.slide).toBe(0);
    expect(gap(s.shown, STOWED)).toBeLessThan(1e-6);
  });
});

describe('a mate the solver refuses, and a car with no port from the twin', () => {
  it('a left-port car at a right-arm post moves nothing', () => {
    const m = mateOf('waymo_ojai', 1);
    expect(m.mate.ok).toBe(false);
    const s = newMateSeq();
    for (let i = 0; i < 200; i++) expect(stepMateSeq(s, 'charging', 1, m.target, m, 0.05).ok).toBe(false);
    expect([s.slide, s.cross, s.ccs, s.nacs, s.stop]).toEqual([0, 0, 0, 0, 0]);
    expect(gap(s.shown, STOWED)).toBe(0);
  });
  it('with no port from the twin, the arm works from the stall\'s middle', () => {
    const target = { port: { x: 0.7, y: -0.1, z: 0.9 }, normal: { x: 0, y: 0, z: -1 } };
    const s = newMateSeq();
    for (let i = 0; i < 400; i++) stepMateSeq(s, 'charging', 1, target, null, 0.05);
    expect([s.slide, s.cross, s.stop]).toEqual([0, 0, 0]);
    expect(gap(s.shown, poseFor({ phase: 'charging', t: 1 }, target).angles)).toBeLessThan(1e-6);
  });
});

describe('a release on the session\'s own clock', () => {
  // The car may move when the session reads stowed (armStateMachine.vehicleMayMove). By then the drawn machine has
  // the connector back, the cross-slide out and the arm folded, on the longest release there is (the Cybercab's).
  it.each([['tesla_cybercab', 1], ['tesla_cybercab', -1], ['lucid_gravity_nuro', -1]] as const)('%s, stall facing %i: folded by the time the car may move', async (key, toward) => {
    const { PHASE_SECONDS } = await import('./armStateMachine');
    const m = mateOf(key, toward);
    const s = newMateSeq();
    const dt = 1 / 30;
    for (let i = 0; i < 40 / dt; i++) stepMateSeq(s, 'charging', 1, m.target, m, dt);
    expect(s.stop).toBe(4);
    for (const phase of ['unlatch', 'extract', 'retract'] as const) {
      const n = Math.round(PHASE_SECONDS[phase] / dt);
      for (let i = 1; i <= n; i++) stepMateSeq(s, phase, i / n, m.target, m, dt);
    }
    expect(s.ccs + s.nacs).toBe(0);
    expect(s.cross).toBe(0);
    expect(s.stop).toBe(2);
    expect(gap(s.shown, STOWED), 'the arm is folded').toBeLessThan(0.1);
  });
});
