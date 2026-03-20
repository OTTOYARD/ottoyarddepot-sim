import { useAlertStore } from '@/store/alertStore';
import { useDepotStore } from '@/store/depotStore';
import { useKPIStore } from '@/store/kpiStore';
import type { Vehicle } from './types';
import type { SimulationConfig } from '@/store/simulationStore';
import type { StallState } from '@/store/depotStore';

// Internal timers for sustained-condition checks
let queueOverflowStart: number | null = null;
let highUtilDcfcStart: number | null = null;
let highUtilL2Start: number | null = null;
let weatherAlerted = false;
let lastFailureCheckTime = 0;

function timeToSeconds(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 3600 + m * 60;
}

function formatSimTime(simTime: number): string {
  const h = Math.floor(simTime / 3600);
  const m = Math.floor((simTime % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function checkAlerts(
  vehicles: Vehicle[],
  config: SimulationConfig,
  stalls: StallState[],
  simTime: number,
) {
  const addAlert = useAlertStore.getState().addAlert;
  const kpis = useKPIStore.getState();

  const queueDepth = vehicles.filter((v) => v.status === 'queued').length;
  const servicingCount = vehicles.filter(
    (v) => !['approaching', 'queued', 'departing'].includes(v.status)
  ).length;

  const dcfcStalls = stalls.filter((s) => s.type === 'dcfc');
  const l2Stalls = stalls.filter((s) => s.type === 'l2');
  const dcfcOccupied = dcfcStalls.filter((s) => s.status !== 'available' && s.status !== 'offline').length;
  const l2Occupied = l2Stalls.filter((s) => s.status !== 'available' && s.status !== 'offline').length;
  const dcfcTotal = dcfcStalls.filter((s) => s.status !== 'offline').length;
  const l2Total = l2Stalls.filter((s) => s.status !== 'offline').length;
  const dcfcUtil = dcfcTotal > 0 ? dcfcOccupied / dcfcTotal : 0;
  const l2Util = l2Total > 0 ? l2Occupied / l2Total : 0;

  // ── CRITICAL ──

  // Queue overflow: depth > 15 sustained for 5 sim-minutes
  if (queueDepth > 15) {
    if (queueOverflowStart === null) queueOverflowStart = simTime;
    else if (simTime - queueOverflowStart >= 300) {
      addAlert({
        timestamp: simTime,
        severity: 'critical',
        title: 'Queue Overflow',
        message: `Queue depth at ${queueDepth} vehicles for over 5 minutes. Service throughput cannot keep pace with arrivals.`,
      });
    }
  } else {
    queueOverflowStart = null;
  }

  // Charger failure: random roll based on equipmentFailureRate
  if (config.equipmentFailureRate > 0 && simTime - lastFailureCheckTime >= 60) {
    lastFailureCheckTime = simTime;
    // Roll once per sim-minute, probability = failureRate% / 60 (per minute chance scaled to hourly)
    const failProb = config.equipmentFailureRate / 100 / 60;
    if (Math.random() < failProb) {
      const depotStore = useDepotStore.getState();
      const occupiedStalls = depotStore.stalls.filter(
        (s) => (s.type === 'dcfc' || s.type === 'l2') && s.status !== 'offline' && s.status !== 'available'
      );
      if (occupiedStalls.length > 0) {
        const target = occupiedStalls[Math.floor(Math.random() * occupiedStalls.length)];
        depotStore.setStallStatus(target.id, 'offline');
        addAlert({
          timestamp: simTime,
          severity: 'critical',
          title: 'Charger Failure',
          message: `${target.id} has gone offline due to equipment failure. Vehicle service interrupted.`,
        });
      }
    }
  }

  // Demand spike: total power draw exceeds utility service limit
  const totalPowerKW =
    dcfcOccupied * config.dcfcPowerPerStall + l2Occupied * config.l2PowerPerStall;
  const utilityLimitKW = config.utilityService * 1000;
  if (totalPowerKW > utilityLimitKW) {
    addAlert({
      timestamp: simTime,
      severity: 'critical',
      title: 'Demand Spike',
      message: `Power draw ${Math.round(totalPowerKW)} kW exceeds utility limit of ${utilityLimitKW} kW. Risk of demand charges or brownout.`,
    });
  }

  // BESS depleted during peak hours (7AM-9PM)
  const isPeak = simTime >= 25200 && simTime <= 75600;
  if (isPeak && kpis.bessSOC < 10) {
    addAlert({
      timestamp: simTime,
      severity: 'critical',
      title: 'BESS Depleted',
      message: `Battery storage at ${kpis.bessSOC.toFixed(1)}% during peak hours. No buffer for demand spikes.`,
    });
  }

  // ── WARNING ──

  // High DCFC utilization
  if (dcfcUtil > 0.85) {
    if (highUtilDcfcStart === null) highUtilDcfcStart = simTime;
    else if (simTime - highUtilDcfcStart >= 600) {
      addAlert({
        timestamp: simTime,
        severity: 'warning',
        title: 'High DCFC Utilization',
        message: `DCFC utilization at ${Math.round(dcfcUtil * 100)}% for 10+ minutes. Consider adding DCFC stalls or adjusting scheduling.`,
      });
    }
  } else {
    highUtilDcfcStart = null;
  }

  // High L2 utilization
  if (l2Util > 0.85) {
    if (highUtilL2Start === null) highUtilL2Start = simTime;
    else if (simTime - highUtilL2Start >= 600) {
      addAlert({
        timestamp: simTime,
        severity: 'warning',
        title: 'High L2 Utilization',
        message: `L2 utilization at ${Math.round(l2Util * 100)}% for 10+ minutes. Queue delays likely increasing.`,
      });
    }
  } else {
    highUtilL2Start = null;
  }

  // Fleet block incoming
  const blockStartSec = timeToSeconds(config.dcfcBlockStart);
  const timeTillBlock = blockStartSec - simTime;
  if (timeTillBlock > 0 && timeTillBlock <= 900) {
    const availDcfc = dcfcStalls.filter((s) => s.status === 'available').length;
    if (availDcfc < Math.ceil(config.activeFleetSize * 0.3)) {
      addAlert({
        timestamp: simTime,
        severity: 'warning',
        title: 'Fleet Block Incoming',
        message: `Fleet DCFC block starts in ${Math.round(timeTillBlock / 60)} min. Only ${availDcfc} DCFC stalls available — may not meet fleet demand.`,
      });
    }
  }

  // Weather impact
  if (config.weather !== 'Clear' && !weatherAlerted) {
    weatherAlerted = true;
    addAlert({
      timestamp: simTime,
      severity: 'warning',
      title: 'Weather Impact',
      message: `${config.weather} conditions detected. Service times increased by ~20%. Outdoor operations may be affected.`,
    });
  }
  if (config.weather === 'Clear') weatherAlerted = false;

  // Staff shortage
  if (servicingCount > config.staffingLevel * 3) {
    addAlert({
      timestamp: simTime,
      severity: 'warning',
      title: 'Staff Shortage',
      message: `${servicingCount} vehicles in service with only ${config.staffingLevel} staff (ratio ${(servicingCount / config.staffingLevel).toFixed(1)}:1). Service delays expected.`,
    });
  }

  // ── INFO ──

  // BESS discharge start
  if (kpis.bessSOC < 95 && kpis.bessSOC > 10 && isPeak && totalPowerKW > utilityLimitKW * 0.8) {
    addAlert({
      timestamp: simTime,
      severity: 'info',
      title: 'BESS Discharging',
      message: `Battery storage discharging for peak shaving. Current SoC: ${kpis.bessSOC.toFixed(1)}%.`,
    });
  }
}

export function resetAlertEngine() {
  queueOverflowStart = null;
  highUtilDcfcStart = null;
  highUtilL2Start = null;
  weatherAlerted = false;
  lastFailureCheckTime = 0;
}
