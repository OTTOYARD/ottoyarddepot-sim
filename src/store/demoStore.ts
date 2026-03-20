import { create } from 'zustand';

interface DemoState {
  isDemoMode: boolean;
  isLoading: boolean;
  isSaving: boolean;
  enterDemo: () => void;
  exitDemo: () => void;
  setLoading: (v: boolean) => void;
  setSaving: (v: boolean) => void;
}

export const useDemoStore = create<DemoState>((set) => ({
  isDemoMode: false,
  isLoading: false,
  isSaving: false,
  enterDemo: () => set({ isDemoMode: true }),
  exitDemo: () => set({ isDemoMode: false }),
  setLoading: (isLoading) => set({ isLoading }),
  setSaving: (isSaving) => set({ isSaving }),
}));
