import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// No network: the start (a write) and the scenario list (a read) are both mocked.
const { startDemoRun, scenarios } = vi.hoisted(() => ({ startDemoRun: vi.fn(), scenarios: vi.fn() }));
vi.mock('@/lib/blackbox', () => ({ startDemoRun }));
vi.mock('@/lib/ottoTwin', () => ({ twin: { scenarios } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { StartRunDialog } from './StartRunDialog';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(list: { scenario_code: string; title: string }[] | null = null) {
  if (list) scenarios.mockResolvedValue({ scenarios: list });
  else scenarios.mockRejectedValue(new Error('offline'));
  startDemoRun.mockResolvedValue({ ok: true, sim_run_id: 'run-new' });
  const ctrl = { syncFromRun: vi.fn(), setSpeed: vi.fn() };
  const onOpenChange = vi.fn();
  const onOpenControl = vi.fn();
  render(<StartRunDialog open onOpenChange={onOpenChange} ctrl={ctrl} onOpenControl={onOpenControl} />);
  return { ctrl, onOpenChange, onOpenControl };
}

describe('StartRunDialog — Start (phone run bar, desktop top bar) really starts a run, after a confirm', () => {
  it('offers the featured scenarios with Busy Day preselected and says the current run ends', async () => {
    setup();
    await act(async () => {});
    expect(screen.getByText('A new run stops and resets the current run.')).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(
      ['Busy Day', 'Normal Day', 'Heat Wave', 'Winter Storm', 'DR Cascade', 'Charger Outage']);
    expect(screen.getByRole('radio', { name: 'Busy Day' }).getAttribute('aria-checked')).toBe('true');
    expect(startDemoRun).not.toHaveBeenCalled(); // opening it starts nothing
  });

  it('"Start run" starts the chosen scenario through the shared path, then closes', async () => {
    const { ctrl, onOpenChange } = setup([
      { scenario_code: 'busy_day', title: 'Busy Day' },
      { scenario_code: 'heat_wave', title: 'Heat Wave (Texas)' },
    ]);
    await act(async () => {});
    // only decks the backend offers are chips
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Busy Day', 'Heat Wave']);
    fireEvent.click(screen.getByRole('radio', { name: 'Heat Wave' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start run/ })); });
    expect(startDemoRun).toHaveBeenCalledTimes(1);
    expect(startDemoRun).toHaveBeenCalledWith('heat_wave', 1);
    expect(ctrl.syncFromRun).toHaveBeenCalledWith('running');
    expect(ctrl.setSpeed).toHaveBeenCalledWith(3);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a failed start keeps the dialog open', async () => {
    const { onOpenChange } = setup();
    startDemoRun.mockRejectedValue(new Error('nope'));
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start run/ })); });
    expect(startDemoRun).toHaveBeenCalledWith('busy_day', 1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('"More options in Control" opens the Control tab and starts nothing', async () => {
    const { onOpenChange, onOpenControl } = setup();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Open Control for more options' }));
    expect(onOpenControl).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(startDemoRun).not.toHaveBeenCalled();
  });
});
