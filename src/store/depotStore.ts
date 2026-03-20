import { create } from 'zustand';

export type StallType = 'dcfc' | 'l2' | 'wash' | 'staging';
export type StallStatus = 'available' | 'occupied' | 'charging' | 'servicing' | 'offline' | 'reserved';

export interface StallState {
  id: string;
  type: StallType;
  status: StallStatus;
  vehicleId: string | null;
  position: { x: number; y: number; angle: number };
}

interface DepotState {
  dcfcCount: number;
  l2Count: number;
  washBayCount: number;
  stagingCount: number;
  stalls: StallState[];
  selectedStallId: string | null;
  hoveredStallId: string | null;
  setStallStatus: (id: string, status: StallStatus) => void;
  selectStall: (id: string | null) => void;
  setHoveredStall: (id: string | null) => void;
}

function generateStalls(): StallState[] {
  const stalls: StallState[] = [];
  const angle = 60;

  // DCFC: 10 stalls, single row, y ~57, spread across x 40-260
  for (let i = 0; i < 10; i++) {
    stalls.push({
      id: `DCFC-${String(i + 1).padStart(2, '0')}`,
      type: 'dcfc',
      status: 'available',
      vehicleId: null,
      position: { x: 45 + i * 22, y: 57, angle },
    });
  }

  // L2: 40 stalls, 4 rows of 10, y rows at 85, 105, 125, 145
  const l2Rows = [85, 105, 125, 145];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 10; col++) {
      const idx = row * 10 + col + 1;
      stalls.push({
        id: `L2-${String(idx).padStart(2, '0')}`,
        type: 'l2',
        status: 'available',
        vehicleId: null,
        position: { x: 45 + col * 22, y: l2Rows[row], angle },
      });
    }
  }

  // Wash: 3 bays, right of building, y ~33
  for (let i = 0; i < 3; i++) {
    stalls.push({
      id: `WASH-${String(i + 1).padStart(2, '0')}`,
      type: 'wash',
      status: 'available',
      vehicleId: null,
      position: { x: 200 + i * 16, y: 33, angle: 0 },
    });
  }

  // Staging: 15 stalls, single row, y ~172
  for (let i = 0; i < 15; i++) {
    stalls.push({
      id: `STAGE-${String(i + 1).padStart(2, '0')}`,
      type: 'staging',
      status: 'available',
      vehicleId: null,
      position: { x: 25 + i * 17, y: 172, angle },
    });
  }

  return stalls;
}

export const useDepotStore = create<DepotState>((set) => ({
  dcfcCount: 10,
  l2Count: 40,
  washBayCount: 3,
  stagingCount: 15,
  stalls: generateStalls(),
  selectedStallId: null,
  hoveredStallId: null,
  setStallStatus: (id, status) =>
    set((s) => ({
      stalls: s.stalls.map((st) => (st.id === id ? { ...st, status } : st)),
    })),
  selectStall: (id) => set({ selectedStallId: id }),
  setHoveredStall: (id) => set({ hoveredStallId: id }),
}));
