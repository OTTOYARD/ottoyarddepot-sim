// ============================================================================
// SimulationEngine — the OFFLINE DEMO engine.
//
// ⚠️ THIS IS NOT THE AUTHORITY. The server-side OTTO-TWIN (Supabase project
// otto-q-core) owns the world model: run seeds, common-random-number
// discipline, a fitted real-world corpus, and the channel feed OTTO-Q
// orchestrates against. See src/lib/ottoq/ and docs/OTTO-Q-WORLD-CONTRACT.md.
//
// This engine exists so the cockpit still shows a moving depot when the backend
// is unreachable (twinStore.offlineDemo). It is a demonstration, not a
// validation instrument, and nothing it produces should be presented as a
// simulation result.
//
// It is at least REPRODUCIBLE: every draw routes through the seeded generator
// in ./rng, re-seeded on each reset, so the same seed replays the same demo.
// ============================================================================
import { useSimulationStore } from '@/store/simulationStore';
import type { SimulationConfig } from '@/store/simulationStore';
import { seedDemoRng, currentDemoSeed } from './rng';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { ROBOTIC_OVERHEAD_SECONDS } from '@/lib/ottoChargeArm/roboticService';
import { useKPIStore } from '@/store/kpiStore';
import { useAIStore } from '@/store/aiStore';
import { useAlertStore } from '@/store/alertStore';
import { generateArrivals, resetArrivalGenerator } from './ArrivalGenerator';
import { getScheduler } from './scheduling';
import { calculateKPIs } from './KPICalculator';
import { checkAlerts, resetAlertEngine } from './AlertEngine';
import { saveRun } from '@/lib/runPersistence';
import { optimizeDepotSchedule } from '@/lib/nvidia-cuopt';
import { SERVICE_TO_STALL_TYPE } from './types';
import { routeToStall, routeToEgress, routeToQueue } from '@/lib/sitePlan';
import type { Vehicle, VehicleStatus } from './types';
import type { StallState } from '@/store/depotStore';

// Travel speed in logical units per sim-second. 1 u ≈ 1.57 ft, so 11 u/s
// ≈ 17 ft/s ≈ 12 mph — a realistic depot crawl that keeps the gate→charge→
// bay→egress choreography readable at demo sim speeds.
const LERP_SPEED = 11;

let lastScheduleTime = 0;
let cuoptPending = false;

function getServiceTimeForStall(stallType: string, config: SimulationConfig): number {
  const map: Record<string, number> = {
    dcfc: config.dcfcChargeTime || 25,
    l2: (config.l2ChargeTime || 4) * 60,
    wash: config.exteriorWash || 10,
    service: 45,
    staging: 5,
  };
  return map[stallType] || 30;
}

let pendingCuOptAssignments: { vehicleId: string; stallId: string; startTime: number }[] | null = null;

function applyCuOptAssignments() {
  if (!pendingCuOptAssignments || pendingCuOptAssignments.length === 0) return;
  const assignments = pendingCuOptAssignments;
  pendingCuOptAssignments = null;

  const vehicleState = useVehicleStore.getState();
  const depotState = useDepotStore.getState();
  const config = useSimulationStore.getState().config;
  let vehicles = [...vehicleState.vehicles];
  let changed = false;
  const stallUpdates: { id: string; status: 'charging' | 'servicing' }[] = [];

  for (const a of assignments) {
    const v = vehicles.find(vv => vv.id === a.vehicleId && vv.status === 'queued');
    if (!v) continue;
    const stall = depotState.stalls.find(s => s.id === a.stallId && s.status === 'available');
    if (!stall) continue;

    const neededService = v.serviceQueue[v.currentServiceIndex];
    if (!neededService) continue;

    v.assignedStall = stall.id;
    v.status = serviceToVehicleStatus(neededService);
    v.waypoints = routeToStall(v.position, stall.position);
    v.targetPosition = v.waypoints.shift()!;
    v.serviceStartTime = null;
    v.serviceDuration = getServiceDuration(v, config);
    stallUpdates.push({ id: stall.id, status: v.status === 'charging' ? 'charging' : 'servicing' });
    changed = true;
  }

  // Batch: update vehicles once, then stalls
  if (changed) {
    vehicleState.setVehicles(vehicles);
    for (const su of stallUpdates) {
      depotState.setStallStatus(su.id, su.status);
    }
  }
}

function runSchedulingCycle(simTime: number, config: SimulationConfig) {
  if (cuoptPending) return;
  if (simTime - lastScheduleTime < 30 && lastScheduleTime !== 0) return;
  lastScheduleTime = simTime;

  const vehicleState = useVehicleStore.getState();
  const depotState = useDepotStore.getState();
  const queued = vehicleState.vehicles.filter(v => v.status === 'queued');
  if (queued.length === 0) return;
  const available = depotState.stalls.filter(s => s.status === 'available');
  if (available.length === 0) return;

  cuoptPending = true;
  optimizeDepotSchedule({
    vehicles: queued.map(v => ({
      id: v.id,
      type: v.type,
      currentSoC: v.currentSoC,
      targetSoC: v.targetSoC,
      servicesNeeded: v.serviceQueue.slice(v.currentServiceIndex),
      priority: v.priority,
      arrivalTime: v.arrivalTime,
    })),
    stalls: available.map(s => ({
      id: s.id,
      type: s.type,
      available: true,
      serviceTime: getServiceTimeForStall(s.type, config),
    })),
    config: {
      algorithm: config.ottoQAlgorithm || 'Priority-Weighted',
      maxQueueWait: 10,
      prioritizeFleet: config.fleetPriorityLevel === 'Always Priority',
    },
  }).then(result => {
    pendingCuOptAssignments = result.assignments;
  }).catch(err => {
    console.error('cuOpt scheduling cycle error:', err);
  }).finally(() => {
    cuoptPending = false;
  });
}

