import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useTwinStore } from '@/store/twinStore';
import { useCockpitStore } from '@/store/cockpitStore';
import type { TwinSnapshot } from '@/lib/ottoTwin';

const { depotCards } = vi.hoisted(() => ({ depotCards: vi.fn() }));
vi.mock('@/lib/ottoTwin', () => ({ twin: { depotCards } }));

import { CockpitSwitcher } from './CockpitSwitcher';

const RUN = '4b09c1de-0000-4000-8000-000000000001';
const cards = { vehicles: [
  { operator: { id: '22222222-2222-2222-2222-222222222222', name: 'Waymo Nashville' } },
  { operator: { id: '22222222-2222-2222-2222-222222222222', name: 'Waymo Nashville' } },
  { operator: { id: '33333333-3333-3333-3333-333333333333', name: 'Tesla Robotaxi TN' } },
] };

const showRun = (status: string) => {
  useTwinStore.getState().setActiveSimRunId(RUN);
  useTwinStore.setState({ snapshot: { run: { sim_run_id: RUN, status } } as unknown as TwinSnapshot });
};

afterEach(() => {
  cleanup();
  useTwinStore.getState().reset();
  useCockpitStore.setState({ panel: null, owner: null });
  vi.restoreAllMocks();
});

describe('View in switcher', () => {
  it('says there is no live run instead of opening a cockpit', async () => {
    depotCards.mockResolvedValue(cards);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    showRun('completed');
    await act(async () => { render(<CockpitSwitcher />); });
    expect(screen.getByTestId('view-in-no-run')).toBeTruthy();
    const btn = screen.getByTestId('view-in-pulse') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens each cockpit on the live run, OrchestrAV as the picked owner', async () => {
    depotCards.mockResolvedValue(cards);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    showRun('running');
    await act(async () => { render(<CockpitSwitcher />); });
    expect(screen.queryByTestId('view-in-no-run')).toBeNull();

    fireEvent.click(screen.getByTestId('view-in-orchestrav'));
    fireEvent.change(await screen.findByTestId('view-in-owner'), { target: { value: '33333333-3333-3333-3333-333333333333' } });
    fireEvent.click(screen.getByTestId('open-tab-orchestrav'));
    // let the closed menu hand focus back to its trigger before the next one opens
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByTestId('view-in-pulse'));
    expect(screen.queryByTestId('view-in-owner')).toBeNull(); // PULSE shows every owner: no picker
    fireEvent.click(await screen.findByTestId('open-tab-pulse'));

    const urls = open.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls[0].origin).toBe('https://ottoyard-orchestra-av.lovable.app');
    expect(urls[0].searchParams.get('run')).toBe(RUN);
    expect(urls[0].searchParams.get('owner')).toBe('33333333-3333-3333-3333-333333333333');
    expect(urls[1].origin).toBe('https://ottoyard-otto-pulse.lovable.app');
    expect(urls[1].searchParams.get('source')).toBe('twin');
    expect(urls[1].searchParams.has('owner')).toBe(false);
  });

  it('defaults the owner to the largest fleet and shows a cockpit beside the depot', async () => {
    depotCards.mockResolvedValue(cards);
    showRun('running');
    await act(async () => { render(<CockpitSwitcher />); });
    expect(useCockpitStore.getState().owner).toBe('22222222-2222-2222-2222-222222222222');
    fireEvent.click(screen.getByTestId('view-in-pulse'));
    fireEvent.click(await screen.findByTestId('open-beside-pulse'));
    expect(useCockpitStore.getState().panel).toBe('pulse');
    fireEvent.click(screen.getByTestId('view-in-twin'));
    expect(useCockpitStore.getState().panel).toBeNull();
  });

  it('closes the side-by-side panel when the run ends', async () => {
    depotCards.mockResolvedValue(cards);
    showRun('running');
    useCockpitStore.setState({ panel: 'orchestrav' });
    await act(async () => { render(<CockpitSwitcher />); });
    expect(useCockpitStore.getState().panel).toBe('orchestrav');
    await act(async () => { showRun('completed'); });
    expect(useCockpitStore.getState().panel).toBeNull();
    expect(screen.getByTestId('view-in-no-run')).toBeTruthy();
  });
});
