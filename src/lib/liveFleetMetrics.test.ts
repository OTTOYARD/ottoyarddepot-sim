import { describe, expect, it } from 'vitest';
import { liveFleetMetrics } from './liveFleetMetrics';
import { useTwinStore } from '@/store/twinStore';
import type { TwinLayout, TwinSnapshot } from './ottoTwin';

const frame = {
  run: { sim_run_id: 'run-a', tick_count: 3 },
  fleet: { total: 50, counts: {
    staged_for_departure: 5, staged_awaiting_service: 15,
    charging_dcfc: 8, charging_l2: 15,
  } },
} as unknown as TwinSnapshot;

const layout = {
  depot: { id: 'depot-a' },
  stalls: [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `dc-${i}`, type: 'dcfc' })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `l2-${i}`, type: 'l2' })),
  ],
} as TwinLayout;

describe('live fleet figures across run boundaries', () => {
  it('excludes unfinished service and uses the current depot capacity', () => {
    const m = liveFleetMetrics(frame, layout);
    expect(m.ready).toBe(5);
    expect(m.readinessPct).toBe(10);
    expect(m.dcfcUtil).toBe(0.8);
    expect(m.l2Util).toBe(0.5);
  });

  it('does not invent capacity or percentages before a layout or fleet arrives', () => {
    expect(liveFleetMetrics(frame, null).l2Util).toBeNull();
    expect(liveFleetMetrics({ ...frame, fleet: { ...frame.fleet, total: 0 } } as TwinSnapshot, layout).readinessPct).toBeNull();
  });

  it('drops the last run’s frame and layout when a different run is adopted', () => {
    const store = useTwinStore.getState();
    store.setActiveSimRunId('run-a');
    store.setLayout(layout);
    store.setSnapshot(frame);
    store.setActiveSimRunId('run-b');
    expect(useTwinStore.getState()).toMatchObject({
      activeSimRunId: 'run-b', layout: null, snapshot: null, connected: false,
    });
    useTwinStore.getState().reset();
  });
});
