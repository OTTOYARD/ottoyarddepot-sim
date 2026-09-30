import { create } from 'zustand';
import type { SheetSnap } from './phoneLayout';

/** The floating sheet's height, shared so the run bar's Start can open it. */
export const usePhoneSheet = create<{ snap: SheetSnap; setSnap: (s: SheetSnap) => void }>((set) => ({
  snap: 'peek',
  setSnap: (snap) => set({ snap }),
}));
