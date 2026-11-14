/**
 * The cleaning session, driven the way the renderer drives it: a frame at a time from
 * what the twin says. It must play every phase in order and never skip one, be home
 * with the doors shut when the twin's step ends, come out the way it went in when the
 * step ends early, never clean the same car twice, and never move a joint in a jump.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceCleanSession, cleanSessionJoints, IDLE_CLEAN, paceClean, remainingCycleS, MAX_PACE,
  type CleanSession, type CleanInput,
} from './cleanSession';
import { CLEAN_CHAIN, CLEAN_MOTION_S, CLEAN_SIDE_NOMINAL_S, CLEAN_SIDE_MIN_S, phaseMove, phaseVisit, type CleanPhase } from './cleanArmSpec';
import { cleanProgramFor } from './cleanPrograms';
import { sidesFor, doorsAt, type CleanJoints } from './cleanArmPose';

const sides = sidesFor(1);
const input = (over: Partial<CleanInput>): CleanInput => ({ dt: 0.05, vehicleId: 'car-1', active: true, endsInS: null, sides, ...over });

/** Run a session; `twin(t)` says what the twin publishes at sim second t. */
function run(seconds: number, dt: number, twin: (t: number) => Partial<CleanInput>, start: CleanSession = IDLE_CLEAN) {
  let s = start;
  const trace: { t: number; s: CleanSession }[] = [];
  for (let t = 0; t < seconds; t += dt) {
    s = advanceCleanSession(s, input({ dt, ...twin(t) }));
    trace.push({ t: t + dt, s });
  }
  return trace;
}

const phasesSeen = (trace: { s: CleanSession }[]) => {
  const out: CleanPhase[] = [];
  for (const { s } of trace) if (out[out.length - 1] !== s.phase) out.push(s.phase);
  return out;
};

describe('a full cycle inside the twin’s step', () => {
  it('times its motion at 52 s, the number the spec states', () => {
    expect(CLEAN_MOTION_S).toBe(52);
  });

  it('plays every phase in order, home with the doors shut by the step’s end (5.8 min)', () => {
    const TOTAL = 348;
    const trace = run(TOTAL + 30, 0.05, (t) => ({ active: t < TOTAL + 20, endsInS: Math.max(0, TOTAL - t) }));
    const seen = phasesSeen(trace);
    expect(seen).toEqual([...CLEAN_CHAIN, 'home']);
    const home = trace.find((x) => x.s.phase === 'home')!;
    // home within a second of the end the twin published (one frame per transition is dropped)
    expect(home.t).toBeGreaterThan(TOTAL - 3);
    expect(home.t).toBeLessThan(TOTAL + 1);
    // and the clean phases were sized from the time left: (348 - 52) / 2 = 148 s each, less the frames
    expect(home.s.cleanA).toBeGreaterThan(145);
    expect(home.s.cleanB).toBeGreaterThan(145);
  });

  it('uses the nominal clean when the twin publishes no end time', () => {
    expect(paceClean('clean_a', null)).toBe(CLEAN_SIDE_NOMINAL_S);
  });

  it('hurries, never shortens a clean below its floor, when the step is short', () => {
    expect(paceClean('clean_a', 60)).toBe(CLEAN_SIDE_MIN_S);
    const trace = run(200, 0.05, (t) => ({ active: t < 120, endsInS: Math.max(0, 100 - t) }));
    // the fixed moves speed up to at most MAX_PACE; the whole cycle still plays
    expect(phasesSeen(trace).slice(0, CLEAN_CHAIN.length)).toEqual([...CLEAN_CHAIN]);
    expect(MAX_PACE).toBeLessThanOrEqual(2);
  });
});

