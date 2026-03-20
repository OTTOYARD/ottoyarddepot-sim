import { create } from 'zustand';

interface AIState {
  runSummary: string | null;
  isLoadingSummary: boolean;
  apiCallCount: number;
  error: string | null;
  lastRealCallTime: number;

  setRunSummary: (summary: string | null) => void;
  setLoadingSummary: (v: boolean) => void;
  incrementCallCount: () => void;
  setError: (e: string | null) => void;
  setLastRealCallTime: (t: number) => void;
  reset: () => void;
}

export const useAIStore = create<AIState>((set) => ({
  runSummary: null,
  isLoadingSummary: false,
  apiCallCount: 0,
  error: null,
  lastRealCallTime: 0,

  setRunSummary: (summary) => set({ runSummary: summary }),
  setLoadingSummary: (v) => set({ isLoadingSummary: v }),
  incrementCallCount: () => set((s) => ({ apiCallCount: s.apiCallCount + 1 })),
  setError: (e) => set({ error: e }),
  setLastRealCallTime: (t) => set({ lastRealCallTime: t }),
  reset: () =>
    set({
      runSummary: null,
      isLoadingSummary: false,
      apiCallCount: 0,
      error: null,
      lastRealCallTime: 0,
    }),
}));
