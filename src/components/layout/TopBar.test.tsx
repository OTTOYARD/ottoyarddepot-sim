import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// Chase, 2026-10-07: "the same start run at the top of the screen". The top bar carries the
// phone run bar's transport (RunTransport). No network: the run transport is mocked at
// useTwinControl, the start and stop writes at blackbox, the scenario list at ottoTwin.
const { ctrl, startDemoRun, stopAndReset, scenarios } = vi.hoisted(() => ({
  ctrl: {
    playing: true, speed: 3,
    play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), setSpeed: vi.fn(), syncFromRun: vi.fn(),
  },
  startDemoRun: vi.fn(),
  stopAndReset: vi.fn(),
  scenarios: vi.fn(),
}));
vi.mock('@/hooks/useTwinControl', () => ({ useTwinControl: () => ctrl, MAX_SPEED_X: 8 }));
vi.mock('@/lib/blackbox', () => ({ startDemoRun, stopAndReset }));
vi.mock('@/lib/ottoTwin', () => ({ twin: { scenarios } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// the "View in" switcher reads fleet owners from the backend; it is not what this tests
vi.mock('@/components/cockpit/CockpitSwitcher', () => ({ CockpitSwitcher: () => null }));

import { TopBar } from './TopBar';
import { useTwinStore } from '@/store/twinStore';
import { useSimulationStore } from '@/store/simulationStore';

const transport = () => within(screen.getByTestId('run-transport'));

beforeEach(() => {
  scenarios.mockRejectedValue(new Error('offline'));
  startDemoRun.mockResolvedValue({ ok: true, sim_run_id: 'run-new' });
  stopAndReset.mockResolvedValue({ ok: true });
  ctrl.playing = true;
  ctrl.speed = 3;
  useSimulationStore.setState(useSimulationStore.getInitialState());
});
afterEach(() => {
  cleanup();
  useTwinStore.getState().reset();
  vi.clearAllMocks();
});

describe('TopBar: the run transport, beside the clock', () => {
  it('with no run: Start, and the speed shown but off; no Pause, no Stop', () => {
    render(<TopBar />);
    expect(transport().getByRole('button', { name: /Start/ })).toBeTruthy();
    expect(transport().queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(transport().queryByRole('button', { name: 'Stop run' })).toBeNull();
    expect(transport().getByRole('button', { name: 'Increase speed' })).toBeDisabled();
    expect(screen.getByTestId('run-speed').textContent).toBe('3×');
  });

  it('Start opens the confirm and starts nothing until the confirm says so', async () => {
    render(<TopBar />);
    fireEvent.click(transport().getByRole('button', { name: /Start/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Start a simulation run')).toBeTruthy();
    expect(within(dialog).getByText('A new run stops and resets the current run.')).toBeTruthy();
    // Busy Day first, and chosen
    expect(within(dialog).getAllByRole('radio')[0].textContent).toBe('Busy Day');
    expect(within(dialog).getByRole('radio', { name: 'Busy Day' }).getAttribute('aria-checked')).toBe('true');
    expect(startDemoRun).not.toHaveBeenCalled();
    // Cancel: still nothing
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(startDemoRun).not.toHaveBeenCalled();
    // confirmed: the one start path, at 1x, then 3x
    fireEvent.click(transport().getByRole('button', { name: /Start/ }));
    const again = await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.click(within(again).getByRole('button', { name: /Start run/ })); });
    expect(startDemoRun).toHaveBeenCalledTimes(1);
    expect(startDemoRun).toHaveBeenCalledWith('busy_day', 1);
    expect(ctrl.syncFromRun).toHaveBeenCalledWith('running');
    expect(ctrl.setSpeed).toHaveBeenCalledWith(3);
  });

  it('"Open Control for more options" opens the side panel on the Control tab, and starts nothing', async () => {
    useSimulationStore.setState({ isPanelOpen: false });
    render(<TopBar />);
    fireEvent.click(transport().getByRole('button', { name: /Start/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Control for more options' }));
    expect(useSimulationStore.getState()).toMatchObject({ isPanelOpen: true, activeTab: 'controls' });
    expect(startDemoRun).not.toHaveBeenCalled();
  });

  it('with a run: Pause and Stop instead of Start, and the speed steps', () => {
    useTwinStore.getState().setActiveSimRunId('run-1');
    render(<TopBar />);
    expect(transport().queryByRole('button', { name: /Start/ })).toBeNull();
    fireEvent.click(transport().getByRole('button', { name: 'Pause' }));
    expect(ctrl.toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(transport().getByRole('button', { name: 'Increase speed' }));
    expect(ctrl.setSpeed).toHaveBeenCalledWith(4);
    fireEvent.click(transport().getByRole('button', { name: 'Decrease speed' }));
    expect(ctrl.setSpeed).toHaveBeenCalledWith(2);
  });

  it('a paused run offers Resume', () => {
    useTwinStore.getState().setActiveSimRunId('run-1');
    ctrl.playing = false;
    render(<TopBar />);
    expect(transport().getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('Stop asks first, and stops only when confirmed', async () => {
    useTwinStore.getState().setActiveSimRunId('run-1');
    render(<TopBar />);
    fireEvent.click(transport().getByRole('button', { name: 'Stop run' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Stop this run?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue run' }));
    expect(stopAndReset).not.toHaveBeenCalled();
    fireEvent.click(transport().getByRole('button', { name: 'Stop run' }));
    dialog = await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Stop run' })); });
    expect(stopAndReset).toHaveBeenCalledWith('run-1');
    expect(ctrl.pause).toHaveBeenCalled();
    expect(useSimulationStore.getState().activeTab).toBe('history'); // where its Black Box is
  });
});

describe('the cockpit opens on Background', () => {
  it('is the store default, desktop and phone alike (the phone sheet reads the same tab)', () => {
    expect(useSimulationStore.getInitialState().activeTab).toBe('background');
  });
});
