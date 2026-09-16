// activityFeedStore — Zustand store for ottoq_activity_feed rows.
import { create } from "zustand";

export interface ActivityFeedRow {
  occurred_at: string;
  vehicle_id: string;
  display_name: string;
  action: string;
  engine: string;
  target: string;
  outcome: string;
  rationale: Record<string, unknown> | null;
  reason: string | null;
}

interface State {
  rows: ActivityFeedRow[];
  error: string | null;
  setRows: (rows: ActivityFeedRow[]) => void;
  setError: (err: string | null) => void;
}

export const useActivityFeedStore = create<State>((set) => ({
  rows: [],
  error: null,
  setRows: (rows) => set({ rows, error: null }),
  setError: (error) => set({ error }),
}));
