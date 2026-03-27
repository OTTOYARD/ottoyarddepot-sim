import { create } from 'zustand';

export interface SimulationConfig {
  // Fleet
  activeFleetSize: number;
  fleetType: string;
  fleetArrivalPattern: string;
  fleetPriorityLevel: string;
  dcfcBlockStart: string;
  dcfcBlockEnd: string;
  avgBatterySocArrival: number;
  targetSocDeparture: number;
  avgBatteryCapacity: number;
  dcfcVsL2Ratio: number; // 0-100, percentage preferring DCFC

  // Consumer/VIP
  activeConsumerMembers: number;
  tierCore: number;
  tierConcierge: number;
  tierElite: number;
  consumerArrivalDist: string;
  consumerAvgSoc: number;
  vipOverrideFreq: number;
  conciergeRate: number;

  // Infrastructure
  dcfcCount: number;
  l2Count: number;
  dcfcPowerPerStall: number;
  l2PowerPerStall: number;
  washBayCount: number;
  stagingStalls: number;
  serviceBayCount: number;
  solarCanopy: number;
  bessCapacity: number;
  bessPower: number;
  utilityService: number;

  // Service Times
  dcfcChargeTime: number;
  l2ChargeTime: number;
  exteriorWash: number;
  interiorDetail: number;
  lightMaintenance: number;
  checkInTime: number;
  stallTransition: number;
  turnaroundMode: string;

  // Environment
  weather: string;
  congestionOverride: string;
  equipmentFailureRate: number;
  staffingLevel: number;
  ottoQAlgorithm: string;
  demandResponseMode: boolean;
  bessStrategy: string;
  energyRate: number;
  demandCharge: number;
}

interface SimulationState {
  status: 'idle' | 'running' | 'paused';
  simTime: number;
  simSpeed: number;
  isPanelOpen: boolean;
  activeTab: 'controls' | 'kpis' | 'ai-summary' | 'alerts' | 'history';
  config: SimulationConfig;
  viewMode: '2d' | '3d';
  controlsLocked: boolean;
  setStatus: (status: SimulationState['status']) => void;
  setViewMode: (mode: '2d' | '3d') => void;
  togglePanel: () => void;
  setActiveTab: (tab: SimulationState['activeTab']) => void;
  setSimSpeed: (speed: number) => void;
  setSimTime: (time: number) => void;
  tick: () => void;
  updateConfig: (partial: Partial<SimulationConfig>) => void;
  resetConfig: () => void;
  setControlsLocked: (locked: boolean) => void;
}

const defaultConfig: SimulationConfig = {
  activeFleetSize: 50,
  fleetType: 'Ride-hail',
  fleetArrivalPattern: 'Staggered Blocks',
  fleetPriorityLevel: 'Always Priority',
  dcfcBlockStart: '14:00',
  dcfcBlockEnd: '17:00',
  avgBatterySocArrival: 25,
  targetSocDeparture: 90,
  avgBatteryCapacity: 75,
  dcfcVsL2Ratio: 30,

  activeConsumerMembers: 100,
  tierCore: 65,
  tierConcierge: 25,
  tierElite: 10,
  consumerArrivalDist: 'Evening',
  consumerAvgSoc: 35,
  vipOverrideFreq: 5,
  conciergeRate: 3,

  dcfcCount: 10,
  l2Count: 40,
  dcfcPowerPerStall: 200,
  l2PowerPerStall: 11.5,
  washBayCount: 3,
  stagingStalls: 15,
  solarCanopy: 500,
  bessCapacity: 2,
  bessPower: 1,
  utilityService: 4,

  dcfcChargeTime: 25,
  l2ChargeTime: 4,
  exteriorWash: 10,
  interiorDetail: 30,
  lightMaintenance: 45,
  checkInTime: 2,
  stallTransition: 2,
  turnaroundMode: 'Standard',

  weather: 'Clear',
  congestionOverride: 'Medium',
  equipmentFailureRate: 2,
  staffingLevel: 4,
  ottoQAlgorithm: 'Priority-Weighted',
  demandResponseMode: false,
  bessStrategy: 'Peak Shave',
  energyRate: 0.12,
  demandCharge: 14,
};

export const useSimulationStore = create<SimulationState>((set) => ({
  status: 'idle',
  simTime: 50400,
  simSpeed: 10,
  isPanelOpen: true,
  activeTab: 'controls',
  config: { ...defaultConfig },
  viewMode: '2d',
  controlsLocked: false,
  setStatus: (status) => set({ status }),
  setViewMode: (mode) => set({ viewMode: mode }),
  togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),
  setActiveTab: (activeTab) => set({ activeTab }),
  setSimSpeed: (simSpeed) => set({ simSpeed }),
  setSimTime: (simTime) => set({ simTime: Math.max(0, Math.min(86399, simTime)) }),
  tick: () => set((s) => ({ simTime: (s.simTime + s.simSpeed) % 86400 })),
  updateConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),
  resetConfig: () => set({ config: { ...defaultConfig }, simSpeed: 10, status: 'idle', simTime: 50400, controlsLocked: false }),
  setControlsLocked: (controlsLocked) => set({ controlsLocked }),
}));
