// ============================================================================
// twinStore — backend-fed state (source of truth for the Command Center).
// The old client-engine stores remain for the optional offline-demo mode;
// the live cockpit reads from here.
// ============================================================================
import { create } from "zustand";
import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";

interface TwinState {
  activeSimRunId: string | null;
  layout: TwinLayout | null;
  snapshot: TwinSnapshot | null;
  connected: boolean;
  lastFrameAt: number | null;   // Date.now() of last successful snapshot
  offlineDemo: boolean;         // when true, fall back to the legacy client engine

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

  setActiveSimRunId: (activeSimRunId) => set({ activeSimRunId }),
  setLayout: (layout) => set({ layout }),
  setSnapshot: (snapshot) => set({ snapshot, lastFrameAt: Date.now() }),
  setConnected: (connected) => set({ connected }),
  setOfflineDemo: (offlineDemo) => set({ offlineDemo }),
  reset: () => set({ activeSimRunId: null, layout: null, snapshot: null, connected: false, lastFrameAt: null }),
}));