function getServiceDuration(vehicle: Vehicle, config: ReturnType<typeof useSimulationStore.getState>['config']): number {
  const service = vehicle.serviceQueue[vehicle.currentServiceIndex];
  if (!service) return 0;
  switch (service) {
    case 'dcfc_charge': {
      const chargeTime = (vehicle.targetSoC - vehicle.currentSoC) / 100 * vehicle.batteryCapacity / config.dcfcPowerPerStall * 60;
      const charge = Math.max(10, Math.min(config.dcfcChargeTime, chargeTime)) * 60; // min -> seconds
      // DCFC stalls are robot-served. The arm's connect and retract time is
      // REAL stall occupancy, so it belongs inside the service duration rather
      // than being animated over the top of it. Two consequences, both wanted:
      // the vehicle structurally cannot depart before the arm has retracted,
      // and every forward reservation OTTO-Q makes already carries the cost.
      return charge + ROBOTIC_OVERHEAD_SECONDS;
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

/** Default demo seed. Stable so an unconfigured demo replays identically. */
const DEFAULT_DEMO_SEED = 20260727;

export class SimulationEngine {
  private rafId: number | null = null;
  private lastTimestamp: number | null = null;
  private seed = DEFAULT_DEMO_SEED;

  /**
   * Set the seed for the NEXT reset. Two runs with the same seed and the same
   * config produce the same demo — which is the minimum bar for comparing two
   * scheduling policies against each other.
   */
  setSeed(seed: number) {
    this.seed = seed >>> 0;
  }

  /** Seed currently driving the demo — record it alongside any saved run. */
  get currentSeed(): number {
    return currentDemoSeed();
  }

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
    // Auto-save the run
    saveRun();
  }

  reset() {
    this.stop();
    // Re-seed FIRST: every generator below draws from this stream, so seeding
    // after any of them would leave the run's opening moments unreproducible.
    seedDemoRng(this.seed);
    resetArrivalGenerator();
    resetAlertEngine();
    lastScheduleTime = 0;
    cuoptPending = false;
    pendingCuOptAssignments = null;
    useVehicleStore.getState().reset();
    useKPIStore.getState().reset();
    useAIStore.getState().reset();
    useAlertStore.getState().reset();
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
        v.waypoints = routeToQueue(queueX);
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
          v.waypoints = routeToEgress(v.position);
          v.targetPosition = v.waypoints.shift()!;
          changed = true;
          continue;
        }
        const stallType = SERVICE_TO_STALL_TYPE[neededService];
        let availableStall = depotState.stalls.find(
          (s) => s.type === stallType && s.status === 'available'
        );

        // DCFC→L2 overflow: if no DCFC stall available, try L2
        let overflowed = false;
        if (!availableStall && neededService === 'dcfc_charge') {
          availableStall = depotState.stalls.find(
            (s) => s.type === 'l2' && s.status === 'available'
          );
          if (availableStall) {
            v.serviceQueue[v.currentServiceIndex] = 'l2_charge';
            overflowed = true;
          }
        }

        if (availableStall) {
          v.assignedStall = availableStall.id;
          const actualService = overflowed ? 'l2_charge' : neededService;
          v.status = serviceToVehicleStatus(actualService);
          v.waypoints = routeToStall(v.position, availableStall.position);
          v.targetPosition = v.waypoints.shift()!;
          v.serviceStartTime = null;
          v.serviceDuration = getServiceDuration(v, config);
          depotState.setStallStatus(availableStall.id, v.status === 'charging' ? 'charging' : 'servicing');
          changed = true;
        }
      }
    }

    // 4b. cuOpt async scheduling (fire-and-forget, every 30 sim-seconds)
    runSchedulingCycle(newSimTime, config);
    // 4c. Apply any pending cuOpt assignments from previous cycle
    applyCuOptAssignments();

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
            v.waypoints = routeToEgress(v.position);
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
      const kpiState = useKPIStore.getState();
      for (const dv of departing) {
        vehicleState.incrementProcessed();
        let turnaround = newSimTime - dv.arrivalTime;
        if (turnaround < 0) turnaround += 86400;
        kpiState.recordDeparture(turnaround);
      }
      changed = true;
    }

    // 7. Update store
    if (changed) {
      vehicleState.setVehicles(vehicles);
    }
    vehicleState.setQueueDepth(vehicles.filter((v) => v.status === 'queued').length);

    // 8. Calculate KPIs
    calculateKPIs(vehicles, config, depotState.stalls, newSimTime, vehicleState.vehiclesProcessed);

    // 8a. Track peak values
    const kpiState = useKPIStore.getState();
    const currentQueueDepth = vehicles.filter((v) => v.status === 'queued').length;
    if (currentQueueDepth > kpiState.peakQueueDepth) {
      kpiState.updateKPIs({ peakQueueDepth: currentQueueDepth });
    }

    // 8b. Check alerts
    checkAlerts(vehicles, config, depotState.stalls, newSimTime);

    this.rafId = requestAnimationFrame(this.loop);
  };
}

// Singleton
export const simulationEngine = new SimulationEngine();
