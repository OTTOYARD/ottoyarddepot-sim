import { create } from 'zustand';

export interface EnergyDataPoint {
  time: number; // simTime in seconds
  dcfc: number;
  l2: number;
  building: number;
  bessDischarge: number;
  utilityLimit: number;
}

export interface KPIState {
  fleetUptimePct: number;
  avgTurnaroundMin: number;
  turnaroundSum: number;
  turnaroundCount: number;
  dcfcUtilization: number;
  l2Utilization: number;
  avgQueueWaitMin: number;
  queueWaitHistory: number[];
  revenuePerBayPerHour: number;
  energyTimeSeries: EnergyDataPoint[];
  lastEnergySnapshotTime: number;
  vehiclesProcessed: number;
  bessSOC: number;
  solarSelfConsumption: number;
  ottoQAccuracy: number;
  serviceCompletionRate: number;
  bayIdleTime: { dcfc: number; l2: number; wash: number };
  peakQueueDepth: number;
  peakPowerDraw: number;
  costPerVehicle: number;
  monthlyEBITDA: number;
  paybackYears: number;
  revenuePerMember: number;
  energyCostPerKwh: number;
  maintenanceScore: number;
  carbonOffsetKg: number;

  updateKPIs: (data: Partial<KPIState>) => void;
  pushEnergyDataPoint: (point: EnergyDataPoint) => void;
  recordDeparture: (turnaroundSeconds: number) => void;
  reset: () => void;
}

const initialState = {
  fleetUptimePct: 0,
  avgTurnaroundMin: 0,
  turnaroundSum: 0,
  turnaroundCount: 0,
  dcfcUtilization: 0,
  l2Utilization: 0,
  avgQueueWaitMin: 0,
  queueWaitHistory: [] as number[],
  revenuePerBayPerHour: 0,
  energyTimeSeries: [] as EnergyDataPoint[],
  lastEnergySnapshotTime: -1,
  vehiclesProcessed: 0,
  bessSOC: 100,
  solarSelfConsumption: 0,
  ottoQAccuracy: 0,
  serviceCompletionRate: 0,
  bayIdleTime: { dcfc: 0, l2: 0, wash: 0 },
  costPerVehicle: 0,
  monthlyEBITDA: 0,
  paybackYears: 0,
  revenuePerMember: 0,
  energyCostPerKwh: 0,
  maintenanceScore: 85,
  carbonOffsetKg: 0,
};

export const useKPIStore = create<KPIState>((set) => ({
  ...initialState,
  updateKPIs: (data) => set((s) => ({ ...s, ...data })),
  pushEnergyDataPoint: (point) =>
    set((s) => ({
      energyTimeSeries: [...s.energyTimeSeries.slice(-287), point],
    })),
  recordDeparture: (turnaroundSeconds) =>
    set((s) => {
      const newSum = s.turnaroundSum + turnaroundSeconds;
      const newCount = s.turnaroundCount + 1;
      return {
        turnaroundSum: newSum,
        turnaroundCount: newCount,
        avgTurnaroundMin: newSum / newCount / 60,
      };
    }),
  reset: () => set({ ...initialState }),
}));
