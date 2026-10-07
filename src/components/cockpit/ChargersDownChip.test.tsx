import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ChargersDownChip } from './ChargersDownChip';
import { useTwinStore } from '@/store/twinStore';
import type { TwinLayout, TwinSnapshot } from '@/lib/ottoTwin';

// The count on the live depot status: nothing while every charger is up, "N chargers down" in red
// while any is, and a list of which ones and until when on a tap or a click.
const layout = {
  depot: null, structures: [],
  stalls: [
    { id: 'u-dcfc-02', code: 'NASH-DCFC-STALL-02', type: 'dcfc' },
    { id: 'u-dcfc-09', code: 'NASH-DCFC-STALL-09', type: 'dcfc' },
    { id: 'u-l2-20', code: 'NASH-L2-STALL-20', type: 'l2' },
  ],
} as unknown as TwinLayout;
const frame = (rows: Record<string, unknown>[]) => ({
  run: { sim_run_id: 'r', status: 'running', sim_clock: '2026-09-02T09:00:00+00:00' }, // 4:00 AM CT
  stalls_status: rows,
}) as unknown as TwinSnapshot;
const faulted = (id: string, code: string | null, until: string | null) =>
  ({ id, status: 'faulted', vehicle_id: null, charger_state: 'Faulted', fault_code: code, fault_until: until });

afterEach(() => { cleanup(); useTwinStore.getState().reset(); });

describe('ChargersDownChip', () => {
  it('shows nothing while no charger is down', () => {
    act(() => {
      useTwinStore.getState().setLayout(layout);
      useTwinStore.getState().setSnapshot(frame([{ id: 'u-l2-20', status: 'occupied', vehicle_id: 'v', charger_state: 'Charging' }]));
    });
    render(<ChargersDownChip variant="desktop" />);
    expect(screen.queryByTestId('chargers-down')).toBeNull();
  });

  it('counts the chargers down, lists each by name with why and until when, and says no car is sent', async () => {
    act(() => {
      useTwinStore.getState().setLayout(layout);
      useTwinStore.getState().setSnapshot(frame([
        faulted('u-l2-20', 'fault.unheard_of', null),
        faulted('u-dcfc-02', 'fault.communication_dropout', '2026-09-02T11:07:00+00:00'),
        faulted('u-dcfc-09', 'fault.station_hardware', '2026-09-02T12:30:00+00:00'),
      ]));
    });
    render(<ChargersDownChip variant="desktop" />);
    const chip = screen.getByTestId('chargers-down');
    expect(chip.textContent).toBe('3 chargers down');
    // the desktop hover title carries the whole list
    expect(chip.getAttribute('title')).toBe([
      '3 chargers down. OTTO-Q sends no car to them.',
      'DCFC-02 has a charger fault: communication dropout. Back about 6:07 AM sim.',
      'DCFC-09 has a charger fault: hardware. Back about 7:30 AM sim.',
      'L2-20 has a charger fault.',
    ].join('\n'));
    fireEvent.click(chip);
    const list = await screen.findByTestId('chargers-down-list');
    expect(within(list).getByText('OTTO-Q sends no car to these chargers.')).toBeTruthy();
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      'DCFC-02Charger fault: communication dropoutBack about 6:07 AM sim.',
      'DCFC-09Charger fault: hardwareBack about 7:30 AM sim.',
      'L2-20Charger faultThe twin gives no repair time.',
    ]);
  });

  it('one charger down reads in the singular, and the phone chip has no hover title', () => {
    act(() => {
      useTwinStore.getState().setLayout(layout);
      useTwinStore.getState().setSnapshot(frame([faulted('u-dcfc-02', null, null)]));
    });
    render(<ChargersDownChip variant="phone" />);
    const chip = screen.getByTestId('chargers-down');
    expect(chip.textContent).toBe('1 charger down');
    expect(chip.getAttribute('title')).toBeNull();
  });
});
