import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CableSchedule } from './CableSchedule';
import type { CableLine } from '@/lib/robotics/catalog';

const fmtM = (mm: number): string => `${(mm / 1000).toFixed(2)} m`;

afterEach(cleanup);

const line = (i: number, open: string[] = []): CableLine => ({
  id: `L${i}`, name: `Line ${i}`, kind: 'power', od: 10, spec: 'a 10 mm cable', from: 'the cabinet', to: `device ${i}`, sub: 'SUPPLY',
  runs: [
    { kind: 'drawn', via: 'P1', where: 'in the trench', mm: 1800, tol: 0, bend: 60, moving: false, range: null },
    { kind: 'chain', via: 'CH1', where: 'in the chain', mm: 2500, tol: 0, bend: 120, moving: true, range: null },
    { kind: 'duct', via: 'D1', where: 'through the duct', mm: 700, tol: 90, bend: null, moving: false, range: null },
  ],
  routeMm: 5000, tolMm: 90, tails: { a: 1500, b: 100, basis: 'to make it off' }, orderMm: 6700,
  bendMm: { fixed: 40, moving: 75, tightestFixed: 60, tightestMoving: 120 }, pieces: ['P1', 'CH1'], notes: [], open,
});

describe('CableSchedule', () => {
  it('lists the first 10 lines with their route and order lengths, and all on request', () => {
    render(<CableSchedule cables={Array.from({ length: 12 }, (_, i) => line(i))} onPick={() => {}} known={() => true} />);
    expect(screen.getAllByTestId('cable')).toHaveLength(10);
    expect(screen.getAllByTestId('cable')[0].textContent).toContain(`${fmtM(5000)} · order ${fmtM(6700)}`);
    fireEvent.click(screen.getByTestId('cable-all'));
    expect(screen.getAllByTestId('cable')).toHaveLength(12);
    expect(screen.getByTestId('cable-schedule').textContent).toContain('12 lines');
  });

  it('opens a line: its ends, each piece of its route, its order length and its open items', () => {
    const pick = vi.fn();
    render(<CableSchedule cables={[line(1, ['no route reaches the light rings'])]} onPick={pick} known={(id) => id === 'P1'} csvUrl="/cad/x.cables.csv" />);
    fireEvent.click(screen.getByTestId('cable'));
    const d = screen.getByTestId('cable-detail');
    expect(d.textContent).toContain('From the cabinet to device 1.');
    expect(within(d).getAllByTestId('cable-run').map((r) => r.getAttribute('data-kind'))).toEqual(['drawn', 'chain', 'duct']);
    expect(d.textContent).toContain('±90 mm');
    expect(d.textContent).toContain(`Order ${fmtM(6700)}.`);
    expect(within(d).getByTestId('cable-open').textContent).toContain('no route reaches the light rings');
    fireEvent.click(within(d).getByText('P1'));      // a piece in the parts list selects it in the viewer
    expect(pick).toHaveBeenCalledWith('P1');
    expect(within(d).queryByRole('button', { name: 'CH1' })).toBeNull();     // not a part: named, not a link
    expect(screen.getByText('Download the cable schedule (CSV)').getAttribute('href')).toBe('/cad/x.cables.csv');
  });
});
