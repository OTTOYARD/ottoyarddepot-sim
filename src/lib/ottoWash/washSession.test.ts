/**
 * The wash machine's session, driven the way the renderer drives it: a frame at a time from
 * what the twin says. It must play every phase in order and never skip one, be home before
 * the twin's seat ends, finish from wherever it is when the seat ends early, never wash the
 * same car twice, and never move a part in a jump.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceWashSession, IDLE_WASH, JOIN_LATE_S, PULL_IN_S, paceProgram, remainingProgramS, seekProgram, washDoorsAt,
  washLetsCarMove, washPhaseLength, type WashInput, type WashSession,
} from './washSession';
import { washPoseAt, type WashPose } from './washPose';
import {
  INTERIOR_FIXED_S, PASSES_NOMINAL_S, PASS_SCALE_MIN, VACUUM_MIN_S, VACUUM_NOMINAL_S, WASH_END_MARGIN_S,
  WASH_HOME_DY, WASH_PHASE_S, washChain, type WashPhase,
} from './washSpec';

const input = (over: Partial<WashInput>): WashInput => ({
  dt: 0.05, vehicleId: 'car-1', active: true, interior: false, endsInS: null, ...over,
});

/** Run a session; `twin(t)` says what the twin publishes at sim second t. */
function run(seconds: number, dt: number, twin: (t: number) => Partial<WashInput>, start: WashSession = IDLE_WASH) {
  let s = start;
  const trace: { t: number; s: WashSession }[] = [];
  for (let t = 0; t < seconds; t += dt) {
    s = advanceWashSession(s, input({ dt, ...twin(t) }));
    trace.push({ t: t + dt, s });
  }
  return trace;
}

const phasesSeen = (trace: { s: WashSession }[]) => {
  const out: WashPhase[] = [];
  for (const { s } of trace) if (out[out.length - 1] !== s.phase) out.push(s.phase);
  return out;
};

/** The largest frame-to-frame change of any part, plan u (doors and wands as fractions x 4 u). */
function largestJump(trace: { s: WashSession }[]): number {
  let worst = 0;
  let prev: WashPose | null = null;
  for (const { s } of trace) {
    const p = washPoseAt(s);
    if (prev) {
      worst = Math.max(worst,
        Math.abs(p.dy - prev.dy), Math.abs(p.sideBrushX - prev.sideBrushX), Math.abs(p.topBrushY - prev.topBrushY),
        Math.abs(p.dryerTopY - prev.dryerTopY), Math.abs(p.dryerSideX - prev.dryerSideX),
        4 * Math.abs(p.wandDrop - prev.wandDrop), 4 * Math.abs(p.wandReach - prev.wandReach), 4 * Math.abs(p.doors - prev.doors));
    }
    prev = p;
  }
  return worst;
}

