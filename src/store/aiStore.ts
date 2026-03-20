import { create } from 'zustand';

export interface Observation {
  simTime: string;
  text: string;
  timestamp: number;
}

interface AIState {
  observations: Observation[];
  runSummary: string | null;
  isLoadingObservation: boolean;
  isLoadingSummary: boolean;
  apiCallCount: number;
  error: string | null;
  lastObservationSimTime: number;
  lastRealCallTime: number;

  addObservation: (obs: Observation) => void;
  setRunSummary: (summary: string | null) => void;
  setLoadingObservation: (v: boolean) => void;
  setLoadingSummary: (v: boolean) => void;
  incrementCallCount: () => void;
  setError: (e: string | null) => void;
  setLastObservationSimTime: (t: number) => void;
  setLastRealCallTime: (t: number) => void;
  reset: () => void;
}

export const useAIStore = create<AIState>((set) => ({
  observations: [],
  runSummary: null,
  isLoadingObservation: false,
  isLoadingSummary: false,
  apiCallCount: 0,
  error: null,
  lastObservationSimTime: -1,
  lastRealCallTime: 0,

  addObservation: (obs) =>
    set((s) => ({ observations: [obs, ...s.observations].slice(0, 50) })),
  setRunSummary: (summary) => set({ runSummary: summary }),
  setLoadingObservation: (v) => set({ isLoadingObservation: v }),
  setLoadingSummary: (v) => set({ isLoadingSummary: v }),
  incrementCallCount: () => set((s) => ({ apiCallCount: s.apiCallCount + 1 })),
  setError: (e) => set({ error: e }),
  setLastObservationSimTime: (t) => set({ lastObservationSimTime: t }),
  setLastRealCallTime: (t) => set({ lastRealCallTime: t }),
  reset: () =>
    set({
      observations: [],
      runSummary: null,
      isLoadingObservation: false,
      isLoadingSummary: false,
      apiCallCount: 0,
      error: null,
      lastObservationSimTime: -1,
      lastRealCallTime: 0,
    }),
}));
