// ============================================================================
// cockpitStore — the "View in" switcher's own UI state: which cockpit, if any, is
// open side by side, and which fleet owner OrchestrAV opens as. Presentation only;
// no world state lives here. The owner is remembered per browser as a convenience.
// ============================================================================
import { create } from 'zustand';
import type { Cockpit } from '@/lib/cockpitLinks';

const OWNER_KEY = 'ottoq_view_in_owner';

const readOwner = (): string | null => {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
};

interface CockpitState {
  /** The cockpit shown beside the depot, or null when the depot fills the view. */
  panel: Cockpit | null;
  owner: string | null;
  setPanel: (c: Cockpit | null) => void;
  setOwner: (id: string | null) => void;
}

export const useCockpitStore = create<CockpitState>((set) => ({
  panel: null,
  owner: readOwner(),
  setPanel: (panel) => set({ panel }),
  setOwner: (owner) => {
    try {
      if (owner) localStorage.setItem(OWNER_KEY, owner);
      else localStorage.removeItem(OWNER_KEY);
    } catch { /* private window: keep it for this session only */ }
    set({ owner });
  },
}));
