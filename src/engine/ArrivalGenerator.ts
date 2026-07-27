import type { Vehicle, ServiceType, VehicleType } from './types';
import { INGRESS } from './types';
import type { SimulationConfig } from '@/store/simulationStore';
import { demoRandom } from './rng';

let _nextId = 1;

function timeToSeconds(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 3600 + m * 60;
}

// All randomness routes through the seeded demo generator, so a run is
// reproducible from its seed. See src/engine/rng.ts.
function rand(min: number, max: number) {
  return demoRandom().range(min, max);
}

function pickConsumerType(config: SimulationConfig): VehicleType {
  const r = demoRandom().next() * 100;
  if (r < config.tierElite) return 'elite';
  if (r < config.tierElite + config.tierConcierge) return 'concierge';
  return 'core';
}

function buildServiceQueue(type: VehicleType, soc: number, config: SimulationConfig): ServiceType[] {
  const queue: ServiceType[] = [];
  if (type === 'fleet') {
    // Fleet: low SoC → DCFC, higher SoC → L2 (they have more time)
    queue.push(soc <= 40 ? 'dcfc_charge' : 'l2_charge');
    if (demoRandom().chance(0.4)) queue.push('exterior_wash');
    if (demoRandom().chance(0.1)) queue.push('maintenance');
    queue.push('staging');
  } else {
    // Consumer: use config-driven DCFC/L2 ratio
    queue.push(demoRandom().next() * 100 < config.dcfcVsL2Ratio ? 'dcfc_charge' : 'l2_charge');
    if (demoRandom().chance(0.25)) queue.push('exterior_wash');
    if (demoRandom().chance(0.1)) queue.push('interior_detail');
  }
  return queue;
}

function createVehicle(type: VehicleType, simTime: number, config: SimulationConfig): Vehicle {
  const isFleet = type === 'fleet';
  const rng = demoRandom();
  const priority = isFleet ? rng.int(7, 10) :
    type === 'elite' ? rng.int(6, 8) :
    type === 'concierge' ? rng.int(4, 6) :
    rng.int(1, 4);

  return {
    id: `V-${String(_nextId++).padStart(4, '0')}`,
    type,
    priority,
    batteryCapacity: config.avgBatteryCapacity + rand(-15, 15),
    currentSoC: Math.max(5, Math.min(95, isFleet
      ? config.avgBatterySocArrival + rand(-10, 10)
      : config.consumerAvgSoc + rand(-10, 10))),
    targetSoC: config.targetSocDeparture,
    status: 'approaching',
    assignedStall: null,
    serviceQueue: buildServiceQueue(type, isFleet
      ? config.avgBatterySocArrival + rand(-10, 10)
      : config.consumerAvgSoc + rand(-10, 10), config),
    currentServiceIndex: 0,
    serviceStartTime: null,
    serviceDuration: null,
    arrivalTime: simTime,
    position: { ...INGRESS },
    targetPosition: null,
  };
}

export function resetArrivalGenerator() {
  _nextId = 1;
}

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

  const fleetWindow = pattern === 'Overnight Batch'
    ? 4 * 3600
    : pattern === 'Staggered Blocks'
      ? Math.max(blockEnd - blockStart, 3600)
      : 86400;

  const fleetRate = config.activeFleetSize / fleetWindow;
  const consumerWindow = config.consumerArrivalDist === 'Uniform' ? 86400 : 6 * 3600;
  const consumerRate = config.activeConsumerMembers / consumerWindow;

  // Fleet spawns
  let shouldSpawnFleet = false;
  if (pattern === 'Staggered Blocks') {
    shouldSpawnFleet = simTime >= blockStart && simTime <= blockEnd;
  } else if (pattern === 'Overnight Batch') {
    shouldSpawnFleet = simTime >= 79200 || simTime <= 7200;
  } else if (pattern === 'Continuous') {
    shouldSpawnFleet = true;
  }

  if (shouldSpawnFleet && demoRandom().chance(fleetRate * deltaSeconds)) {
    arrivals.push(createVehicle('fleet', simTime, config));
  }

  // Consumer spawns
  let consumerActive = true;
  if (config.consumerArrivalDist === 'Morning Rush') {
    consumerActive = simTime >= 25200 && simTime <= 36000;
  } else if (config.consumerArrivalDist === 'Midday') {
    consumerActive = simTime >= 36000 && simTime <= 50400;
  } else if (config.consumerArrivalDist === 'Evening') {
    consumerActive = simTime >= 54000 && simTime <= 75600;
  }

  if (consumerActive && config.activeConsumerMembers > 0 && demoRandom().chance(consumerRate * deltaSeconds)) {
    arrivals.push(createVehicle(pickConsumerType(config), simTime, config));
  }

  return arrivals;
}
