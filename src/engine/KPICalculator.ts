import type { Vehicle } from './types';
import type { SimulationConfig } from '@/store/simulationStore';
import type { StallState } from '@/store/depotStore';
import { useKPIStore } from '@/store/kpiStore';
import { demoRandom } from './rng';

const MONTHLY_OPEX = 106064;
const CAPEX = 3_200_000;
const BUILDING_LOAD_KW = 150;
const CO2_PER_KWH = 0.4; // kg

// Revenue per hour by vehicle type
const REVENUE_PER_HOUR: Record<string, number> = {
  fleet: 4.17,
  core: 0.21,
  concierge: 0.35,
  elite: 0.55,
};

export function calculateKPIs(
  vehicles: Vehicle[],
  config: SimulationConfig,
  stalls: StallState[],
  simTime: number,
  vehiclesProcessed: number,
) {
  const kpiStore = useKPIStore.getState();

  // Charger utilization
  const dcfcTotal = stalls.filter((s) => s.type === 'dcfc').length;
  const dcfcOccupied = stalls.filter((s) => s.type === 'dcfc' && s.status !== 'available').length;
  const l2Total = stalls.filter((s) => s.type === 'l2').length;
  const l2Occupied = stalls.filter((s) => s.type === 'l2' && s.status !== 'available').length;
  const washTotal = stalls.filter((s) => s.type === 'wash').length;
  const washOccupied = stalls.filter((s) => s.type === 'wash' && s.status !== 'available').length;

  const dcfcUtilization = dcfcTotal > 0 ? dcfcOccupied / dcfcTotal : 0;
  const l2Utilization = l2Total > 0 ? l2Occupied / l2Total : 0;
  const washUtilization = washTotal > 0 ? washOccupied / washTotal : 0;

  // Fleet uptime: vehicles staged at or above the DEPLOY FLOOR / total fleet.
  // Deliberately not the fill target. A charge fills to 100, but a car is
  // dispatch-ready at 90 — measuring readiness against 100 would report a car
  // that is perfectly deployable as not ready, and would drive uptime to zero
  // for any fleet sitting between the floor and full.
  const fleetVehicles = vehicles.filter((v) => v.type === 'fleet');
  const readyFleet = fleetVehicles.filter(
    (v) => v.status === 'staging' && v.currentSoC >= config.deployFloorSocPct,
  );
  const fleetUptimePct =
    fleetVehicles.length > 0 ? (readyFleet.length / fleetVehicles.length) * 100 : 100;

  // Queue wait time
  const queuedVehicles = vehicles.filter((v) => v.status === 'queued');
  const avgQueueWaitMin =
    queuedVehicles.length > 0
      ? queuedVehicles.reduce((sum, v) => {
          let wait = simTime - v.arrivalTime;
          if (wait < 0) wait += 86400;
          return sum + wait;
        }, 0) /
        queuedVehicles.length /
        60
      : 0;

  // Queue wait history (last 30 data points)
  const queueWaitHistory = [...kpiStore.queueWaitHistory.slice(-29), avgQueueWaitMin];

  // Revenue per bay per hour
  const totalStalls = stalls.length;
  const hoursElapsed = simTime / 3600;
  let totalRevenue = 0;
  for (const v of vehicles) {
    const rate = REVENUE_PER_HOUR[v.type] || 0;
    let timeInSystem = simTime - v.arrivalTime;
    if (timeInSystem < 0) timeInSystem += 86400;
    totalRevenue += rate * (timeInSystem / 3600);
  }
  // Add processed vehicles (assume avg 1hr each as approximation)
  totalRevenue += vehiclesProcessed * 2; // rough avg
  const revenuePerBayPerHour =
    totalStalls > 0 && hoursElapsed > 0 ? totalRevenue / totalStalls / hoursElapsed : 0;

  // Energy calculations
  const dcfcLoadKW = dcfcOccupied * config.dcfcPowerPerStall;
  const l2LoadKW = l2Occupied * config.l2PowerPerStall;
  const totalLoadKW = dcfcLoadKW + l2LoadKW + BUILDING_LOAD_KW;

  // BESS simulation
  const utilityLimitKW = config.utilityService * 1000;
  const solarOutputKW = config.solarCanopy * 0.15; // rough capacity factor
  let bessSOC = kpiStore.bessSOC;
  const bessMaxKW = config.bessPower * 1000;
  const bessCapacityKWh = config.bessCapacity * 1000;
  let bessDischargeKW = 0;

  if (totalLoadKW > utilityLimitKW && bessSOC > 5) {
    bessDischargeKW = Math.min(totalLoadKW - utilityLimitKW, bessMaxKW, (bessSOC / 100) * bessCapacityKWh);
    bessSOC = Math.max(0, bessSOC - (bessDischargeKW / bessCapacityKWh) * 0.1);
  } else if (totalLoadKW < utilityLimitKW * 0.7 && bessSOC < 100) {
    bessSOC = Math.min(100, bessSOC + 0.05);
  }

  // Solar self-consumption
  const solarSelfConsumption = totalLoadKW > 0 ? Math.min(100, (solarOutputKW / totalLoadKW) * 100) : 0;

  // Carbon offset
  const totalEnergyKWh = (dcfcLoadKW + l2LoadKW) * (hoursElapsed > 0 ? hoursElapsed : 1);
  const carbonOffsetKg = totalEnergyKWh * CO2_PER_KWH;

  // Bay idle time %
  const bayIdleTime = {
    dcfc: dcfcTotal > 0 ? ((dcfcTotal - dcfcOccupied) / dcfcTotal) * 100 : 100,
    l2: l2Total > 0 ? ((l2Total - l2Occupied) / l2Total) * 100 : 100,
    wash: washTotal > 0 ? ((washTotal - washOccupied) / washTotal) * 100 : 100,
  };

  // Cost per vehicle
  const costPerVehicle =
    vehiclesProcessed > 0 ? MONTHLY_OPEX / Math.max(vehiclesProcessed, 1) : 0;

  // Service completion rate
  const totalServices = vehicles.reduce((s, v) => s + v.serviceQueue.length, 0);
  const completedServices = vehicles.reduce((s, v) => s + v.currentServiceIndex, 0);
  const serviceCompletionRate = totalServices > 0 ? (completedServices / totalServices) * 100 : 0;

  // OTTO-Q accuracy (simulated metric based on queue efficiency)
  const ottoQAccuracy = Math.min(100, 85 + dcfcUtilization * 10 + l2Utilization * 5);

  // Financial projections
  const monthlyRevenueEstimate = revenuePerBayPerHour * totalStalls * 720; // 720 hours/month
  const monthlyEBITDA = monthlyRevenueEstimate - MONTHLY_OPEX;
  const annualEBITDA = monthlyEBITDA * 12;
  const paybackYears = annualEBITDA > 0 ? CAPEX / annualEBITDA : 99;

  // Revenue per member
  const activeMembers = config.activeConsumerMembers + config.activeFleetSize;
  const revenuePerMember = activeMembers > 0 ? monthlyRevenueEstimate / activeMembers : 0;

  // Energy cost per kWh
  const energyCostPerKwh = config.energyRate + config.demandCharge / Math.max(totalLoadKW, 1);

  // Maintenance score (slowly varies)
  const maintenanceScore = Math.max(
    0,
    Math.min(100, kpiStore.maintenanceScore + (demoRandom().next() - 0.5) * 0.5),
  );

  kpiStore.updateKPIs({
    fleetUptimePct,
    dcfcUtilization,
    l2Utilization,
    avgQueueWaitMin,
    queueWaitHistory,
    revenuePerBayPerHour,
    vehiclesProcessed,
    bessSOC,
    solarSelfConsumption,
    ottoQAccuracy,
    serviceCompletionRate,
    bayIdleTime,
    costPerVehicle,
    monthlyEBITDA,
    paybackYears,
    revenuePerMember,
    energyCostPerKwh,
    maintenanceScore,
    carbonOffsetKg,
  });

  // Push energy data point every 5 sim-minutes (300 seconds)
  if (
    kpiStore.lastEnergySnapshotTime < 0 ||
    simTime - kpiStore.lastEnergySnapshotTime >= 300 ||
    simTime < kpiStore.lastEnergySnapshotTime
  ) {
    kpiStore.pushEnergyDataPoint({
      time: simTime,
      dcfc: dcfcLoadKW,
      l2: l2LoadKW,
      building: BUILDING_LOAD_KW,
      bessDischarge: bessDischargeKW,
      utilityLimit: utilityLimitKW,
    });
    kpiStore.updateKPIs({ lastEnergySnapshotTime: simTime });
  }
}
