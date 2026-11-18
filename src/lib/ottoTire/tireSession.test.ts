// The tire session: the service bay's machine plays its program inside the twin's seat, only for a tire job, for the
// car's own model, and finishes on the car it started on (otto-q-core 0842, 0843).
import { describe, expect, it } from 'vitest';
import { LIFT } from './tireSpec';
import { tireJobFor, TIRE_VEHICLES } from './tireProgram';
import {
  FINISH_S, IDLE_TIRE, RATE_MAX, WORK_END_MARGIN_S, advanceTireSession, carRise, tireCycleFor, tireLetsCarMove,
  tireStepOf, type TireInput, type TireSession,
} from './tireSession';

const seat = (over: Partial<TireInput> = {}): TireInput => ({
  dt: 0.5, vehicleId: 'car-1', active: true, job: 'replacement', model: 'tesla_model_y', endsInS: 720, sinceS: 0, ...over,
});

/** Run a session through `seconds` of sim time with the seat's clocks moving as the twin's would. */
function play(s: TireSession, seconds: number, base: TireInput, dt = 0.5): { s: TireSession; maxRise: number; steps: Set<string> } {
  let maxRise = 0;
  const steps = new Set<string>();
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    s = advanceTireSession(s, {
      ...base, dt,
      endsInS: base.endsInS != null ? base.endsInS - t - dt : null,
      sinceS: base.sinceS != null ? base.sinceS + t + dt : null,
    });
    maxRise = Math.max(maxRise, carRise(s));
    const st = tireStepOf(s);
    if (st) steps.add(st.id);
  }
  return { s, maxRise, steps };
}

describe('OTTO-TIRE: the session in the yard', () => {
  it('reads the job from the seat\'s work: a replacement before a rotation, nothing for other work', () => {
    expect(tireJobFor(['tire_replacement'])).toBe('replacement');
    expect(tireJobFor(['tire_rotation'])).toBe('rotation');
    expect(tireJobFor(['mechanical_pm', 'tire_rotation'])).toBe('rotation');
    expect(tireJobFor(['tire_replacement', 'tire_rotation'])).toBe('replacement');
    expect(tireJobFor(['fault_repair'])).toBeNull();
    expect(tireJobFor(null)).toBeNull();
  });

  it('stays home for a seat that is not a tire job, or is not on', () => {
    expect(advanceTireSession(IDLE_TIRE, seat({ job: null })).phase).toBe('home');
    expect(advanceTireSession(IDLE_TIRE, seat({ active: false })).phase).toBe('home');
    expect(advanceTireSession(IDLE_TIRE, seat({ vehicleId: null })).phase).toBe('home');
  });

  it('plays the whole replacement inside a 12-minute seat and ends 20 s before it, with the car lifted 0.50 m', () => {
    const c = tireCycleFor('tesla_model_y', 'replacement');
    const start = advanceTireSession(IDLE_TIRE, seat());
    expect(start.phase).toBe('working');
    expect(start.rate).toBeCloseTo(c.total / (720 - WORK_END_MARGIN_S), 9);
    const mid = play(start, 720 - WORK_END_MARGIN_S - 30, seat());
    expect(mid.s.phase).toBe('working');
    expect(mid.maxRise).toBeCloseTo(LIFT.serviceRise, 6);
    const end = play(mid.s, 40, seat({ endsInS: 50, sinceS: 670 }));
    expect(end.s.phase).toBe('home');
    expect(end.s.completedFor).toBe('car-1');
    expect(carRise(end.s)).toBe(0);
    expect(tireLetsCarMove(end.s)).toBe(true);
  });

  it('plays the rotation for a rotation seat: the front wheels wait in the OLD racks while the rear ones move forward', () => {
    const r = play(advanceTireSession(IDLE_TIRE, seat({ job: 'rotation' })), 710, seat({ job: 'rotation' }));
    for (const id of ['f_wait_down', 'rf_mount', 'w_mount']) expect(r.steps.has(id), id).toBe(true);
    expect(r.steps.has('f_new_up')).toBe(false);
    expect(r.s.phase).toBe('home');
  });

  it('plays each model\'s own program', () => {
    for (const v of TIRE_VEHICLES) {
      const s = advanceTireSession(IDLE_TIRE, seat({ model: v.key }));
      expect(tireCycleFor(s.model, 'replacement').vehicle.key).toBe(v.key);
    }
    // a car with no model the yard knows plays the Model Y's
    expect(tireCycleFor('no_such_model', 'rotation').vehicle.key).toBe('tesla_model_y');
  });

  it('joins a seat already under way where the program would be', () => {
    const c = tireCycleFor('tesla_model_y', 'replacement');
    const s = advanceTireSession(IDLE_TIRE, seat({ sinceS: 300, endsInS: 420 }));
    expect(s.rate).toBeCloseTo(c.total / (300 + 420 - WORK_END_MARGIN_S), 9);
    expect(s.t).toBeCloseTo(300 * s.rate, 9);
  });

  it('runs no faster than RATE_MAX times nominal when the seat is short', () => {
    const s = advanceTireSession(IDLE_TIRE, seat({ endsInS: 60 }));
    expect(s.rate).toBe(RATE_MAX);
  });

  it('finishes from wherever it is when the seat ends early, and lowers the car on the way home', () => {
    const mid = play(advanceTireSession(IDLE_TIRE, seat()), 200, seat());
    expect(carRise(mid.s)).toBeGreaterThan(0);
    const f = advanceTireSession(mid.s, seat({ active: false }));
    expect(f.phase).toBe('finishing');
    expect(tireLetsCarMove(f)).toBe(false);
    const done = play(f, FINISH_S + 1, seat({ active: false }));
    expect(done.s.phase).toBe('home');
    expect(carRise(done.s)).toBe(0);
  });

  it('finishes on the car it started on, and does not start again for that car while its seat lasts', () => {
    const mid = play(advanceTireSession(IDLE_TIRE, seat()), 100, seat());
    expect(advanceTireSession(mid.s, seat({ vehicleId: 'car-2' })).phase).toBe('finishing');
    const done = play(advanceTireSession(IDLE_TIRE, seat({ endsInS: 300 })), 400, seat({ endsInS: 300 }));
    expect(done.s.completedFor).toBe('car-1');
    expect(advanceTireSession(done.s, seat({ endsInS: 5, sinceS: 395 })).phase).toBe('home');
    // the next car's seat plays
    expect(advanceTireSession(advanceTireSession(done.s, seat({ vehicleId: null })), seat({ vehicleId: 'car-2' })).phase)
      .toBe('working');
  });
});