describe('never a jump', () => {
  it('takes one phase per call even at a huge time step, so no phase is skipped on screen', () => {
    const trace = run(2000, 8, (t) => ({ endsInS: Math.max(0, 348 - t) }));
    const seen = phasesSeen(trace);
    expect(seen.slice(0, CLEAN_CHAIN.length)).toEqual([...CLEAN_CHAIN]);
  });

  it('moves every joint continuously, frame to frame, through the cycle and its transitions', () => {
    const trace = run(400, 0.05, (t) => ({ active: t < 360, endsInS: Math.max(0, 348 - t) }));
    let prev: CleanJoints | null = null;
    let worst = 0;
    for (const { s } of trace) {
      const q = cleanSessionJoints(s, sides);
      if (prev) {
        const d = Math.max(
          Math.abs(q.t1 - prev.t1), Math.abs(q.t2 - prev.t2), Math.abs(q.foot - prev.foot),
          Math.abs(Math.atan2(Math.sin(q.yaw - prev.yaw), Math.cos(q.yaw - prev.yaw))),
          Math.abs(q.pitch - prev.pitch), Math.abs(q.ext - prev.ext), Math.abs(q.nozzle - prev.nozzle),
        );
        worst = Math.max(worst, d);
      }
      prev = q;
    }
    // 0.05 s frames: nothing moves more than 0.08 (rad or m) between two
    expect(worst).toBeLessThan(0.08);
  });
});

describe('when the twin’s step ends early', () => {
  it('comes straight out of the car and home from mid-clean, and never goes back in', () => {
    const trace = run(200, 0.05, (t) => ({ active: t < 60, endsInS: Math.max(0, 348 - t) }));
    const seen = phasesSeen(trace);
    const cut = seen.indexOf('clean_a');
    expect(seen.slice(cut)).toEqual(['clean_a', 'exit_a', 'ascend_a', 'raise_a', 'return', 'doors_close', 'home']);
    expect(seen).not.toContain('swing_b');
  });

  it('switches into the way out without a jump', () => {
    let s: CleanSession = IDLE_CLEAN;
    for (let t = 0; t < 60; t += 0.05) s = advanceCleanSession(s, input({ endsInS: 348 - t }));
    expect(s.phase).toBe('clean_a');
    const before = cleanSessionJoints(s, sides);
    const after = advanceCleanSession(s, input({ active: false }));
    expect(after.phase).toBe('exit_a');
    const q = cleanSessionJoints(after, sides);
    for (const k of ['t1', 't2', 'foot', 'yaw', 'pitch', 'ext', 'nozzle'] as const) expect(q[k]).toBeCloseTo(before[k], 9);
  });

  it('shuts the doors from where they are when it ends while they open', () => {
    let s: CleanSession = advanceCleanSession(IDLE_CLEAN, input({}));
    for (let i = 0; i < 20; i++) s = advanceCleanSession(s, input({}));
    expect(s.phase).toBe('doors_open');
    const open = doorsAt(s.phase, s.t);
    const after = advanceCleanSession(s, input({ active: false }));
    expect(after.phase).toBe('doors_close');
    expect(doorsAt(after.phase, after.t)).toBeCloseTo(open, 9);
  });

  it('finishes against the car it went into when another car takes the stall', () => {
    const trace = run(150, 0.05, (t) => ({ vehicleId: t < 50 ? 'car-1' : 'car-2', endsInS: 300 - t }));
    const firstHome = trace.findIndex((x, i) => i > 0 && x.s.phase === 'home');
    expect(firstHome).toBeGreaterThan(0);
    for (const x of trace.slice(0, firstHome)) if (x.t > 50) expect(x.s.vehicleId).toBe('car-1');
    // and then it starts on the new car, from home
    expect(trace.slice(firstHome).some((x) => x.s.phase === 'doors_open' && x.s.vehicleId === 'car-2')).toBe(true);
  });
});

