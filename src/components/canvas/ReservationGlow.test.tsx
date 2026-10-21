import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReservationGlow } from './ReservationGlow';
import { Stall } from './Stall';
import { useDepotStore } from '@/store/depotStore';
import { useAppointmentStore, type ApptReservation, type AppointmentsData } from '@/store/appointmentStore';
import { generateStallsV2 } from '@/lib/sitePlan';

// The reservation ring traces the stall it rings: for a staging stall and a bay, the ring and the stall are the same
// rectangle, centred on the stall's car (sitePlan.planStallBox).
afterEach(() => {
  cleanup();
  useAppointmentStore.getState().setData(null);
});

/** A polygon's [x0, y0, x1, y1] on the plan, after the translate of the group that holds it. */
function boxOf(poly: Element): [number, number, number, number] {
  let tx = 0, ty = 0;
  for (let el: Element | null = poly.parentElement; el; el = el.parentElement) {
    const m = /translate\(([-\d.]+),?\s*([-\d.]+)\)/.exec(el.getAttribute('transform') ?? '');
    if (m) { tx += Number(m[1]); ty += Number(m[2]); }
  }
  const pts = poly.getAttribute('points')!.trim().split(/\s+/).map((p) => p.split(',').map(Number));
  const xs = pts.map(([x]) => x + tx), ys = pts.map(([, y]) => y + ty);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const reservation = (stall_type: string, stall_code: string): ApptReservation => ({
  stall_type, stall_code, av_id: 'AV-1', veh_state: 'inbound', soc: 40, expires_at: null, inbound: true, occupied: false,
});

describe('2D: a reservation ring traces its stall', () => {
  const stalls = generateStallsV2();

  for (const [type, code, id] of [
    ['staging', 'NASH-STAGE-55', 'STAGE-55'],      // a north-south car (the S1 row, at 0 degrees)
    ['staging', 'NASH-STAGE-30', 'STAGE-30'],      // an east-west car (the east column, at 90)
    ['staging', 'NASH-STAGE-95', 'STAGE-95'],      // an east-west car (the west temp column, at 270)
    ['wash_bay', 'NASH-WASH-02', 'WASH-02'],
    ['service_bay', 'NASH-SVC-01', 'SVC-01'],
  ] as const) {
    it(`rings ${id} on the outline the stall itself draws`, () => {
      useDepotStore.setState({ stalls });
      const stall = stalls.find((s) => s.id === id)!;
      expect(stall).toBeTruthy();
      if (id === 'STAGE-55') expect(stall.position.angle).toBe(0);
      if (id === 'STAGE-30') expect(stall.position.angle).toBe(90);
      if (id === 'STAGE-95') expect(stall.position.angle).toBe(270);
      useAppointmentStore.getState().setData({ reservations: [reservation(type, code)] } as unknown as AppointmentsData);
      const ring = render(<svg><ReservationGlow /></svg>).container.querySelectorAll('polygon');
      expect(ring.length).toBeGreaterThan(0);
      const drawn = boxOf(render(<svg><Stall stall={stall} /></svg>).container.querySelector('polygon')!);
      for (const p of ring) {
        const b = boxOf(p);
        for (let k = 0; k < 4; k++) expect(b[k], `${id} edge ${k}`).toBeCloseTo(drawn[k], 6);
      }
    });
  }
});
