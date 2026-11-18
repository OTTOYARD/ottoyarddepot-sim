// The tire gate: one session per service bay, the car held while its bay's machine is out, and the lift's rise
// published for the renderer (otto-q-core 0842, 0843).
import { describe, expect, it } from 'vitest';
import { LIFT } from '@/lib/ottoTire/tireSpec';
import { TireGate, type TireBayInput } from './tireGate';

const bay = (over: Partial<TireBayInput> = {}): TireBayInput => ({
  bayId: 'SVC-01', vehicleId: 'car-1', active: true, job: 'rotation', model: 'tesla_model_y', endsInS: 720, sinceS: 0, ...over,
});

describe('OTTO-TIRE: the gate in the motion driver', () => {
  it('holds the car while the machine works and lets it go when the machine is home', () => {
    const g = new TireGate();
    g.step(1, [bay()]);
    expect(g.mayMove('SVC-01')).toBe(false);
    expect(g.holding()).toEqual(['SVC-01']);
    // a bay with no session never holds
    expect(g.mayMove('SVC-02')).toBe(true);
    let since = 1;
    for (; since < 720; since += 10) g.step(10, [bay({ sinceS: since + 10, endsInS: 720 - since - 10 })]);
    expect(g.session('SVC-01')!.phase).toBe('home');
    expect(g.mayMove('SVC-01')).toBe(true);
  });

  it('plays a frame of several seconds in small steps, so a slow frame loses the machine no time', () => {
    const a = new TireGate(), b = new TireGate();
    a.step(0.5, [bay()]);
    b.step(0.5, [bay()]);
    for (let i = 1; i <= 20; i++) a.step(0.5, [bay({ sinceS: 0.5 + i * 0.5, endsInS: 720 - 0.5 - i * 0.5 })]);
    b.step(10, [bay({ sinceS: 10.5, endsInS: 709.5 })]);
    expect(b.session('SVC-01')!.t).toBeCloseTo(a.session('SVC-01')!.t, 6);
  });

  it('publishes the car\'s rise while it is on the lift, and none for a seat that is not a tire job', () => {
    const g = new TireGate();
    g.step(0.5, [bay()]);
    for (let s = 0.5; s < 200; s += 5) g.step(5, [bay({ sinceS: s + 5, endsInS: 720 - s - 5 })]);
    const lifts = g.lifts();
    expect(lifts).toHaveLength(1);
    expect(lifts[0][0]).toBe('car-1');
    expect(lifts[0][1]).toBeCloseTo(LIFT.serviceRise, 6);
    const other = new TireGate();
    other.step(5, [bay({ job: null })]);
    expect(other.lifts()).toEqual([]);
    expect(other.mayMove('SVC-01')).toBe(true);
  });

  it('sends a machine home when its bay is no longer reported', () => {
    const g = new TireGate();
    g.step(0.5, [bay()]);
    g.step(100, [bay({ sinceS: 30, endsInS: 690 })]);
    g.step(1, []);
    expect(g.session('SVC-01')!.phase).toBe('finishing');
    for (let i = 0; i < 4; i++) g.step(5, []);
    expect(g.session('SVC-01')!.phase).toBe('home');
    expect(g.lifts()).toEqual([]);
  });
});
