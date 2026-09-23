import type { TwinLayout, TwinSnapshot } from '@/lib/ottoTwin';

const count = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Counts from the current server frame and capacity from the current run's layout. */
export function liveFleetMetrics(snapshot: TwinSnapshot, layout: TwinLayout | null) {
  const states = snapshot.fleet?.counts ?? {};
  const total = count(snapshot.fleet?.total);
  const ready = count(states.staged_for_departure);
  const chargingDcfc = count(states.charging_dcfc);
  const chargingL2 = count(states.charging_l2);
  const dcfcStalls = layout?.stalls.filter((s) => s.type === 'dcfc').length ?? 0;
  const l2Stalls = layout?.stalls.filter((s) => s.type === 'l2').length ?? 0;

  return {
    total, ready, chargingDcfc, chargingL2, dcfcStalls, l2Stalls,
    // Awaiting service is still work owed. It cannot be counted as ready to leave.
    readinessPct: total ? (ready / total) * 100 : null,
    dcfcUtil: dcfcStalls ? chargingDcfc / dcfcStalls : null,
    l2Util: l2Stalls ? chargingL2 / l2Stalls : null,
  };
}
