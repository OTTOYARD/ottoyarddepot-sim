import { afterEach, describe, expect, it, vi } from 'vitest';
import board from './__fixtures__/kpiBoard.fd6ed035.json';

// The tab reads the run's five KPIs from the edge function and the KPI board from the engine. Keep both off the
// network in a unit test: the five stay pending, and the board answers with the capture of run fd6ed035.
const kpiBoard = vi.fn(() => new Promise(() => {}));
vi.mock('@/lib/ottoTwin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ottoTwin')>();
  return { ...actual, twin: { ...actual.twin, kpis: vi.fn(() => new Promise(() => {})), kpiBoard: (...a: unknown[]) => kpiBoard(...(a as [])) } };
});
import { cleanup, render, screen, within } from '@testing-library/react';
import { useTwinStore } from '@/store/twinStore';
import type { TwinSnapshot } from '@/lib/ottoTwin';
import { TwinKpisTab } from './TwinKpisTab';

afterEach(() => { cleanup(); useTwinStore.getState().reset(); kpiBoard.mockReset(); kpiBoard.mockImplementation(() => new Promise(() => {})); });

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

describe('the KPI board', () => {
  it('leads with fleet uptime, then turnaround, charge at departure, on time and cars out', async () => {
    kpiBoard.mockImplementation(() => Promise.resolve(board.board));
    useTwinStore.setState({ activeSimRunId: 'fd6ed035-9341-417e-8266-11055f6a86e6', snapshot: null });
    render(<TwinKpisTab />);
    const hero = await screen.findByTestId('kpi-uptime');
    expect(hero.textContent).toContain('24%');
    expect(hero.textContent).toContain('of fleet time on the road or ready to go');
    expect(screen.getByTestId('kpi-tile-turnaround').textContent).toContain('1 h 57 min');
    expect(screen.getByTestId('kpi-tile-charged').textContent).toContain('118 of 118');
    expect(screen.getByTestId('kpi-tile-on_time').textContent).toContain('75%');
    expect(screen.getByTestId('kpi-tile-out').textContent).toContain('118');
    // where fleet time went: a legend for every part, and the wait in one sentence
    const split = screen.getByTestId('kpi-split');
    expect(within(split).getByRole('list', { name: 'Legend' }).querySelectorAll('li')).toHaveLength(7);
    expect(split.textContent).toMatch(/Cars waited 40% of fleet time: 32% after arrival, 8% between steps\./);
    // energy reads the run's own integrals, and the caption names the run and its window
    const energy = screen.getByTestId('kpi-energy').textContent ?? '';
    expect(energy).toContain('4,364 kWh');
    // the month's demand charge on the depot's own tariff, with the one limit on it said under the card
    expect(energy).toContain('$12,989');
    expect(energy).toContain('The bill uses the highest 30 minutes in the month.');
    expect(screen.getByText(/Run fd6ed035 · busy_day · sim 8:00 AM – 1:50 PM CT · 116 cars/)).toBeTruthy();
    // the five stay on the tab, closed, under the board
    expect(screen.getByText('Engineering KPIs · the five')).toBeTruthy();
  });

  it('says why when a run has no state history, instead of drawing zeros', async () => {
    kpiBoard.mockImplementation(() => Promise.resolve({ ok: false, error: 'no_state_history' }));
    useTwinStore.setState({ activeSimRunId: 'old-run', snapshot: null });
    render(<TwinKpisTab />);
    expect(await screen.findByText(/has no car state history left/)).toBeTruthy();
    expect(screen.queryByTestId('kpi-uptime')).toBeNull();
  });
});
