// ============================================================================
// TwinPowerTab.test.tsx — the Power tab draws the depot's one-line honestly.
//
// The fixture (__fixtures__/powerOneLine.labDay.json) is a REAL answer of otto-q-core 0810's ottoq_power_one_line from
// a research-lab day on a copy of production's engine (busy_day, seed 171717, 2-minute ticks, TX-B1 tripped for an hour
// at 2 PM depot time). A lab day, not a production run.
//
// What is asserted, and why:
//   1. The tree is drawn whole: seven transformers, thirty posts, the battery, the building and the solar.
//   2. The rule-13 line is always on the page, and the right-size reading never reads as a change.
//   3. No number is invented: before 0810 answers the tab says so and draws no diagram.
//   4. A tripped transformer reads open, its five posts read down, and the card says the cars were re-queued.
//   5. The trip is two presses, only while a run is live, and goes through the control door as kind power_zone.
//   6. Power is the last tab in the bar; the number keys 1-0 belong to the ten before the last two.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { rpc, injectFault, toastOk, toastErr } = vi.hoisted(() => ({ rpc: vi.fn(), injectFault: vi.fn(), toastOk: vi.fn(), toastErr: vi.fn() }));
vi.mock('@/lib/ottoQClient', () => ({ ottoQ: { rpc } }));
vi.mock('sonner', () => ({ toast: { success: toastOk, error: toastErr } }));
vi.mock('@/lib/ottoTwin', async (orig) => {
  const real = await orig<typeof import('@/lib/ottoTwin')>();
  return { ...real, twin: { ...real.twin, injectFault } };
});

import labDay from './__fixtures__/powerOneLine.labDay.json';
import { TRIP_MINUTES, TwinPowerTab } from './TwinPowerTab';
import { TabBar } from '@/components/layout/TabBar';
import { useTwinStore } from '@/store/twinStore';
import { readOneLine, rightsizeWords, transformers } from '@/lib/powerOneLine';

type Raw = { as_of_sim: string; sim_run_id: string; nodes: Array<Record<string, unknown>>; trips: Array<Record<string, string | number>> };
const clone = (): Raw => JSON.parse(JSON.stringify(labDay)) as Raw;
const answer = (data: unknown) => rpc.mockResolvedValue({ data, error: null });
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const before = useTwinStore.getState();
const liveRun = (id: string) => useTwinStore.setState({ activeSimRunId: id, snapshot: { run: { sim_run_id: id, status: 'running' } } } as never);

/** The lab day as it stood in the middle of its trip: TX-B1 open, its five posts down. */
function midTrip(): Raw {
  const d = clone();
  const trip = d.trips[0];
  d.as_of_sim = new Date((Date.parse(String(trip.tripped_at_sim)) + Date.parse(String(trip.recovers_at_sim))) / 2).toISOString();
  for (const n of d.nodes) if (n.parent === 'TX-B1') { n.charger_state = 'Faulted'; n.power_node_fault = 'TX-B1'; }
  return d;
}

beforeEach(() => { rpc.mockReset(); injectFault.mockReset(); toastOk.mockReset(); toastErr.mockReset(); });
afterEach(() => { cleanup(); act(() => useTwinStore.setState({ activeSimRunId: before.activeSimRunId, snapshot: before.snapshot })); });

