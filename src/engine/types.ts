export type ServiceType = 'dcfc_charge' | 'l2_charge' | 'exterior_wash' | 'interior_detail' | 'maintenance' | 'staging';

export type VehicleStatus =
  | 'approaching'
  | 'queued'
  | 'charging'
  | 'washing'
  | 'detailing'
  | 'maintenance'
  | 'staging'
  | 'departing';

export type VehicleType = 'fleet' | 'core' | 'concierge' | 'elite';

export interface Vehicle {
  id: string;
  type: VehicleType;
  priority: number; // 1-10
  batteryCapacity: number; // kWh
  currentSoC: number; // 0-100
  targetSoC: number; // 80-100
  status: VehicleStatus;
  assignedStall: string | null;
  serviceQueue: ServiceType[];
  currentServiceIndex: number;
  serviceStartTime: number | null; // simTime when service started
  serviceDuration: number | null; // seconds of sim-time for current service
  arrivalTime: number; // simTime
  position: { x: number; y: number };
  targetPosition: { x: number; y: number } | null;
  waypoints?: { x: number; y: number }[];
  oem?: string; // backend platform (waymo|tesla|zoox|…) for OEM-colored rendering
}

export const SERVICE_TO_STALL_TYPE: Record<ServiceType, string> = {
  dcfc_charge: 'dcfc',
  l2_charge: 'l2',
  exterior_wash: 'wash',
  interior_detail: 'wash',
  maintenance: 'wash',
  staging: 'staging',
};

export const INGRESS = { x: 100, y: 215 };
export const EGRESS = { x: 200, y: 215 };
export const QUEUE_Y = 185;

export type ScoringFn = (vehicle: Vehicle, simTime: number) => number;
