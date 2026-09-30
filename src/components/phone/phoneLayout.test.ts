import { describe, it, expect } from 'vitest';
import { depotClock, isPhoneViewport, phoneTelemetry, runPhase, settleSheet, sheetHeights } from './phoneLayout';
import type { TwinSnapshot } from '@/lib/ottoTwin';

describe('phone cockpit — who gets it', () => {
  const v = (width: number, height: number, coarse: boolean, forced = false) => ({ width, height, coarse, forced });

  it('every desktop window keeps the desktop cockpit', () => {
    expect(isPhoneViewport(v(1440, 900, false))).toBe(false);
    expect(isPhoneViewport(v(1200, 700, false))).toBe(false);
    expect(isPhoneViewport(v(920, 500, false))).toBe(false); // a narrow desktop window, not a phone
  });

  it('phones get it in both orientations, including a 932 px landscape Pro Max', () => {
    expect(isPhoneViewport(v(932, 430, true))).toBe(true);
    expect(isPhoneViewport(v(430, 932, true))).toBe(true);
    expect(isPhoneViewport(v(844, 390, true))).toBe(true);
  });

  it('a landscape tablet keeps the desktop cockpit; anything under 900 px wide gets the phone one', () => {
    expect(isPhoneViewport(v(1180, 820, true))).toBe(false);
    expect(isPhoneViewport(v(820, 1180, true))).toBe(true);
  });

  it('?phone=1 forces it anywhere', () => {
    expect(isPhoneViewport(v(1440, 900, false, true))).toBe(true);
  });
});

describe('phone cockpit — the panel sheet', () => {
  const H = sheetHeights(390, 56, 48);

  it('peek < half < full, and full stops below the run bar', () => {
    expect(H.peek).toBe(56);
    expect(H.half).toBeGreaterThan(H.peek);
    expect(H.full).toBeGreaterThan(H.half);
    expect(H.full).toBe(390 - 48 - 8);
  });

  it('a slow release settles on the nearest snap', () => {
    expect(settleSheet(60, 0, H)).toBe('peek');
    expect(settleSheet(H.half - 20, 0.1, H)).toBe('half');
    expect(settleSheet(H.full - 10, -0.2, H)).toBe('full');
  });

  it('a fling moves one snap in its direction, even from near the one it left', () => {
    expect(settleSheet(H.peek + 10, 1.2, H)).toBe('half');
    expect(settleSheet(H.half + 5, 1.2, H)).toBe('full');
    expect(settleSheet(H.half - 5, -1.2, H)).toBe('peek');
    expect(settleSheet(H.full, 2, H)).toBe('full');
    expect(settleSheet(H.peek, -2, H)).toBe('peek');
  });

  it('a very short stage still has room for the tab row', () => {
    const s = sheetHeights(120, 56, 48);
    expect(s.full).toBeGreaterThanOrEqual(56);
    expect(s.half).toBeLessThanOrEqual(s.full);
  });
});

describe('phone cockpit — the run bar reads the run honestly', () => {
  const snap = (over: Partial<TwinSnapshot['run']> = {}, counts?: Record<string, number>) => ({
    run: { sim_run_id: 'r1', scenario: 'busy_day', status: 'running', sim_clock: '2026-09-22T13:09:00Z', tick_count: 5, time_scale: 60, seed: 1, ...over },
    fleet: counts ? { counts, total: 0, vehicles: [] } : undefined,
    stalls_status: [],
  } as unknown as TwinSnapshot);

  it('clock in CT, 24 h', () => {
    expect(depotClock('2026-09-22T13:09:00Z')).toBe('08:09');
    expect(depotClock(undefined)).toBe('--:--');
    expect(depotClock('not a date')).toBe('--:--');
  });

  it('status follows the ADOPTED run only', () => {
    expect(runPhase(null, null, true)).toBe('no-run');
    expect(runPhase(null, null, false)).toBe('offline');
    expect(runPhase(snap(), 'r1', true)).toBe('running');
    expect(runPhase(snap({ status: 'paused' }), 'r1', true)).toBe('paused');
    expect(runPhase(snap({ status: 'completed' }), 'r1', true)).toBe('ended');
  });

  it('telemetry derives like the desktop header, and a missing frame reads "—" not 0', () => {
    const t = phoneTelemetry(snap({}, { deployed: 70, charging_dcfc: 8, charging_l2: 12, staged_awaiting_service: 3, arrived_at_gate: 1, staged_for_departure: 9 }));
    const by = Object.fromEntries(t.map((c) => [c.key, c.value]));
    expect(by).toMatchObject({ deployed: '70', charging: '20', waiting: '4', ready: '9' });
    const empty = Object.fromEntries(phoneTelemetry(null).map((c) => [c.key, c.value]));
    expect(Object.values(empty).every((x) => x === '—')).toBe(true);
  });
});
