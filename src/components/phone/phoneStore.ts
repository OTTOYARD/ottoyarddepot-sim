import { create } from 'zustand';
import type { SheetSnap } from './phoneLayout';

/**
 * The panel sheet's state, shared so the run bar's "More options in Control" can open it.
 *   snap        the floating sheet's height (landscape): peek, half or full.
 *   fullscreen  the sheet covers the whole screen, run bar and live view included, in
 *               either orientation (the toggle at the end of its tab row). Leaving it
 *               returns the sheet to the snap it had.
 */
export const usePhoneSheet = create<{
  snap: SheetSnap;
  setSnap: (s: SheetSnap) => void;
  fullscreen: boolean;
  setFullscreen: (on: boolean) => void;
  toggleFullscreen: () => void;
}>((set) => ({
  snap: 'peek',
  setSnap: (snap) => set({ snap }),
  fullscreen: false,
  setFullscreen: (fullscreen) => set({ fullscreen }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
}));