describe('the program', () => {
  it('runs six passes over the car, at a nominal 3.6 minutes with the settle and the finish', () => {
    expect(washChain(false)).toEqual(['settle', 'soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2', 'done']);
    expect(PASSES_NOMINAL_S + WASH_PHASE_S.settle + WASH_PHASE_S.done).toBeCloseTo(214.5, 6);
  });

  it('cleans the interior first on a detail seat, doors open and shut, then washes the outside', () => {
    expect(washChain(true)).toEqual([
      'settle', 'to_cabin', 'doors_open', 'wands_down', 'wands_in', 'vacuum', 'wands_out', 'wands_up', 'doors_close',
      'to_start', 'soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2', 'done',
    ]);
    expect(INTERIOR_FIXED_S).toBe(30);
  });

  it('plays every phase in order and is home before a 5-minute robotic wash ends', () => {
    const seat = 300;
    const trace = run(seat, 0.05, (t) => ({ endsInS: seat - t }));
    expect(phasesSeen(trace)).toEqual(['settle', 'soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2', 'done', 'home']);
    const homeAt = trace.find((r) => r.s.phase === 'home')!.t;
    expect(homeAt).toBeLessThanOrEqual(seat - WASH_END_MARGIN_S + 0.5);
    expect(homeAt).toBeGreaterThan(seat - WASH_END_MARGIN_S - 30); // and it uses the seat, it does not idle through it
    expect(largestJump(trace)).toBeLessThan(0.2);
  });

  it('plays the whole detail program and is home before a 16.5-minute detail seat ends', () => {
    const seat = 990;
    const trace = run(seat, 0.05, (t) => ({ endsInS: seat - t, interior: true }));
    expect(phasesSeen(trace)).toEqual([...washChain(true), 'home']);
    const homeAt = trace.find((r) => r.s.phase === 'home')!.t;
    expect(homeAt).toBeLessThanOrEqual(seat - WASH_END_MARGIN_S + 0.5);
    expect(largestJump(trace)).toBeLessThan(0.2);
  });

  it('runs at nominal pace when the twin publishes no end', () => {
    expect(paceProgram(false, null)).toEqual({ passScale: 1, vacuumS: VACUUM_NOMINAL_S });
    expect(paceProgram(true, null)).toEqual({ passScale: 1, vacuumS: VACUUM_NOMINAL_S });
  });

  it('fits every robotic wash and detail seat the twin draws (5.0 min within 15%, 16.5 within 20%)', () => {
    for (const seat of [255, 280, 300, 320, 345]) {
      const { passScale } = paceProgram(false, seat - WASH_PHASE_S.settle);
      expect(WASH_PHASE_S.settle + PASSES_NOMINAL_S * passScale + WASH_PHASE_S.done).toBeLessThanOrEqual(seat - WASH_END_MARGIN_S + 1e-6);
    }
    for (const seat of [792, 900, 990, 1100, 1188]) {
      const { passScale, vacuumS } = paceProgram(true, seat - WASH_PHASE_S.settle);
      expect(passScale).toBe(1);
      expect(WASH_PHASE_S.settle + INTERIOR_FIXED_S + vacuumS + PASSES_NOMINAL_S + WASH_PHASE_S.done)
        .toBeLessThanOrEqual(seat - WASH_END_MARGIN_S + 1e-6);
      expect(vacuumS).toBeGreaterThan(500);
    }
  });

  it('shortens the passes to their floor and keeps the vacuum’s for a short detail seat', () => {
    const { passScale, vacuumS } = paceProgram(true, 120);
    expect(vacuumS).toBe(VACUUM_MIN_S);
    expect(passScale).toBe(PASS_SCALE_MIN);
  });

  it('counts the program still to run', () => {
    const s = { ...IDLE_WASH, phase: 'soak' as WashPhase, phaseElapsed: 0, passScale: 1, interior: false };
    expect(remainingProgramS(s)).toBeCloseTo(PASSES_NOMINAL_S + WASH_PHASE_S.done, 6);
  });
});

describe('the car and the machine', () => {
  it('holds the car from the settle until the machine is home, and opens the doors only for the vacuum', () => {
    const seat = 990;
    const trace = run(seat, 0.1, (t) => ({ endsInS: seat - t, interior: true }));
    for (const { s } of trace) {
      const p = washPoseAt(s);
      expect(washLetsCarMove(s.phase)).toBe(s.phase === 'home' || s.phase === 'done');
      expect(p.stop).toBe(!(s.phase === 'home' || s.phase === 'done'));
      expect(washDoorsAt(s)).toBe(p.doors);
      if (['soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2'].includes(s.phase)) expect(p.doors).toBe(0);
      if (p.wandDrop > 0 || p.wandReach > 0) expect(p.doors).toBe(1);
    }
  });

  it('never washes the same car twice in one seat', () => {
    const trace = run(900, 0.1, () => ({ endsInS: 2000 }));
    const starts = trace.filter((r, i) => r.s.phase === 'settle' && (i === 0 || trace[i - 1].s.phase !== 'settle')).length;
    expect(starts).toBe(1);
    expect(trace[trace.length - 1].s.phase).toBe('home');
    expect(trace[trace.length - 1].s.completedFor).toBe('car-1');
  });

  it('starts again for the next car', () => {
    const first = run(300, 0.1, (t) => ({ endsInS: 300 - t }));
    const next = run(20, 0.1, () => ({ vehicleId: 'car-2', endsInS: 280 }), first[first.length - 1].s);
    expect(next.some((r) => r.s.phase === 'soak' && r.s.vehicleId === 'car-2')).toBe(true);
  });

  it('does not start for a car not parked on the bay’s pose', () => {
    const trace = run(10, 0.1, () => ({ active: false }));
    expect(trace.every((r) => r.s.phase === 'home')).toBe(true);
  });
});

