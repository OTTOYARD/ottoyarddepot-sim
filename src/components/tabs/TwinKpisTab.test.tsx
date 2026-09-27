import { afterEach, describe, expect, it, vi } from 'vitest';

// The tab also reads the run's five KPIs from the edge function. Keep that read off the network in a unit
// test: it stays pending, and this test is about the live frame's readings.
vi.mock('@/lib/ottoTwin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ottoTwin')>();
  return { ...actual, twin: { ...actual.twin, kpis: vi.fn(() => new Promise(() => {})) } };
});
import { cleanup, render, screen } from '@testing-library/react';
import { useTwinStore } from '@/store/twinStore';
import type { TwinSnapshot } from '@/lib/ottoTwin';
import { TwinKpisTab } from './TwinKpisTab';

afterEach(() => { cleanup(); useTwinStore.getState().reset(); });

describe('live KPI evidence', () => {
  it('does not report absent grid, solar, or price data as measured zero', () => {
    useTwinStore.setState({
      activeSimRunId: 'run-1',
      snapshot: {
        run: { sim_run_id: 'run-1', tick_count: 0 },
        fleet: { counts: { deployed: 5 }, total: 5, vehicles: [] },
        energy: {}, grid: {}, bess: {}, counters: {},
      } as unknown as TwinSnapshot,
    });
    render(<TwinKpisTab />);
    for (const label of ['Grid Import', 'Solar Output', 'LMP']) {
      expect(screen.getByText(label).parentElement?.textContent).toContain('—');
    }
  });
});