describe('the order with the charge arm: the doors open, the charge arm mates, then the arm goes in', () => {
  it('waits at home with the doors open while the charge arm is moving, and goes in once it is latched', () => {
    // the charge arm takes 18.5 s to mate; the doors take 3 s to open
    const trace = run(40, 0.05, (t) => ({ endsInS: 348 - t, mayEnter: t >= 18.5 }));
    const waiting = trace.filter((x) => x.t > 3.2 && x.t < 18.4);
    expect(waiting.length).toBeGreaterThan(200);
    for (const x of waiting) {
      expect(x.s.phase).toBe('doors_open');
      expect(doorsAt(x.s.phase, x.s.t)).toBe(1);
    }
    const left = trace.find((x) => x.s.phase === 'swing_a')!;
    expect(left.t).toBeGreaterThanOrEqual(18.5);
    expect(left.t).toBeLessThan(18.6);
  });

  it('shuts the doors from the wait when the step ends before the charge arm latches', () => {
    const trace = run(30, 0.05, (t) => ({ active: t < 10, endsInS: 348 - t, mayEnter: false }));
    expect(phasesSeen(trace)).toEqual(['doors_open', 'doors_close', 'home']);
  });

  it('reads an absent signal as leave to go in', () => {
    const trace = run(10, 0.05, (t) => ({ endsInS: 348 - t }));
    expect(phasesSeen(trace)).toContain('swing_a');
  });
});

describe('one clean per step', () => {
  it('does not clean the same car again while the twin still calls its step in progress', () => {
    // the twin closes the step a tick (300 s) after the arm is home
    const trace = run(700, 0.05, () => ({ active: true, endsInS: null }));
    const starts = trace.filter((x, i) => x.s.phase === 'doors_open' && (i === 0 || trace[i - 1].s.phase === 'home')).length;
    expect(starts).toBe(1);
    expect(trace[trace.length - 1].s.phase).toBe('home');
    expect(trace[trace.length - 1].s.completedFor).toBe('car-1');
  });

  it('forgets the car once the step closes, so its next visit is cleaned', () => {
    const first = run(450, 0.05, () => ({ endsInS: null }));
    const done = first[first.length - 1].s;
    expect(done.completedFor).toBe('car-1');
    const closed = advanceCleanSession(done, input({ active: false }));
    expect(closed.completedFor).toBeNull();
    const again = advanceCleanSession(closed, input({}));
    expect(again.phase).toBe('doors_open');
  });

  it('counts the time left along the whole chain', () => {
    const s = { ...IDLE_CLEAN, phase: 'doors_open' as CleanPhase, phaseElapsed: 0 };
    expect(remainingCycleS(s)).toBeCloseTo(CLEAN_MOTION_S + 2 * CLEAN_SIDE_NOMINAL_S, 9);
  });
});

