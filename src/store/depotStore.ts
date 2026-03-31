import { create } from 'zustand';

export type StallType = 'dcfc' | 'l2' | 'wash' | 'staging' | 'service';
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
  serviceBayCount: number;
  stalls: StallState[];
  selectedStallId: string | null;
  hoveredStallId: string | null;
  setStallStatus: (id: string, status: StallStatus) => void;
  selectStall: (id: string | null) => void;
  setHoveredStall: (id: string | null) => void;
  regenerateStalls: (dcfc: number, l2: number, wash: number, staging: number, service?: number) => void;
}

function generateStalls(dcfcCount = 10, l2Count = 40, washCount = 3, stagingCount = 50, serviceCount = 2): StallState[] {
  const stalls: StallState[] = [];
  const angle = 60;

  for (let i = 0; i < dcfcCount; i++) {
    stalls.push({
      id: `DCFC-${String(i + 1).padStart(2, '0')}`,
      type: 'dcfc',
      status: 'available',
      vehicleId: null,
      position: { x: 45 + i * Math.min(22, 200 / dcfcCount), y: 57, angle },
    });
  }

  const l2Rows = [85, 105, 125, 145];
  const l2PerRow = Math.ceil(l2Count / 4);
  let l2Idx = 0;
  for (let row = 0; row < 4 && l2Idx < l2Count; row++) {
    for (let col = 0; col < l2PerRow && l2Idx < l2Count; col++) {
      l2Idx++;
      stalls.push({
        id: `L2-${String(l2Idx).padStart(2, '0')}`,
        type: 'l2',
        status: 'available',
        vehicleId: null,
        position: { x: 45 + col * Math.min(22, 200 / l2PerRow), y: l2Rows[row], angle },
      });
    }
  }

  for (let i = 0; i < washCount; i++) {
    stalls.push({
      id: `WASH-${String(i + 1).padStart(2, '0')}`,
      type: 'wash',
      status: 'available',
      vehicleId: null,
      position: { x: 15 + i * 16, y: 20, angle: 0 },
    });
  }

  // U-shaped perimeter staging: west side → south edge → east side
  const westCount = Math.round(stagingCount * 0.26);
  const eastCount = Math.round(stagingCount * 0.26);
  const southCount = stagingCount - westCount - eastCount;
  let stageIdx = 0;

  // West side: x≈25, y from 50 down to 195
  for (let i = 0; i < westCount; i++) {
    stageIdx++;
    const yPos = 50 + (i / Math.max(westCount - 1, 1)) * 145;
    stalls.push({
      id: `STAGE-${String(stageIdx).padStart(2, '0')}`,
      type: 'staging',
      status: 'available',
      vehicleId: null,
      position: { x: 25, y: yPos, angle: 0 },
    });
  }

  // South edge: y≈195, x from 25 to 275 (rectangles, shifted up above ingress/egress)
  for (let i = 0; i < southCount; i++) {
    stageIdx++;
    const xPos = 25 + (i / Math.max(southCount - 1, 1)) * 250;
    stalls.push({
      id: `STAGE-${String(stageIdx).padStart(2, '0')}`,
      type: 'staging',
      status: 'available',
      vehicleId: null,
      position: { x: xPos, y: 195, angle: 0 },
    });
  }

  // East side: x≈275, y from 195 up to 50
  for (let i = 0; i < eastCount; i++) {
    stageIdx++;
    const yPos = 195 - (i / Math.max(eastCount - 1, 1)) * 145;
    stalls.push({
      id: `STAGE-${String(stageIdx).padStart(2, '0')}`,
      type: 'staging',
      status: 'available',
      vehicleId: null,
      position: { x: 275, y: yPos, angle: 0 },
    });
  }

  for (let i = 0; i < serviceCount; i++) {
    stalls.push({
      id: `SVC-${String(i + 1).padStart(2, '0')}`,
      type: 'service',
      status: 'available',
      vehicleId: null,
      position: { x: 235 + i * 20, y: 10, angle: 0 },
    });
  }

  return stalls;
}

export const useDepotStore = create<DepotState>((set) => ({
  dcfcCount: 10,
  l2Count: 40,
  washBayCount: 3,
  stagingCount: 50,
  serviceBayCount: 2,
  stalls: generateStalls(),
  selectedStallId: null,
  hoveredStallId: null,
  setStallStatus: (id, status) =>
    set((s) => ({
      stalls: s.stalls.map((st) => (st.id === id ? { ...st, status } : st)),
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
