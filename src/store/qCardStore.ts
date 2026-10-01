// ============================================================================
// qCardStore — which car's Q card is open. A VIEW choice, like the camera follow
// (cameraFollow.ts): it lives beside the renderer and never in the twin's stores.
// Set by a tap or click on a car in the 2D or 3D view; cleared by the card's ✕,
// a tap on open ground, or the car leaving the roster.
// ============================================================================
import { create } from 'zustand';

interface QCardState {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useQCard = create<QCardState>((set) => ({
  openId: null,
  open: (openId) => set({ openId }),
  close: () => set({ openId: null }),
}));
