// ============================================================================
// twinStore — backend-fed state (source of truth for the Command Center).
// The old client-engine stores remain for the optional offline-demo mode;
// the live cockpit reads from here.
// ============================================================================
import { create } from "zustand";
import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";

export interface EnergyPoint {
  t: number;        // tick_count
  grid: number;     // net grid kW (import positive, export negative)
  solar: number;
  bess: number;     // discharge positive
  ev: number;       // charger load
  building: number;
  lmp: number;
}

interface TwinState {
  activeSimRunId: string | null;
  layout: TwinLayout | null;
  snapshot: TwinSnapshot | null;
  connected: boolean;
  lastFrameAt: number | null;   // Date.now() of last successful snapshot
  offlineDemo: boolean;         // when true, fall back to the legacy client engine
  energyHistory: EnergyPoint[]; // rolling buffer accumulated from snapshots (KPI chart)

  setActiveSimRunId: (id: string | null) => void;
  setLayout: (layout: TwinLayout | null) => void;
  setSnapshot: (snap: TwinSnapshot | null) => void;
  setConnected: (c: boolean) => void;
  setOfflineDemo: (v: boolean) => void;
  reset: () => void;
}

export const useTwinStore = create<TwinState>((set) => ({
  activeSimRunId: null,
  layout: null,
  snapshot: null,
  connected: false,
  lastFrameAt: null,
  offlineDemo: false,
  energyHistory: [],

  setActiveSimRunId: (activeSimRunId) =>
    set({ activeSimRunId, energyHistory: [] }),   // fresh chart per run
  setLayout: (layout) => set({ layout }),
  setSnapshot: (snapshot) =>
    set((s) => {
      const e = (snapshot?.energy ?? null) as Record<string, number> | null;
      let energyHistory = s.energyHistory;
      if (e && snapshot?.run) {
        const t = Number(snapshot.run.tick_count ?? 0);
        // only append on a new tick (dedupe repeated polls of the same frame)
        if (!energyHistory.length || energyHistory[energyHistory.length - 1].t !== t) {
          const pt: EnergyPoint = {
            t,
            grid: (Number(e.grid_import_kw) || 0) - (Number(e.grid_export_kw) || 0),
            solar: Number(e.solar_kw) || 0,
            bess: Number(e.bess_output_kw) || 0,
            ev: Number(e.ev_charging_kw) || 0,
            building: Number(e.building_kw) || 0,
            lmp: Number((snapshot.grid as Record<string, number>)?.lmp_usd_mwh) || 0,
          };
          energyHistory = [...s.energyHistory.slice(-71), pt];
        }
      }
      return { snapshot, lastFrameAt: Date.now(), energyHistory };
    }),
  setConnected: (connected) => set({ connected }),
  setOfflineDemo: (offlineDemo) => set({ offlineDemo }),
  reset: () => set({ activeSimRunId: null, layout: null, snapshot: null, connected: false, lastFrameAt: null, energyHistory: [] }),
}));
