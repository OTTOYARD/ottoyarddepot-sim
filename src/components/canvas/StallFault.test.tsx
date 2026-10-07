import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Stall } from './Stall';
import { StallTooltip } from './StallTooltip';
import { useDepotStore, type StallState } from '@/store/depotStore';
import { useTwinStore } from '@/store/twinStore';
import type { ChargerDown } from '@/lib/chargerFaults';
import type { TwinSnapshot } from '@/lib/ottoTwin';

// A faulted charger in the 2D plan: the FAULT mark (shape and word) on the stall, and the reason and the time in its
// tooltip. The words themselves are pinned in src/lib/chargerFaults.test.ts.
const DCFC: StallState = { id: 'DCFC-02', type: 'dcfc', status: 'offline', vehicleId: null, position: { x: 96, y: 102, angle: 60 } };
const FAULT: ChargerDown = { kind: 'fault', code: 'fault.communication_dropout', until: '2026-09-02T11:07:00+00:00' };

afterEach(() => {
  cleanup();
  useDepotStore.getState().setHoveredStall(null);
  useTwinStore.getState().reset();
});

const plan = (stall: StallState) => render(<svg><Stall stall={stall} /></svg>);

describe('2D: a faulted charger reads as down, in shape and in words', () => {
  it('draws the FAULT mark on a charger the twin reports Faulted', () => {
    plan({ ...DCFC, down: FAULT });
    const mark = screen.getByTestId('stall-fault-mark');
    expect(mark.textContent).toBe('FAULT');
    expect(mark.querySelector('path')).toBeTruthy(); // the warning triangle
  });

  it('keeps the plain offline look for a stall offline for another reason, and for a healthy charger', () => {
    plan({ ...DCFC, down: { kind: 'offline', code: null, until: null } });
    expect(screen.queryByTestId('stall-fault-mark')).toBeNull();
    cleanup();
    plan({ ...DCFC, status: 'offline' }); // the renderer's own offline: a car awaiting a tow on it
    expect(screen.queryByTestId('stall-fault-mark')).toBeNull();
    cleanup();
    plan({ ...DCFC, status: 'available' });
    expect(screen.queryByTestId('stall-fault-mark')).toBeNull();
  });
});

describe('2D: the tooltip says why and until when', () => {
  /** Hover `stall` with the run's clock at `simClock`. jsdom has no SVG geometry, so the map's svg
   *  answers the two calls the tooltip positions itself with. */
  const hover = (stall: StallState, simClock: string | null) => {
    useDepotStore.setState({ stalls: [stall], hoveredStallId: stall.id });
    if (simClock) useTwinStore.getState().setSnapshot({ run: { sim_clock: simClock } } as unknown as TwinSnapshot);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    Object.assign(svg, {
      createSVGPoint: () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 10, y: 200 }) }),
      getScreenCTM: () => ({}),
    });
    render(<StallTooltip svgRef={{ current: svg }} />);
    return screen.getByTestId('stall-tooltip');
  };

  it('a known code: the reason and the repair end, on the sim clock in CT', () => {
    const t = hover({ ...DCFC, down: FAULT }, '2026-09-02T09:00:00+00:00');
    expect(t.textContent).toContain('DCFC-02');
    expect(t.textContent).toContain('fault'); // the badge
    expect(t.textContent).toContain('Charger fault: communication dropout. Back about 6:07 AM sim.');
    expect(t.textContent).toContain('OTTO-Q sends no car to it.');
  });

  it('an unknown code reads "Charger fault", with no invented reason', () => {
    const t = hover({ ...DCFC, down: { ...FAULT, code: 'fault.never_seen' } }, '2026-09-02T09:00:00+00:00');
    expect(t.textContent).toContain('Charger fault. Back about 6:07 AM sim.');
    expect(t.textContent).not.toContain('never seen');
  });

  it('no repair end leaves the time out', () => {
    const t = hover({ ...DCFC, down: { ...FAULT, until: null } }, '2026-09-02T09:00:00+00:00');
    expect(t.textContent).toContain('Charger fault: communication dropout.');
    expect(t.textContent).not.toContain('Back about');
    expect(t.textContent).not.toContain('due');
  });

  it('a healthy stall has no fault note', () => {
    const t = hover({ ...DCFC, status: 'available' }, null);
    expect(t.textContent).not.toContain('Charger fault');
    expect(screen.queryByTestId('stall-down-note')).toBeNull();
  });
});
