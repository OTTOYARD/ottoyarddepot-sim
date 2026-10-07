import { create } from 'zustand';
import { generateStallsV2 } from '@/lib/sitePlan';
import type { ChargerDown } from '@/lib/chargerFaults';

export type StallType = 'dcfc' | 'l2' | 'wash' | 'staging' | 'service';
export type StallStatus = 'available' | 'occupied' | 'charging' | 'servicing' | 'offline' | 'reserved';

export interface StallState {
  id: string;
  type: StallType;
  status: StallStatus;
  vehicleId: string | null;
  position: { x: number; y: number; angle: number };
  /** Why the TWIN has this stall out of use (a faulted charger, or the twin's 'offline'), as the motion driver read it
   *  from the snapshot. Such a stall is drawn with status 'offline'. Absent or null: the twin reports nothing. A stall
   *  the renderer paints offline for its own reason (a car awaiting a tow on it) carries no `down`. */
  down?: ChargerDown | null;
}

interface DepotState {
  dcfcCount: number;
  l2Count: number;
  washBayCount: number;
  stagingCount: number;
  serviceBayCount: number;
  stalls: StallState[];
  selectedStallId: string | null;
  hoveredStallId: string | null;
  setStallStatus: (id: string, status: StallStatus) => void;
  setStallDown: (id: string, down: ChargerDown | null) => void;
  selectStall: (id: string | null) => void;
  setHoveredStall: (id: string | null) => void;
  regenerateStalls: (dcfc: number, l2: number, wash: number, staging: number, service?: number) => void;
}

// All stall geometry comes from the shared site plan (src/lib/sitePlan.ts) —
// the engine, the 2D SVG, the 3D scene, and any future renderer consume the
// same coordinates so layout can never drift between layers.
function generateStalls(dcfcCount = 10, l2Count = 30, washCount = 3, stagingCount = 115, serviceCount = 2): StallState[] {
  return generateStallsV2(dcfcCount, l2Count, washCount, stagingCount, serviceCount);
}

export const useDepotStore = create<DepotState>((set) => ({
  dcfcCount: 10,
  l2Count: 30,
  washBayCount: 3,
  stagingCount: 115,
  serviceBayCount: 2,
  stalls: generateStalls(),
  selectedStallId: null,
  hoveredStallId: null,
  setStallStatus: (id, status) =>
    set((s) => ({
      stalls: s.stalls.map((st) => (st.id === id ? { ...st, status } : st)),
    })),
  setStallDown: (id, down) =>
    set((s) => ({
      stalls: s.stalls.map((st) => (st.id === id ? { ...st, down } : st)),
    })),
  selectStall: (id) => set({ selectedStallId: id }),
  setHoveredStall: (id) => set({ hoveredStallId: id }),
  regenerateStalls: (dcfc, l2, wash, staging, service = 2) =>
    set({
      dcfcCount: dcfc,
      l2Count: l2,
      washBayCount: wash,
      stagingCount: staging,
      serviceBayCount: service,
      stalls: generateStalls(dcfc, l2, wash, staging, service),
      selectedStallId: null,
      hoveredStallId: null,
    }),
}));
