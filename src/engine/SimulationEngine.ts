import { useSimulationStore } from '@/store/simulationStore';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useKPIStore } from '@/store/kpiStore';
import { generateArrivals, resetArrivalGenerator } from './ArrivalGenerator';
import { getScheduler } from './scheduling';
import { calculateKPIs } from './KPICalculator';
import { SERVICE_TO_STALL_TYPE, EGRESS, QUEUE_Y } from './types';
import type { Vehicle, VehicleStatus } from './types';
import type { StallState } from '@/store/depotStore';

const LERP_SPEED = 30; // SVG units per sim-second
const LEFT_AISLE_X = 30;
const RIGHT_AISLE_X = 275;

function getServiceDuration(vehicle: Vehicle, config: ReturnType<typeof useSimulationStore.getState>['config']): number {
  const service = vehicle.serviceQueue[vehicle.currentServiceIndex];
  if (!service) return 0;
  switch (service) {
    case 'dcfc_charge': {
      const chargeTime = (vehicle.targetSoC - vehicle.currentSoC) / 100 * vehicle.batteryCapacity / config.dcfcPowerPerStall * 60;
      return Math.max(10, Math.min(config.dcfcChargeTime, chargeTime)) * 60; // convert min to seconds
    }
    case 'l2_charge':
      return config.l2ChargeTime * 3600; // hours to seconds
    case 'exterior_wash':
      return config.exteriorWash * 60;
    case 'interior_detail':
      return config.interiorDetail * 60;
    case 'maintenance':
      return config.lightMaintenance * 60;
    case 'staging':
      return config.stallTransition * 60;
    default:
      return 120;
  }
}

function serviceToVehicleStatus(service: string): VehicleStatus {
  switch (service) {
    case 'dcfc_charge':
    case 'l2_charge':
      return 'charging';
    case 'exterior_wash':
      return 'washing';
    case 'interior_detail':
      return 'detailing';
    case 'maintenance':
      return 'maintenance';
    case 'staging':
      return 'staging';
    default:
      return 'queued';
  }
}

