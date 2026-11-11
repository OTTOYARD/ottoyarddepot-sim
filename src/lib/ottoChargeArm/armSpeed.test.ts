// armSpeed.test.ts — the drawn charge arm keeps to its cycle at every speed the yard plays at.
//
// Chase, 2026-11-11: "if 3x is selected, robots, cars, etc should move that quickly. Same with 5x, or 8x, or 1x."
// The arm's cycle runs on the sim clock. What is DRAWN chases the solved pose through a servo limit, and that limit
// counted real seconds, so above about 4x the drawn arm trailed its cycle. servoDt counts depot seconds.
import { describe, expect, it } from 'vitest';
import { MAX_JOINT_RATE, MAX_SERVO_FRAME_S, poseFor, servoDt, slewAngles, type ArmTarget } from './armMotion';
import { STOWED } from './cobotIK';
import { portInArmFrame } from './depotPlacement';
import { MATE_CHAIN, phaseDuration } from './roboticService';
import { CAR_WIDTH_M } from './vehicleEnvelope';

const TARGET: ArmTarget = { port: portInArmFrame(1.2, 0.8, CAR_WIDTH_M / 2, 1), normal: { x: 0, y: 0, z: -1 } };
const KEYS = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'] as const;

/** Play the connect at `speed` on a 60 fps screen. Returns the worst lag (rad) of a drawn joint behind its solved pose. */
function playConnect(speed: number, dtOf: (frame: number) => number): { worstLag: number; endLag: number; realSeconds: number } {
  const frame = 1 / 60;
  let shown = { ...STOWED };
  let worstLag = 0, endLag = 0, real = 0;
  for (const phase of MATE_CHAIN) {
    const len = phaseDuration(phase);
    for (let sim = 0; sim < len; sim += frame * speed) {
      const want = poseFor({ phase, t: Math.min(1, (sim + frame * speed) / len) }, TARGET).angles;
      shown = slewAngles(shown, want, dtOf(frame));
      endLag = Math.max(...KEYS.map((k) => Math.abs(want[k] - shown[k])));
      worstLag = Math.max(worstLag, endLag);
      real += frame;
    }
  }
  return { worstLag, endLag, realSeconds: real };
}

describe('servoDt', () => {
  it('is the frame at 1x and N frames of travel at Nx', () => {
    expect(servoDt(1 / 60, 1)).toBeCloseTo(1 / 60, 12);
    for (const x of [2, 3, 5, 8]) expect(servoDt(1 / 60, x)).toBeCloseTo(x / 60, 12);
  });

  it('never counts a stalled frame as more than its cap, and never runs backward or slower than 1x', () => {
    expect(servoDt(5, 1)).toBe(MAX_SERVO_FRAME_S);
    expect(servoDt(5, 8)).toBeCloseTo(MAX_SERVO_FRAME_S * 8, 12);
    expect(servoDt(-1, 3)).toBe(0);
    expect(servoDt(NaN, 3)).toBe(0);
    expect(servoDt(1 / 60, 0.25)).toBeCloseTo(1 / 60, 12);
    expect(servoDt(1 / 60, NaN)).toBeCloseTo(1 / 60, 12);
  });
});

describe('the drawn arm through a connect', () => {
  const mateS = MATE_CHAIN.reduce((a, p) => a + phaseDuration(p), 0);

  it.each([1, 2, 3, 5, 8])('at %ix takes 1/%i of the real time and ends on the solved pose', (x) => {
    const r = playConnect(x, (f) => servoDt(f, x));
    expect(r.realSeconds).toBeGreaterThan(mateS / x - 0.2);
    expect(r.realSeconds).toBeLessThan(mateS / x + 0.2);
    expect(r.endLag).toBeLessThan(1e-6);
  });

  it('lags no more at 8x than at 1x, in joint travel per frame of the cycle', () => {
    const at1 = playConnect(1, (f) => servoDt(f, 1));
    const at8 = playConnect(8, (f) => servoDt(f, 8));
    // one frame of the cycle is 8 times as much motion at 8x: the limit grows by the same 8
    expect(at8.worstLag).toBeLessThanOrEqual(at1.worstLag * 8 + 1e-9);
    expect(at8.worstLag).toBeLessThan(MAX_JOINT_RATE * (8 / 60));
  });

  it('counted in real seconds, the same limit left the arm behind at 8x (the defect)', () => {
    const real = playConnect(8, (f) => f);
    const depot = playConnect(8, (f) => servoDt(f, 8));
    expect(real.worstLag).toBeGreaterThan(depot.worstLag);
  });
});