describe('a seat that ends early', () => {
  /** Every phase of both programs, ended at its middle. */
  const cases: { interior: boolean; phase: WashPhase }[] = [
    ...washChain(false).map((phase) => ({ interior: false, phase })),
    ...washChain(true).map((phase) => ({ interior: true, phase })),
  ];

  for (const c of cases) {
    it(`finishes home with the doors shut when it ends in ${c.interior ? 'a detail' : 'a wash'} seat’s ${c.phase}`, () => {
      const seat = c.interior ? 990 : 300;
      // run until the middle of the phase, then end the seat
      let s = IDLE_WASH;
      let t = 0;
      for (; t < seat && !(s.phase === c.phase && s.t >= 0.5); t += 0.05) {
        s = advanceWashSession(s, input({ dt: 0.05, endsInS: seat - t, interior: c.interior }));
      }
      expect(s.phase).toBe(c.phase);
      const after = run(120, 0.05, () => ({ active: false, interior: c.interior }), s);
      const last = after[after.length - 1].s;
      expect(last.phase).toBe('home');
      expect(washPoseAt(last).dy).toBeCloseTo(WASH_HOME_DY, 6);
      // finishing never brushes, sprays or blows again, and never runs a pass
      const working: WashPhase[] = ['soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2', 'to_cabin', 'to_start', 'vacuum', 'wands_in', 'wands_down', 'doors_open', 'settle'];
      for (const { s: f } of after) {
        expect(working).not.toContain(f.phase);
        const p = washPoseAt(f);
        expect(p.spray).toBe('none');
        expect(p.air).toBe(false);
      }
      // and nothing jumped: not at the moment the seat ended, nor after
      expect(largestJump([{ s }, ...after])).toBeLessThan(0.3);
    });
  }

  it('goes home at three times its speed', () => {
    let s = IDLE_WASH;
    for (let t = 0; s.phase !== 'wash_2' || s.t < 0.5; t += 0.05) s = advanceWashSession(s, input({ dt: 0.05, endsInS: 300 - t }));
    const after = run(60, 0.05, () => ({ active: false }), s);
    const homeAt = after.find((r) => r.s.phase === 'home')!.t;
    const ret = after.find((r) => r.s.phase === 'return')!.s;
    expect(homeAt).toBeLessThan(WASH_PHASE_S.retract + washPhaseLength('return', ret) / 3 + 1);
  });
});

describe('a viewer that opens the page mid-seat', () => {
  /** A viewer that watched from the start: the car parks 30 s into its seat. */
  function watched(seat: number, interior: boolean, until: number) {
    let s = IDLE_WASH;
    for (let t = 0; t < until; t += 0.05) {
      const parked = t >= PULL_IN_S;
      s = advanceWashSession(s, input({ dt: 0.05, active: parked, interior, endsInS: seat - t, sinceS: t }));
    }
    return s;
  }

  it('joins a detail seat where the twin has it, and shows what a viewer from the start shows', () => {
    const seat = 990;
    for (const at of [120, 300, 700, 900]) {
      const joined = advanceWashSession(IDLE_WASH, input({ dt: 0.05, interior: true, endsInS: seat - at, sinceS: at }));
      const ref = watched(seat, true, at);
      expect(joined.phase, `at ${at}`).toBe(ref.phase);
      const a = washPoseAt(joined), b = washPoseAt(ref);
      expect(Math.abs(a.dy - b.dy), `at ${at}`).toBeLessThan(0.3);
      expect(Math.abs(a.doors - b.doors)).toBeLessThan(0.05);
    }
  });

  it('joins a wash seat mid-pass and is still home before the seat ends', () => {
    const seat = 300, at = 150;
    const start = advanceWashSession(IDLE_WASH, input({ dt: 0.05, endsInS: seat - at, sinceS: at }));
    expect(['wash_1', 'wash_2', 'rinse']).toContain(start.phase);
    const trace = run(seat - at, 0.05, (t) => ({ endsInS: seat - at - t, sinceS: at + t }), start);
    const homeAt = trace.find((r) => r.s.phase === 'home')!.t;
    expect(homeAt).toBeLessThanOrEqual(seat - at - WASH_END_MARGIN_S + 0.5);
  });

  it('shows the machine home and done for a car whose program is already over', () => {
    const s = advanceWashSession(IDLE_WASH, input({ dt: 0.05, endsInS: 4, sinceS: 296 }));
    expect(s.phase).toBe('home');
    expect(s.completedFor).toBe('car-1');
  });

  it('starts from the settle for a car still pulling in', () => {
    const s = advanceWashSession(IDLE_WASH, input({ dt: 0.05, endsInS: 280, sinceS: JOIN_LATE_S - 10 }));
    expect(s.phase).toBe('settle');
  });

  it('finds the program’s phases where seeking says they are', () => {
    const s = seekProgram('car-1', false, WASH_PHASE_S.settle + 1, 400);
    expect(s?.phase).toBe('soak');
    expect(seekProgram('car-1', false, 10_000, 10)).toBeNull();
  });
});