describe('the one-line', () => {
  it('draws seven transformers, thirty posts and the three other loads, and says what a rating is', async () => {
    answer(clone());
    render(<TwinPowerTab />);
    await settle();
    expect(screen.getByTestId('power-banner')).toHaveTextContent('Nothing on this page limits a car.');
    const diagram = screen.getByTestId('power-diagram');
    expect(within(diagram).getAllByRole('button')).toHaveLength(7);
    expect(diagram.querySelectorAll('[data-testid^="power-post-"]')).toHaveLength(30);
    expect(diagram.querySelectorAll('[data-testid^="power-leaf-"]')).toHaveLength(3);
    expect(screen.getByTestId('power-utility')).toHaveTextContent('17,500 kVA');
    expect(screen.getByTestId('power-run-id')).toHaveTextContent(clone().sim_run_id);
    expect(screen.getByTestId('power-posts-asked')).toHaveTextContent('kW of its 350 kW');
    // asked for the depot, and for no particular run while none is live
    expect(rpc).toHaveBeenCalledWith('ottoq_power_one_line', { p_depot_id: '11111111-1111-1111-1111-111111111111', p_sim_run_id: null });
  });

  it('opens a transformer\'s card, with its right-size reading worded as a reading', async () => {
    answer(clone());
    render(<TwinPowerTab />);
    await settle();
    fireEvent.click(screen.getByTestId('power-tx-TX-AUX'));
    const card = screen.getByTestId('power-tx-card');
    expect(card.dataset.node).toBe('TX-AUX');
    expect(card).toHaveTextContent('battery, building, canopy solar');
    const aux = transformers(readOneLine(clone())!).find((t) => t.code === 'TX-AUX')!;
    expect(screen.getByTestId('power-rightsize')).toHaveTextContent(rightsizeWords(aux)!);
    expect(screen.getByTestId('power-rightsize')).toHaveTextContent('It changes nothing');
    expect(screen.queryByTestId('power-trip-arm')).toBeNull();          // no posts under it, and no live run
    fireEvent.keyDown(screen.getByTestId('power-tx-TX-A1'), { key: 'Enter' });
    expect(screen.getByTestId('power-tx-card').dataset.node).toBe('TX-A1');
    expect(screen.getByTestId('power-trip-why-not')).toHaveTextContent('while a run is live');
    expect(screen.getByTestId('power-resilience')).toHaveTextContent(/Had it tripped at/);
  });

  it('invents nothing before the engine answers', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.ottoq_power_one_line' } });
    render(<TwinPowerTab />);
    await settle();
    expect(screen.getByTestId('power-empty')).toHaveTextContent('0810');
    expect(screen.queryByTestId('power-diagram')).toBeNull();
    expect(screen.queryByTestId('power-utility')).toBeNull();
  });

  it('draws the tree but no measured figure before any run is measured', async () => {
    const d = clone() as Raw & { as_of_sim: string | null; sim_run_id: string | null };
    d.as_of_sim = null; d.sim_run_id = null; d.trips = [];
    for (const n of d.nodes) { n.now = null; n.study = null; }
    answer(d);
    render(<TwinPowerTab />);
    await settle();
    expect(screen.getByTestId('power-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('power-unmeasured')).toHaveTextContent('Start a run');
    expect(screen.queryByTestId('power-utility')).toBeNull();
  });
});

describe('a tripped transformer', () => {
  it('reads open, its posts read down, and the card says the cars were re-queued', async () => {
    answer(midTrip());
    render(<TwinPowerTab />);
    await settle();
    const b1 = screen.getByTestId('power-tx-TX-B1');
    expect(b1.dataset.tripped).toBe('true');
    expect(b1).toHaveTextContent('OPEN');
    expect(b1.querySelectorAll('[data-state="down"]')).toHaveLength(5);
    expect(screen.getByTestId('power-tx-TX-B2').dataset.tripped).toBeUndefined();
    fireEvent.click(b1);
    const note = screen.getByTestId('power-trip-note');
    expect(note).toHaveTextContent(`${clone().trips[0].posts_faulted} posts went dark together`);
    const cars = Number(clone().trips[0].cars_on_posts);
    if (cars > 0) expect(note).toHaveTextContent('re-queued');
    expect(screen.getByTestId('power-trip-why-not')).toHaveTextContent('This transformer is open.');
  });
});

describe('tripping one', () => {
  it('takes two presses, only while a run is live, and goes through the control door', async () => {
    const d = clone();
    answer(d);
    liveRun(d.sim_run_id);
    injectFault.mockResolvedValue({ posts_faulted: 5, cars_on_posts: 2 });
    render(<TwinPowerTab />);
    await settle();
    expect(rpc).toHaveBeenCalledWith('ottoq_power_one_line', expect.objectContaining({ p_sim_run_id: d.sim_run_id }));
    fireEvent.click(screen.getByTestId('power-tx-TX-A2'));
    fireEvent.click(screen.getByTestId('power-trip-arm'));
    expect(injectFault).not.toHaveBeenCalled();                          // armed, not done
    expect(screen.getByTestId('power-trip-confirm')).toHaveTextContent(`5 posts go dark for ${TRIP_MINUTES} sim min`);
    fireEvent.click(screen.getByTestId('power-trip-confirm'));
    await settle();
    expect(injectFault).toHaveBeenCalledWith(d.sim_run_id, { kind: 'power_zone', target_id: 'TX-A2', payload: { repair_minutes: TRIP_MINUTES } });
    expect(toastOk).toHaveBeenCalledWith('TX-A2 tripped', expect.objectContaining({ description: expect.stringContaining('re-queues them to finish') }));
  });

  it('says so when the door refuses', async () => {
    const d = clone();
    answer(d);
    liveRun(d.sim_run_id);
    injectFault.mockRejectedValue(new Error('power node not tripped: run_not_running'));
    render(<TwinPowerTab />);
    await settle();
    fireEvent.click(screen.getByTestId('power-tx-TX-A1'));
    fireEvent.click(screen.getByTestId('power-trip-arm'));
    fireEvent.click(screen.getByTestId('power-trip-confirm'));
    await settle();
    expect(toastErr).toHaveBeenCalledWith('TX-A1 was not tripped', expect.objectContaining({ description: expect.stringContaining('run_not_running') }));
    expect(screen.getByTestId('power-trip-arm')).toBeInTheDocument();    // back to the first press
  });
});

describe('where it sits', () => {
  it('Power is the last tab, after the ten the number keys open', () => {
    render(<TabBar />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels[labels.length - 1]).toBe('Power');
    expect(labels.slice(0, 10)).toEqual(['Background', 'Control', 'OTTO-Q', 'Robotics', 'Agent', 'KPIs', 'Runs', 'Diagnostics', 'Copilot', 'Value']);
  });
});
