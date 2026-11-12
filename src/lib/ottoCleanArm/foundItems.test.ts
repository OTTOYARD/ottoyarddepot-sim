// foundItems.test.ts — the cleaning arm stands still for an item in the cabin for exactly as long as the twin says.
import { describe, expect, it } from 'vitest';
import { itemWords, securedByWords, stopFor, stopWindow, type FoundItem } from './foundItems';
import { advanceCleanSession, cleanStatusColor, IDLE_CLEAN, type CleanSession } from './cleanSession';
import { sidesFor } from './cleanArmPose';

// the shape public.ottoq_cabin_found_items_feed returns (otto-q-core 0814), with the values its own self-test measured
const item = (over: Partial<FoundItem> = {}): FoundItem => ({
  item_key: 'k1', item_kind: 'umbrella', status: 'awaiting_attendant', stall_id: 's1', stall_code: 'NASH-DCFC-STALL-02',
  vehicle_id: 'v1', vehicle_name: 'Waymo-AV-012', found_at: '2026-11-11T14:34:55.6+00:00',
  attendant_due_at: '2026-11-11T14:36:04.4+00:00', secured_at: null, secured_by: null, pause_seconds: null, ...over,
});
const at = (iso: string) => Date.parse(iso);

describe('the stop window', () => {
  it('runs from the find to the attendant\'s due time while nobody has secured the item', () => {
    expect(stopWindow(item())).toEqual({ fromMs: at('2026-11-11T14:34:55.6+00:00'), untilMs: at('2026-11-11T14:36:04.4+00:00') });
  });
  it('ends at the securing when a person confirms sooner', () => {
    const w = stopWindow(item({ status: 'secured', secured_at: '2026-11-11T14:35:05.6+00:00', secured_by: 'depot_attendant' }))!;
    expect((w.untilMs - w.fromMs) / 1000).toBeCloseTo(10, 6);
  });
  it('is nothing when a time is missing', () => {
    expect(stopWindow(item({ found_at: '' }))).toBeNull();
  });
});

describe('does this car\'s arm stand still now', () => {
  const items = [item(), item({ item_key: 'k2', vehicle_id: 'v2' })];
  it('not before the arm reaches the item, and not after it is secured', () => {
    expect(stopFor(items, 'v1', at('2026-11-11T14:34:55+00:00'))).toBeNull();
    expect(stopFor(items, 'v1', at('2026-11-11T14:36:04.4+00:00'))).toBeNull();
    expect(stopFor(items, 'v9', at('2026-11-11T14:35:30+00:00'))).toBeNull();
    expect(stopFor(items, 'v1', NaN)).toBeNull();
  });
  it('yes in between, with the seconds left', () => {
    const s = stopFor(items, 'v1', at('2026-11-11T14:35:04.4+00:00'))!;
    expect(s.item.item_key).toBe('k1');
    expect(s.remainingS).toBeCloseTo(60, 6);
  });
});

describe('the arm\'s session', () => {
  const sides = sidesFor(1);
  const working: CleanSession = { ...IDLE_CLEAN, phase: 'clean_a', phaseElapsed: 40, t: 0.27, vehicleId: 'v1', cleanA: 150, cleanB: 150 };
  const step = (s: CleanSession, heldS: number, active = true) =>
    advanceCleanSession(s, { dt: 0.25, vehicleId: 'v1', active, endsInS: 200, sides, heldS });

  it('keeps its pose, to the joint, while the stop lasts', () => {
    let s = working;
    for (let i = 0; i < 40; i++) s = step(s, 60 - i * 0.25);
    expect(s.held).toBe(true);
    expect(s.phase).toBe('clean_a');
    expect(s.phaseElapsed).toBe(40);
    expect(s.t).toBeCloseTo(40 / 150, 9);
  });
  it('goes on from where it stopped when the item is secured', () => {
    const stopped = step(working, 5);
    const on = step(stopped, 0);
    expect(on.held).toBeFalsy();
    expect(on.phaseElapsed).toBeGreaterThan(40);
  });
  it('does not stop on its way home: a car that left is let go at once', () => {
    const leaving = step(working, 30, false);
    expect(leaving.finishing).toBe(true);
    expect(step(leaving, 30, false).held).toBeFalsy();
  });
  it('shows its own light while it is stopped', () => {
    expect(cleanStatusColor({ phase: 'clean_a', finishing: false, held: true })).toBe(0xff5ea8);
    expect(cleanStatusColor({ phase: 'clean_a', finishing: false })).toBe(0x35d07f);
    expect(cleanStatusColor({ phase: 'home', finishing: false, held: true })).toBe(0x00e5ff);
  });
});

describe('the words', () => {
  it('names the item and who secured it', () => {
    expect(itemWords('wallet')).toBe('a wallet');
    expect(itemWords('keys')).toBe('keys');
    expect(itemWords('something new')).toBe('an item');
    expect(securedByWords('twin_attendant')).toBe("the twin's attendant");
    expect(securedByWords('depot_attendant')).toBe('an attendant');
    expect(securedByWords(null)).toBe('not yet secured');
  });
});
