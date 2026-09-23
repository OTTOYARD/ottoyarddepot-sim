import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTwinStore } from '@/store/twinStore';

const { resume, pause } = vi.hoisted(() => ({ resume: vi.fn(), pause: vi.fn() }));
vi.mock('@/lib/ottoTwin', () => ({ twin: { resume, pause } }));

import { useTwinControl } from './useTwinControl';

afterEach(() => {
  cleanup();
  useTwinStore.getState().reset();
  vi.clearAllMocks();
});

describe('reattaching run controls', () => {
  it('reflects a server-running run after reload without changing the server', () => {
    useTwinStore.getState().setActiveSimRunId('run-1');
    const { result } = renderHook(() => useTwinControl());
    act(() => result.current.syncFromRun('running', 3));
    expect(result.current.playing).toBe(true);
    expect(result.current.speed).toBe(3);
    expect(useTwinStore.getState().paused).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();

    act(() => result.current.syncFromRun('paused', 1));
    expect(result.current.playing).toBe(false);
    expect(result.current.speed).toBe(1);
    expect(useTwinStore.getState().paused).toBe(true);
    expect(pause).not.toHaveBeenCalled();
  });
});
