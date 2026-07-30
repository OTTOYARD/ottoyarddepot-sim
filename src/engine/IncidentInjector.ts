import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useAlertStore } from '@/store/alertStore';
import { useSimulationStore } from '@/store/simulationStore';
import { INGRESS, QUEUE_Y } from './types';
import type { Vehicle, VehicleType, ServiceType } from './types';
import { demoRandom } from './rng';

export function createQueueVehicle(simTime: number, index: number): Vehicle {
  const types: VehicleType[] = ['fleet', 'core', 'concierge'];
  const type = types[demoRandom().int(0, types.length - 1)];
  return {
    id: `INC-${Date.now()}-${index}`,
    type,
    priority: 3 + demoRandom().int(0, 4),
    batteryCapacity: 60 + demoRandom().next() * 40,
    currentSoC: 10 + demoRandom().next() * 30,
    targetSoC: 90,
    status: 'queued',
    assignedStall: null,
    serviceQueue: ['dcfc_charge'] as ServiceType[],
    currentServiceIndex: 0,
    serviceStartTime: null,
    serviceDuration: null,
    arrivalTime: simTime,
    position: { x: 50 + (index % 15) * 15, y: QUEUE_Y },
    targetPosition: null,
  };
}

export function injectRandomIncident() {
  const simTime = useSimulationStore.getState().simTime;
  const addAlert = useAlertStore.getState().addAlert;
  const incidents = ['charger_failure', 'vehicle_breakdown', 'power_fluctuation', 'queue_surge'];
  const pick = incidents[demoRandom().int(0, incidents.length - 1)];

  switch (pick) {
    case 'charger_failure': {
      const depot = useDepotStore.getState();
      const active = depot.stalls.filter(
        (s) => (s.type === 'dcfc' || s.type === 'l2') && s.status !== 'offline'
      );
      if (active.length > 0) {
        const target = active[demoRandom().int(0, active.length - 1)];
        depot.setStallStatus(target.id, 'offline');
        addAlert({
          timestamp: simTime,
          severity: 'critical',
          title: 'Injected: Charger Failure',
          message: `${target.id} forced offline by incident injection. Manual intervention required.`,
        });
      }
      break;
    }
    case 'vehicle_breakdown': {
      const vehicleStore = useVehicleStore.getState();
      const inService = vehicleStore.vehicles.filter(
        (v) => !['approaching', 'queued', 'departing'].includes(v.status)
      );
      if (inService.length > 0) {
        const target = inService[demoRandom().int(0, inService.length - 1)];
        // Free the stall
        if (target.assignedStall) {
          useDepotStore.getState().setStallStatus(target.assignedStall, 'available');
        }
        vehicleStore.setVehicles(vehicleStore.vehicles.filter((v) => v.id !== target.id));
        addAlert({
          timestamp: simTime,
          severity: 'critical',
          title: 'Injected: Vehicle Breakdown',
          message: `${target.id} (${target.type}) removed from service due to mechanical failure.`,
        });
      }
      break;
    }
    case 'power_fluctuation': {
      addAlert({
        timestamp: simTime,
        severity: 'critical',
        title: 'Injected: Power Fluctuation',
        message: `Grid instability detected. Available power reduced by 20% for 5 minutes.`,
      });
      // Mark 20% of active chargers offline temporarily
      const depot = useDepotStore.getState();
      const activeChargers = depot.stalls.filter(
        (s) => (s.type === 'dcfc' || s.type === 'l2') && s.status !== 'offline'
      );
      const toOffline = Math.ceil(activeChargers.length * 0.2);
      for (let i = 0; i < toOffline && i < activeChargers.length; i++) {
        const idx = demoRandom().int(0, activeChargers.length - 1);
        depot.setStallStatus(activeChargers[idx].id, 'offline');
        activeChargers.splice(idx, 1);
      }
      // Restore after 5 real seconds (approximation)
      const offlinedIds = depot.stalls
        .filter((s) => s.status === 'offline')
        .map((s) => s.id);
      setTimeout(() => {
        const current = useDepotStore.getState();
        offlinedIds.forEach((id) => {
          const stall = current.stalls.find((s) => s.id === id);
          if (stall?.status === 'offline') current.setStallStatus(id, 'available');
        });
      }, 5000);
      break;
    }
    case 'queue_surge': {
      const vehicleStore = useVehicleStore.getState();
      const newVehicles: Vehicle[] = [];
      for (let i = 0; i < 5; i++) {
        newVehicles.push(createQueueVehicle(simTime, i));
      }
      vehicleStore.setVehicles([...vehicleStore.vehicles, ...newVehicles]);
      addAlert({
        timestamp: simTime,
        severity: 'critical',
        title: 'Injected: Queue Surge',
        message: `5 vehicles simultaneously entered the queue. Expect increased wait times and potential overflow.`,
      });
      break;
    }
  }
}
