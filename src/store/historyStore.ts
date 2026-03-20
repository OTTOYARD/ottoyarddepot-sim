import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export interface SimulationRun {
  id: string;
  created_at: string;
  name: string | null;
  duration_seconds: number | null;
  config: Record<string, unknown> | null;
  kpi_results: Record<string, unknown> | null;
  ai_summary: string | null;
  vehicles_processed: number | null;
  avg_turnaround_minutes: number | null;
  peak_queue_depth: number | null;
  peak_power_draw_kw: number | null;
  alert_count_critical: number | null;
  alert_count_warning: number | null;
  alert_count_info: number | null;
}

interface HistoryState {
  runs: SimulationRun[];
  selectedForCompare: string[];
  compareMode: boolean;
  isLoading: boolean;
  error: string | null;
  fetchRuns: () => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
  renameRun: (id: string, name: string) => Promise<void>;
  toggleCompare: (id: string) => void;
  setCompareMode: (mode: boolean) => void;
  reset: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  runs: [],
  selectedForCompare: [],
  compareMode: false,
  isLoading: false,
  error: null,

  fetchRuns: async () => {
    set({ isLoading: true, error: null });
    const { data, error } = await supabase
      .from('simulation_runs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      set({ isLoading: false, error: error.message });
    } else {
      set({ runs: (data as unknown as SimulationRun[]) ?? [], isLoading: false });
    }
  },

  deleteRun: async (id) => {
    await supabase.from('simulation_runs').delete().eq('id', id);
    set((s) => ({
      runs: s.runs.filter((r) => r.id !== id),
      selectedForCompare: s.selectedForCompare.filter((sid) => sid !== id),
    }));
  },

  renameRun: async (id, name) => {
    await supabase.from('simulation_runs').update({ name } as never).eq('id', id);
    set((s) => ({
      runs: s.runs.map((r) => (r.id === id ? { ...r, name } : r)),
    }));
  },

  toggleCompare: (id) =>
    set((s) => {
      const sel = s.selectedForCompare.includes(id)
        ? s.selectedForCompare.filter((sid) => sid !== id)
        : s.selectedForCompare.length < 2
          ? [...s.selectedForCompare, id]
          : s.selectedForCompare;
      return { selectedForCompare: sel };
    }),

  setCompareMode: (compareMode) => set({ compareMode }),

  reset: () => set({ runs: [], selectedForCompare: [], compareMode: false, isLoading: false, error: null }),
}));
