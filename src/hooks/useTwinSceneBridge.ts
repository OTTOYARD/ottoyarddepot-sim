// ============================================================================
// useTwinSceneBridge — CC-P2b: makes the depot scene LIVE from the backend.
// Maps each twin snapshot → the existing depotStore (stall occupancy) +
// vehicleStore (vehicles placed at their stalls by state), so the existing
// 2D/3D renderer shows real backend state. No renderer rewrite.
//
// Only runs in backend-twin mode (an active sim_run + the legacy client engine
// NOT running) so it never fights the offline-demo engine.
// ============================================================================
import { useEffect } from "react";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";
import { useDepotStore, type StallType, type StallStatus } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import type { Vehicle, VehicleStatus } from "@/engine/types";

const INGRESS = { x: 100, y: 215 };

// backend vehicle_state → { which stall lane, vehicle render status, stall status }
function mapState(state: string): { lane: StallType | "gate" | null; vstatus: VehicleStatus; sstatus: StallStatus } | null {
  switch (state) {
    case "charging_dcfc":            return { lane: "dcfc",    vstatus: "charging",   sstatus: "charging" };
    case "charging_l2":              return { lane: "l2",      vstatus: "charging",   sstatus: "charging" };
    case "in_wash_bay":              return { lane: "wash",    vstatus: "washing",    sstatus: "servicing" };
    case "in_detail_bay":            return { lane: "wash",    vstatus: "detailing",  sstatus: "servicing" };
    case "in_service_bay":           return { lane: "service", vstatus: "maintenance",sstatus: "servicing" };
    case "charge_complete_holding":
    case "service_complete_holding":
    case "staged_awaiting_service":
    case "staged_for_departure":     return { lane: "staging", vstatus: "staging",    sstatus: "occupied" };
    case "arrived_at_gate":          return { lane: "gate",    vstatus: "queued",     sstatus: "available" };
    // deployed / en_route_to_depot / en_route_to_deployment / offline / tow → off-map
    default: return null;
  }
}

export function useTwinSceneBridge() {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const legacyStatus = useSimulationStore((s) => s.status);

  useEffect(() => {
    if (!activeSimRunId || !snapshot) return;
    if (legacyStatus === "running") return; // offline-demo engine owns the stores; don't fight it

    const depot = useDepotStore.getState();
    const vehStore = useVehicleStore.getState();
    const stalls = depot.stalls;

    // group free-able stall slots by lane (in stable order)
    const lanes: Record<string, typeof stalls> = { dcfc: [], l2: [], wash: [], service: [], staging: [] };
    for (const s of stalls) (lanes[s.type] ??= []).push(s);
    const cursor: Record<string, number> = { dcfc: 0, l2: 0, wash: 0, service: 0, staging: 0 };

    const desiredStatus = new Map<string, StallStatus>();
    const vehicles: Vehicle[] = [];
    let gateN = 0;

    for (const bv of snapshot.fleet?.vehicles ?? []) {
      const m = mapState(bv.state);
      if (!m) continue;

      let pos: { x: number; y: number };
      if (m.lane === "gate") {
        pos = { x: INGRESS.x - 30 + (gateN % 8) * 8, y: INGRESS.y - 14 - Math.floor(gateN / 8) * 7 };
        gateN++;
      } else if (m.lane) {
        const slot = lanes[m.lane]?.[cursor[m.lane]++];
        if (!slot) continue; // no free slot in this lane → don't render (overflow off-map)
        pos = { x: slot.position.x + 4, y: slot.position.y + 8 };
        desiredStatus.set(slot.id, m.sstatus);
      } else continue;

      vehicles.push({
        id: bv.id,
        type: "fleet",                       // all contracted AVs; OEM platform drives the render color
        oem: bv.platform,                    // waymo | tesla | zoox → OEM-colored dot
        priority: 5,
        batteryCapacity: 100,
        currentSoC: bv.soc ?? 0,
        targetSoC: 90,
        status: m.vstatus,
        assignedStall: null,
        serviceQueue: [],
        currentServiceIndex: 0,
        serviceStartTime: null,
        serviceDuration: null,
        arrivalTime: 0,
        position: pos,
        targetPosition: null,
      });
    }

    // apply stall statuses (set occupied/charging/servicing; clear the rest to available)
    for (const s of stalls) {
      const want = desiredStatus.get(s.id) ?? "available";
      if (s.status !== want) depot.setStallStatus(s.id, want);
    }
    vehStore.setVehicles(vehicles);
    vehStore.setQueueDepth(vehicles.filter((v) => v.status === "queued").length);
  }, [snapshot, activeSimRunId, legacyStatus]);
}
