import { supabase } from '@/integrations/supabase/client';
import { useSimulationStore } from '@/store/simulationStore';
import { useKPIStore } from '@/store/kpiStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { useAIStore } from '@/store/aiStore';

export interface SimulationContext {
  mode: 'live_observation' | 'run_summary';
  simTime: string;
  elapsed: number;
  config: {
    dcfcCount: number;
    l2Count: number;
    washCount: number;
    fleetSize: number;
    consumerMembers: number;
    algorithm: string;
  };
  kpis: Record<string, number | string>;
  zoneStatus: {
    dcfc: { occupied: number; total: number };
    l2: { occupied: number; total: number };
    wash: { occupied: number; total: number };
    staging: { occupied: number; total: number };
    queue: { depth: number };
  };
  recentAlerts: string[];
  vehiclesProcessed: number;
  avgTurnaroundMinutes: number;
}

function formatSimTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function countStalls(stalls: { type: string; status: string }[], type: string) {
  const ofType = stalls.filter((s) => s.type === type);
  return {
    occupied: ofType.filter((s) => s.status !== 'available').length,
    total: ofType.length,
  };
}

export function collectContext(mode: 'live_observation' | 'run_summary'): SimulationContext {
  const sim = useSimulationStore.getState();
  const kpi = useKPIStore.getState();
  const vehicles = useVehicleStore.getState();
  const depot = useDepotStore.getState();

  const startTime = 50400; // 14:00 default
  let elapsed = (sim.simTime - startTime) / 60;
  if (elapsed < 0) elapsed += 1440;

  return {
    mode,
    simTime: formatSimTime(sim.simTime),
    elapsed: Math.round(elapsed),
    config: {
      dcfcCount: sim.config.dcfcCount,
      l2Count: sim.config.l2Count,
      washCount: sim.config.washBayCount,
      fleetSize: sim.config.activeFleetSize,
      consumerMembers: sim.config.activeConsumerMembers,
      algorithm: sim.config.ottoQAlgorithm,
    },
    kpis: {
      fleetUptimePct: Math.round(kpi.fleetUptimePct * 10) / 10,
      avgTurnaroundMin: Math.round(kpi.avgTurnaroundMin * 10) / 10,
      dcfcUtilization: Math.round(kpi.dcfcUtilization * 10) / 10,
      l2Utilization: Math.round(kpi.l2Utilization * 10) / 10,
      avgQueueWaitMin: Math.round(kpi.avgQueueWaitMin * 10) / 10,
      revenuePerBayPerHour: Math.round(kpi.revenuePerBayPerHour * 100) / 100,
      bessSOC: Math.round(kpi.bessSOC),
      monthlyEBITDA: Math.round(kpi.monthlyEBITDA),
      serviceCompletionRate: Math.round(kpi.serviceCompletionRate * 10) / 10,
      carbonOffsetKg: Math.round(kpi.carbonOffsetKg),
    },
    zoneStatus: {
      dcfc: countStalls(depot.stalls, 'dcfc'),
      l2: countStalls(depot.stalls, 'l2'),
      wash: countStalls(depot.stalls, 'wash'),
      staging: countStalls(depot.stalls, 'staging'),
      queue: { depth: vehicles.queueDepth },
    },
    recentAlerts: [],
    vehiclesProcessed: vehicles.vehiclesProcessed,
    avgTurnaroundMinutes: Math.round(kpi.avgTurnaroundMin * 10) / 10,
  };
}

export async function requestAnalysis(mode: 'live_observation' | 'run_summary'): Promise<void> {
  const aiStore = useAIStore.getState();
  const now = Date.now();

  // Real-time throttle: 10 seconds minimum between calls
  if (now - aiStore.lastRealCallTime < 10000) return;

  const isLoading = mode === 'live_observation' ? aiStore.isLoadingObservation : aiStore.isLoadingSummary;
  if (isLoading) return;

  const setLoading = mode === 'live_observation' ? aiStore.setLoadingObservation : aiStore.setLoadingSummary;
  setLoading(true);
  aiStore.setLastRealCallTime(now);
  aiStore.setError(null);

  try {
    const context = collectContext(mode);
    const { data, error } = await supabase.functions.invoke('analyze-simulation', {
      body: { context },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const text = data?.analysis || 'No analysis returned.';
    aiStore.incrementCallCount();

    if (mode === 'live_observation') {
      aiStore.addObservation({
        simTime: context.simTime,
        text,
        timestamp: now,
      });
    } else {
      aiStore.setRunSummary(text);
    }
  } catch (e: any) {
    console.error('AI analysis error:', e);
    aiStore.setError(e?.message || 'AI analysis failed');
  } finally {
    setLoading(false);
  }
}