// ════════════════════════════════════════════════ THE PORT FLANK, PER OPENING ═══
describe('the port flank per opening: a door opens only for its own opening, and only when its own rule allows', () => {
  const S = sidesFor(-1);
  /** Play a fleet vehicle's program; `ok(t, visit)` says whether that visit's doors may be open at sim second t. */
  function playFleet(model: string, seconds: number, ok: (t: number, visit: number) => boolean, activeUntil = Infinity) {
    const program = cleanProgramFor(model);
    let s: CleanSession = IDLE_CLEAN;
    const trace: { t: number; s: CleanSession }[] = [];
    for (let t = 0; t < seconds; t += 0.25) {
      s = advanceCleanSession(s, {
        dt: 0.25, vehicleId: 'car-1', active: t < activeUntil, endsInS: Math.max(0, 348 - t), sides: S, model,
        portOk: false, portOkAt: program.visits.map((_, i) => ok(t, i)),
      });
      trace.push({ t, s });
    }
    return { program, trace };
  }

  it('the I-PACE: the rear door on the charger\'s side is worked while the front one may not open; the arm then waits there, every door shut', () => {
    const program = cleanProgramFor('waymo_ipace');
    expect(program.visits.map((v) => `${v.flank} ${v.opening}`)).toEqual(['far front door', 'far rear door', 'port rear door', 'port front door']);
    expect(program.flankDoors).toEqual(['FR', 'RR']);
    const front = 3, rear = 2;
    // latched all the way: the rear opening's doors may open, the front one's may not
    const { trace } = playFleet('waymo_ipace', 420, (_, i) => i !== front, 348);
    const seen = phasesSeen(trace);
    expect(seen).toContain('clean_c');
    expect(seen).not.toContain('swing_d');
    for (const { s, t } of trace) {
      const by = s.doorPortBy ?? [0, 0];
      // the front door on the charger's side is never open
      expect(by[0], `front port door at ${t}`).toBe(0);
      // the rear one is open only while the arm is at that opening
      if (by[1] > 0) expect(phaseVisit(s.phase), `rear port door open in ${s.phase}`).toBe(rear);
      expect(s.doorPort ?? 0).toBe(Math.max(...by));
      if (s.waiting) { expect(s.phase).toBe('raise_c'); expect(s.t).toBe(1); }
    }
    // it waited with every door shut, and the home session says the side was done in part
    const waited = trace.filter(({ s }) => s.waiting);
    expect(waited.length).toBeGreaterThan(40);
    expect(waited.slice(13).every(({ s }) => (s.doorPort ?? 0) === 0 && (s.doorFar ?? 0) === 0)).toBe(true);
    const end = trace[trace.length - 1].s;
    expect(end.phase).toBe('home');
    expect(end.portNotDoneFor).toBe('car-1');
    expect(end.portPartDone).toBe(true);
  });

  it('the I-PACE: when the front door may open the arm goes on, opens it alone, and finishes', () => {
    const front = 3;
    const { program, trace } = playFleet('waymo_ipace', 420, (t, i) => i !== front || t >= 250);
    expect(phasesSeen(trace)).toEqual([...program.chain, 'home']);
    const end = trace[trace.length - 1].s;
    expect(end.portNotDoneFor).toBeUndefined();
    for (const { s } of trace) {
      const by = s.doorPortBy ?? [0, 0];
      const move = phaseMove(s.phase);
      // the wand is down at a port opening only with that opening's door fully open
      if (phaseVisit(s.phase) >= 2 && (move === 'descend' || move === 'enter' || move === 'clean' || move === 'exit' || move === 'ascend')) {
        expect(by[phaseVisit(s.phase) === front ? 0 : 1], s.phase).toBe(1);
      }
      // the front door is open only at its own opening, and on the way home from it (it shuts in doors_close)
      if (by[0] > 0) expect(phaseVisit(s.phase) === front || s.phase === 'return' || s.phase === 'doors_close', s.phase).toBe(true);
    }
  });

  it.each(['waymo_ojai', 'zoox_robotaxi'])('%s: with the connector in, only the panel clear of the charge arm opens; both open when the whole opening may', (model) => {
    const { program, trace } = playFleet(model, 420, (t, i) => i !== 2 || t >= 230);
    expect(program.visits.map((v) => [v.flank, v.partial === true, v.doors])).toEqual([['far', false, undefined], ['port', true, ['FR']], ['port', false, ['FR', 'RR']]]);
    expect(phasesSeen(trace)).toEqual([...program.chain, 'home']);
    let both = false;
    for (const { s } of trace) {
      const by = s.doorPortBy ?? [0, 0];
      const vi = phaseVisit(s.phase), move = phaseMove(s.phase);
      // the rear panel (over the inlet) is open only at the whole opening's visit
      if (by[1] > 0) { expect(vi === 2 || s.phase === 'return' || s.phase === 'doors_close', `rear panel open in ${s.phase}`).toBe(true); both = true; }
      const down = move === 'lower' && s.t > 0 || move === 'descend' || move === 'enter' || move === 'clean' || move === 'exit' || move === 'ascend';
      if (vi === 1 && down) expect(by, `${s.phase}: front panel open, rear panel shut`).toEqual([1, 0]);
      if (vi === 2 && (move === 'descend' || move === 'enter' || move === 'clean' || move === 'exit' || move === 'ascend')) expect(by).toEqual([1, 1]);
    }
    expect(both).toBe(true);
  });

  it('a program whose visits name no doors keeps one value for the whole port flank', () => {
    const trace = run(120, 0.25, () => ({ endsInS: null }));
    expect(trace.every(({ s }) => s.doorPortBy === undefined)).toBe(true);
  });
});
