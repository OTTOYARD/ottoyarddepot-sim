import { create } from 'zustand';

interface SimulationState {
  status: 'idle' | 'running' | 'paused';
  simTime: number;
  simSpeed: number;
  isPanelOpen: boolean;
  activeTab: 'controls' | 'kpis' | 'ai-summary' | 'alerts' | 'history';
  setStatus: (status: SimulationState['status']) => void;
  togglePanel: () => void;
  setActiveTab: (tab: SimulationState['activeTab']) => void;
  setSimSpeed: (speed: number) => void;
  setSimTime: (time: number) => void;
  tick: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  status: 'idle',
  simTime: 50400, // 14:00:00
  simSpeed: 10,
  isPanelOpen: true,
  activeTab: 'controls',
  setStatus: (status) => set({ status }),
  togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),
  setActiveTab: (activeTab) => set({ activeTab }),
  setSimSpeed: (simSpeed) => set({ simSpeed }),
  setSimTime: (simTime) => set({ simTime: Math.max(0, Math.min(86399, simTime)) }),
  tick: () => set((s) => ({ simTime: (s.simTime + s.simSpeed) % 86400 })),
}));
