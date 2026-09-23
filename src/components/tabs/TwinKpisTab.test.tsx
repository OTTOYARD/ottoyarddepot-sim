import { afterEach, describe, expect, it } from 'vitest';
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
