import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// The start path's only write is startDemoRun (the control edge). It is mocked: nothing here
// can reach the backend.
const { startDemoRun, toastSuccess, toastError } = vi.hoisted(() => ({
  startDemoRun: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/blackbox', () => ({ startDemoRun }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { useStartRun, START_SPEED_X } from './useStartRun';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function control() {
  const calls: string[] = [];
  startDemoRun.mockImplementation(async (code: string, speed: number) => {
    calls.push(`startDemoRun:${code}:${speed}`);
    return { ok: true, sim_run_id: 'run-new' };
  });
  const ctrl = {
    syncFromRun: vi.fn((status: string) => { calls.push(`syncFromRun:${status}`); }),
    setSpeed: vi.fn((v: number) => { calls.push(`setSpeed:${v}`); }),
  };
  return { ctrl, calls };
}

describe('useStartRun — the one start path', () => {
  it('starts the run, adopts "running" without a resume, opens at 3x, then says so', async () => {
    const { ctrl, calls } = control();
    const { result } = renderHook(() => useStartRun(ctrl));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.start('busy_day', 'Busy Day'); });

    expect(ok).toBe(true);
    expect(calls).toEqual(['startDemoRun:busy_day:1', 'syncFromRun:running', `setSpeed:${START_SPEED_X}`]);
    expect(START_SPEED_X).toBe(3);
    expect(toastSuccess).toHaveBeenCalledWith('Started Busy Day');
    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.starting).toBe(false);
  });

  it('names the toast by the code when no title is given', async () => {
    const { ctrl } = control();
    const { result } = renderHook(() => useStartRun(ctrl));
    await act(async () => { await result.current.start('heat_wave'); });
    expect(toastSuccess).toHaveBeenCalledWith('Started heat_wave');
  });

  it('is "starting" while the start is in flight', async () => {
    const { ctrl } = control();
    let release: () => void = () => {};
    startDemoRun.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true, sim_run_id: 'x' }); }));
    const { result } = renderHook(() => useStartRun(ctrl));
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => { pending = result.current.start('busy_day'); });
    expect(result.current.starting).toBe(true);
    await act(async () => { release(); await pending; });
    expect(result.current.starting).toBe(false);
  });

  it('a failed start touches no transport and reports the reason', async () => {
    const { ctrl } = control();
    startDemoRun.mockRejectedValue(new Error('control edge 500'));
    const { result } = renderHook(() => useStartRun(ctrl));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.start('busy_day', 'Busy Day'); });

    expect(ok).toBe(false);
    expect(ctrl.syncFromRun).not.toHaveBeenCalled();
    expect(ctrl.setSpeed).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Start failed', { description: 'control edge 500' });
    expect(result.current.starting).toBe(false);
  });
});
