import { create } from 'zustand';
import { BUDGETS, minTier, rememberedTier, type Tier } from './tiers';

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
  /** The highest tier auto may climb to (the device probe's verdict, lowered for the
   *  session when a climb fails its probation). */
  ceiling: Tier;
  reason: string;
  setMode: (m: QualityMode) => void;
  setTier: (t: Tier, reason: string) => void;
  setCeiling: (t: Tier, reason: string) => void;
  /** The device probe's verdict: where auto starts and how high it may climb. */
  initAuto: (start: Tier, ceiling: Tier, reason: string) => void;
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

const initialMode: QualityMode = typeof window === 'undefined' ? 'auto' : storedMode();

export const useQualityStore = create<QualityState>((set) => ({
  mode: initialMode,
  // a picked tier is drawn from the start; auto's start comes from the probe (initAuto)
  tier: initialMode === 'auto' ? 'high' : initialMode,
  ceiling: 'high',
  reason: 'default',
  setMode: (mode) => {
    try { window.localStorage.setItem(KEY, mode); } catch { /* per-viewer convenience only */ }
    // back to auto: start where the device last held, never above the ceiling
    set((s) => (mode === 'auto'
      ? { mode, tier: minTier(rememberedTier() ?? s.ceiling, s.ceiling), reason: 'auto: device probe' }
      : { mode, tier: mode, reason: 'picked' }));
  },
  setTier: (tier, reason) => set({ tier, reason }),
  setCeiling: (ceiling, reason) => set((s) => (s.mode === 'auto' ? { ceiling, tier: ceiling, reason } : { ceiling })),
  initAuto: (start, ceiling, reason) => set((s) => (s.mode === 'auto' ? { ceiling, tier: start, reason } : { ceiling })),
}));

/** The budget of the tier being drawn, as a hook (re-renders only on a tier change). */
export function useTierBudget() {
  return BUDGETS[useQualityStore((s) => s.tier)];
}