function lerp(current: number, target: number, maxStep: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export class SimulationEngine {
  private rafId: number | null = null;
  private lastTimestamp: number | null = null;

  start() {
    if (this.rafId !== null) return;
    useSimulationStore.getState().setStatus('running');
    this.lastTimestamp = null;
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    useSimulationStore.getState().setStatus('paused');
  }

  reset() {
    this.stop();
    resetArrivalGenerator();
    useVehicleStore.getState().reset();
    const simStore = useSimulationStore.getState();
    simStore.setStatus('idle');
    simStore.setSimTime(50400);
    // Reset all stall statuses
    const depotStore = useDepotStore.getState();
    depotStore.stalls.forEach((s) => {
      if (s.status !== 'available') depotStore.setStallStatus(s.id, 'available');
    });
  }

  private loop = (timestamp: number) => {
    const simState = useSimulationStore.getState();
    if (simState.status !== 'running') {
      this.rafId = null;
      return;
    }

    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    const realDeltaMs = Math.min(timestamp - this.lastTimestamp, 100); // cap at 100ms
    this.lastTimestamp = timestamp;
    const deltaSeconds = (realDeltaMs / 1000) * simState.simSpeed;

    // 1. Advance simTime
    const newSimTime = (simState.simTime + deltaSeconds) % 86400;
    simState.setSimTime(newSimTime);

    const config = simState.config;
    const vehicleState = useVehicleStore.getState();
    const depotState = useDepotStore.getState();
    let vehicles = [...vehicleState.vehicles];
    let changed = false;

    // 2. Spawn new vehicles
    const newArrivals = generateArrivals(newSimTime, deltaSeconds, config, vehicles.length);
    if (newArrivals.length > 0) {
      vehicles.push(...newArrivals);
      changed = true;
    }

    // 3. Move approaching vehicles to queue via waypoints
    for (const v of vehicles) {
      if (v.status === 'approaching' && !v.targetPosition && !v.waypoints?.length) {
        const queueX = 50 + (vehicles.filter((vv) => vv.status === 'queued').length % 15) * 15;
        // Waypoint path: ingress → left aisle → north → queue position
        v.waypoints = [
          { x: LEFT_AISLE_X, y: 215 },
          { x: LEFT_AISLE_X, y: QUEUE_Y },
          { x: queueX, y: QUEUE_Y },
        ];
        v.targetPosition = v.waypoints.shift()!;
      }
    }

    // 4. OTTO-Q: assign queued vehicles to available stalls
    const queued = vehicles.filter((v) => v.status === 'queued');
    if (queued.length > 0) {
      const scorer = getScheduler(config.ottoQAlgorithm);
      queued.sort((a, b) => scorer(b, newSimTime) - scorer(a, newSimTime));

      for (const v of queued) {
        const neededService = v.serviceQueue[v.currentServiceIndex];
        if (!neededService) {
          v.status = 'departing';
          v.waypoints = [
            { x: RIGHT_AISLE_X, y: v.position.y },
            { x: RIGHT_AISLE_X, y: 215 },
            { ...EGRESS },
          ];
          v.targetPosition = v.waypoints.shift()!;
          changed = true;
          continue;
        }
        const stallType = SERVICE_TO_STALL_TYPE[neededService];
        const availableStall = depotState.stalls.find(
          (s) => s.type === stallType && s.status === 'available'
        );
        if (availableStall) {
          v.assignedStall = availableStall.id;
          v.status = serviceToVehicleStatus(neededService);
          const stallTarget = {
            x: availableStall.position.x + 4,
            y: availableStall.position.y + 8,
          };
          // Waypoint path: current → left aisle at current y → left aisle at stall y → stall
          v.waypoints = [
            { x: LEFT_AISLE_X, y: v.position.y },
            { x: LEFT_AISLE_X, y: stallTarget.y },
            stallTarget,
          ];
          v.targetPosition = v.waypoints.shift()!;
          v.serviceStartTime = null;
          v.serviceDuration = getServiceDuration(v, config);
          depotState.setStallStatus(availableStall.id, v.status === 'charging' ? 'charging' : 'servicing');
          changed = true;
        }
      }
    }

    // 5. Update positions (lerp) and service timers
    const step = LERP_SPEED * deltaSeconds;
    for (const v of vehicles) {
      if (v.targetPosition) {
        const newX = lerp(v.position.x, v.targetPosition.x, step);
        const newY = lerp(v.position.y, v.targetPosition.y, step);
        if (newX !== v.position.x || newY !== v.position.y) {
          v.position = { x: newX, y: newY };
          changed = true;
        }
        // Check if arrived at target
        if (Math.abs(newX - v.targetPosition.x) < 1 && Math.abs(newY - v.targetPosition.y) < 1) {
          v.position = { ...v.targetPosition };

          // Pop next waypoint if available
          if (v.waypoints && v.waypoints.length > 0) {
            v.targetPosition = v.waypoints.shift()!;
          } else {
            v.targetPosition = null;

            // If approaching and arrived at final waypoint, become queued
            if ((v.status as string) === 'approaching') {
              v.status = 'queued';
            }

            // If at a service stall, start the timer
            if (v.assignedStall && v.serviceStartTime === null &&
              v.status !== 'departing' && v.status !== 'queued') {
              v.serviceStartTime = newSimTime;
            }
          }
          changed = true;
        }
      }

      // Check service completion
      if (v.serviceStartTime !== null && v.serviceDuration !== null) {
        const elapsed = newSimTime - v.serviceStartTime;
        if (elapsed < 0 || elapsed >= v.serviceDuration) {
          // Service complete
          if (v.assignedStall) {
            depotState.setStallStatus(v.assignedStall, 'available');
            v.assignedStall = null;
          }

          // Update SoC for charging services
          const service = v.serviceQueue[v.currentServiceIndex];
          if (service === 'dcfc_charge' || service === 'l2_charge') {
            v.currentSoC = Math.min(100, v.targetSoC);
          }

          v.currentServiceIndex++;
          v.serviceStartTime = null;
          v.serviceDuration = null;

          if (v.currentServiceIndex >= v.serviceQueue.length) {
            v.status = 'departing';
            // Waypoint path: current pos → right aisle → south → egress
            v.waypoints = [
              { x: RIGHT_AISLE_X, y: v.position.y },
              { x: RIGHT_AISLE_X, y: 215 },
              { ...EGRESS },
            ];
            v.targetPosition = v.waypoints.shift()!;
          } else {
            v.status = 'queued'; // re-queue for next service
          }
          changed = true;
        }
      }
    }

    // 6. Remove departed vehicles
    const departing = vehicles.filter(
      (v) => v.status === 'departing' && !v.targetPosition && (!v.waypoints || v.waypoints.length === 0)
    );
    if (departing.length > 0) {
      const departedIds = new Set(departing.map((v) => v.id));
      vehicles = vehicles.filter((v) => !departedIds.has(v.id));
      for (let i = 0; i < departing.length; i++) {
        vehicleState.incrementProcessed();
      }
      changed = true;
    }

    // 7. Update store
    if (changed) {
      vehicleState.setVehicles(vehicles);
    }
    vehicleState.setQueueDepth(vehicles.filter((v) => v.status === 'queued').length);

    this.rafId = requestAnimationFrame(this.loop);
  };
}

// Singleton
export const simulationEngine = new SimulationEngine();
