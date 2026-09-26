import { afterEach, describe, expect, it, vi } from 'vitest';

// ottoq_twin_run_list counts only the newest runs and sends `counters: null` for the rest. Stop lands the operator
// on this tab, and reading a field of that null threw on every render (found stopping run 317d4331, 2026-09-26).
const runs = [
  {
    sim_run_id: 'aaaaaaaa-0000-0000-0000-000000000001', scenario: 'busy_day', status: 'completed',
    started_at: '2026-09-26T04:14:11Z', ended_at: '2026-09-26T04:48:34Z', sim_clock_start: null, sim_clock_current: null,
    tick_count: 400, time_scale: 60, seed: 1, sim_minutes: 215,
    counters: { dispatches_total: 138, dispatches_active: 0, telemetry_packets: 13686, events_total: 22460,
                incidents_open: 0, incidents_total: 0, faults: 20, charge_sessions: 104 },
    variability: null,
  },
  {
    sim_run_id: 'bbbbbbbb-0000-0000-0000-000000000002', scenario: 'busy_day', status: 'completed',
    started_at: '2026-09-25T19:12:00Z', ended_at: '2026-09-25T20:00:00Z', sim_clock_start: null, sim_clock_current: null,
    tick_count: 506, time_scale: 60, seed: 2, sim_minutes: 154,
    counters: null,
    variability: null,
  },
];

vi.mock('@/lib/ottoTwin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ottoTwin')>();
  return { ...actual, twin: { ...actual.twin, runs: vi.fn(() => Promise.resolve({ runs })) } };
});
import { cleanup, render, screen } from '@testing-library/react';
import { TwinHistoryTab } from './TwinHistoryTab';

afterEach(() => { cleanup(); });

describe('run history', () => {
  it('lists a run the ledger did not count, with a dash instead of a crash or a zero', async () => {
    render(<TwinHistoryTab />);
    expect(await screen.findByText('2 runs')).toBeTruthy();
    // the counted run shows its numbers
    expect(screen.getByText('138')).toBeTruthy();
    expect(screen.getByText('104')).toBeTruthy();
    // the uncounted run shows a dash for both of its counters, not 0
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('marks a counter that hit the row guard as a floor', async () => {
    const capped = { ...runs[0], sim_run_id: 'cccccccc-0000-0000-0000-000000000003',
                     counters: { ...runs[0].counters!, dispatches_total: 200000 }, counters_capped: ['dispatches_total'] };
    const { twin } = await import('@/lib/ottoTwin');
    vi.mocked(twin.runs).mockResolvedValueOnce({ runs: [capped] } as never);
    render(<TwinHistoryTab />);
    expect(await screen.findByText('200000+')).toBeTruthy();
  });
});
