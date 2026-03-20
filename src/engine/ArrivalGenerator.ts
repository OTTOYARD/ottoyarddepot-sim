import type { Vehicle, ServiceType, VehicleType } from './types';
import { INGRESS } from './types';
import type { SimulationConfig } from '@/store/simulationStore';

let _nextId = 1;

function timeToSeconds(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 3600 + m * 60;
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pickConsumerType(config: SimulationConfig): VehicleType {
  const r = Math.random() * 100;
  if (r < config.tierElite) return 'elite';
  if (r < config.tierElite + config.tierConcierge) return 'concierge';
  return 'core';
}

function buildServiceQueue(type: VehicleType): ServiceType[] {
  const queue: ServiceType[] = [];
  if (type === 'fleet') {
    queue.push('dcfc_charge');
    if (Math.random() < 0.4) queue.push('exterior_wash');
    if (Math.random() < 0.1) queue.push('maintenance');
    queue.push('staging');
  } else {
    queue.push(Math.random() < 0.3 ? 'dcfc_charge' : 'l2_charge');
    if (Math.random() < 0.25) queue.push('exterior_wash');
    if (Math.random() < 0.1) queue.push('interior_detail');
  }
  return queue;
}

function createVehicle(type: VehicleType, simTime: number, config: SimulationConfig): Vehicle {
  const isFleet = type === 'fleet';
  const priority = isFleet ? 7 + Math.floor(Math.random() * 4) :
    type === 'elite' ? 6 + Math.floor(Math.random() * 3) :
    type === 'concierge' ? 4 + Math.floor(Math.random() * 3) :
    1 + Math.floor(Math.random() * 4);

  return {
    id: `V-${String(_nextId++).padStart(4, '0')}`,
    type,
    priority,
    batteryCapacity: config.avgBatteryCapacity + rand(-15, 15),
    currentSoC: isFleet
      ? config.avgBatterySocArrival + rand(-10, 10)
      : config.consumerAvgSoc + rand(-10, 10),
    targetSoC: config.targetSocDeparture,
    status: 'approaching',
    assignedStall: null,
    serviceQueue: buildServiceQueue(type),
    currentServiceIndex: 0,
    serviceStartTime: null,
    serviceDuration: null,
    arrivalTime: simTime,
    position: { ...INGRESS },
    targetPosition: null,
  };
}

/**
 * Determines how many vehicles should spawn this tick.
 * Returns an array of new Vehicle objects.
 */
export function generateArrivals(
  simTime: number,
  deltaSeconds: number,
  config: SimulationConfig,
  currentVehicleCount: number,
): Vehicle[] {
  const maxTotal = config.activeFleetSize + config.activeConsumerMembers;
  if (currentVehicleCount >= maxTotal) return [];

  const pattern = config.fleetArrivalPattern;
  const blockStart = timeToSeconds(config.dcfcBlockStart);
  const blockEnd = timeToSeconds(config.dcfcBlockEnd);
  const arrivals: Vehicle[] = [];

  // Fleet arrival rate: spread activeFleetSize arrivals over their window
  const fleetWindow = pattern === 'Overnight Batch'
    ? 4 * 3600 // 22:00-02:00
    : pattern === 'Staggered Blocks'
      ? Math.max(blockEnd - blockStart, 3600)
      : 86400; // Continuous = all day

  const fleetRate = config.activeFleetSize / fleetWindow; // vehicles per sim-second
  const consumerRate = config.activeConsumerMembers / 86400 * 2; // ~2x to fill faster

  // Fleet spawns
  let shouldSpawnFleet = false;
  if (pattern === 'Staggered Blocks') {
    shouldSpawnFleet = simTime >= blockStart && simTime <= blockEnd;
  } else if (pattern === 'Overnight Batch') {
    shouldSpawnFleet = simTime >= 79200 || simTime <= 7200; // 22:00-02:00
  } else if (pattern === 'Continuous') {
    shouldSpawnFleet = true;
  }

  if (shouldSpawnFleet && Math.random() < fleetRate * deltaSeconds) {
    arrivals.push(createVehicle('fleet', simTime, config));
  }

  // Consumer spawns (based on distribution)
  let consumerActive = true;
  if (config.consumerArrivalDist === 'Morning Rush') {
    consumerActive = simTime >= 25200 && simTime <= 36000; // 7-10am
  } else if (config.consumerArrivalDist === 'Midday') {
    consumerActive = simTime >= 36000 && simTime <= 50400; // 10am-2pm
  } else if (config.consumerArrivalDist === 'Evening') {
    consumerActive = simTime >= 54000 && simTime <= 75600; // 3-9pm
  }
  // Uniform = always active

  if (consumerActive && config.activeConsumerMembers > 0 && Math.random() < consumerRate * deltaSeconds) {
    arrivals.push(createVehicle(pickConsumerType(simTime, config), simTime, config));
  }

  return arrivals;
}

// Fix: pickConsumerType only takes config
function _unused() {} // replaced below
