import { create } from 'zustand';
import { BUDGETS, type Tier } from './tiers';

/**
 * Which render tier the 3D view is drawing at, and why.
 *
 * `mode` is what the viewer asked for ('auto' unless they picked a tier);
 * `tier` is what is actually drawn. In auto the tier starts from the device
 * probe (detectTier) and the frame-rate governor may step it down (and back up,
 * never past the probe's ceiling). A pick is honoured as-is and kept per
 * browser, because a presenter who chose High for a demo does not want the
 * governor to overrule them.
 */
export type QualityMode = 'auto' | Tier;

interface QualityState {
  mode: QualityMode;
  tier: Tier;
  /** The highest tier auto may climb back to (the device probe's verdict). */
  ceiling: Tier;
  reason: string;
  setMode: (m: QualityMode) => void;
  setTier: (t: Tier, reason: string) => void;
  setCeiling: (t: Tier, reason: string) => void;
}

const KEY = 'ottoq_quality';

function storedMode(): QualityMode {
  try {
    const q = new URLSearchParams(window.location.search).get('quality');
    const v = q ?? window.localStorage.getItem(KEY);
    if (v === 'high' || v === 'medium' || v === 'low' || v === 'auto') return v;
  } catch { /* storage blocked: auto */ }
  return 'auto';
}

export const useQualityStore = create<QualityState>((set) => ({
  mode: typeof window === 'undefined' ? 'auto' : storedMode(),
  tier: 'high',
  ceiling: 'high',
  reason: 'default',
  setMode: (mode) => {
    try { window.localStorage.setItem(KEY, mode); } catch { /* per-viewer convenience only */ }
    set((s) => (mode === 'auto' ? { mode, tier: s.ceiling, reason: 'auto: device probe' } : { mode, tier: mode, reason: 'picked' }));
  },
  setTier: (tier, reason) => set({ tier, reason }),
  setCeiling: (ceiling, reason) => set((s) => (s.mode === 'auto' ? { ceiling, tier: ceiling, reason } : { ceiling })),
}));

/** The budget of the tier being drawn, as a hook (re-renders only on a tier change). */
export function useTierBudget() {
  return BUDGETS[useQualityStore((s) => s.tier)];
}
