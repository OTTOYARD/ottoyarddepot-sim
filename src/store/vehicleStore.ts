import { create } from 'zustand';
import type { Vehicle } from '@/engine/types';

interface VehicleState {
  vehicles: Vehicle[];
  vehiclesProcessed: number;
  queueDepth: number;
  addVehicle: (v: Vehicle) => void;
  removeVehicle: (id: string) => void;
  setVehicles: (vehicles: Vehicle[]) => void;
  incrementProcessed: () => void;
  setQueueDepth: (n: number) => void;
  reset: () => void;
}

export const useVehicleStore = create<VehicleState>((set) => ({
  vehicles: [],
  vehiclesProcessed: 0,
  queueDepth: 0,
  addVehicle: (v) => set((s) => ({ vehicles: [...s.vehicles, v] })),
  removeVehicle: (id) => set((s) => ({ vehicles: s.vehicles.filter((v) => v.id !== id) })),
  setVehicles: (vehicles) => set({ vehicles }),
  incrementProcessed: () => set((s) => ({ vehiclesProcessed: s.vehiclesProcessed + 1 })),
  setQueueDepth: (n) => set({ queueDepth: n }),
  reset: () => set({ vehicles: [], vehiclesProcessed: 0, queueDepth: 0 }),
}));
