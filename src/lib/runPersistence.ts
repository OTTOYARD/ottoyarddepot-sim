import { supabase } from '@/integrations/supabase/client';
import { useSimulationStore } from '@/store/simulationStore';
import { useKPIStore } from '@/store/kpiStore';
import { useAIStore } from '@/store/aiStore';
import { useAlertStore } from '@/store/alertStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDemoStore } from '@/store/demoStore';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

let runCounter = 0;

export async function saveRun(): Promise<void> {
  const demo = useDemoStore.getState();
  demo.setSaving(true);
  try {
    const sim = useSimulationStore.getState();
    const kpi = useKPIStore.getState();
    const ai = useAIStore.getState();
    const alerts = useAlertStore.getState();
    const vehicles = useVehicleStore.getState();

    runCounter++;
    const name = `Run #${runCounter} - ${format(new Date(), 'MMM d h:mma')}`;

    const startTime = 50400;
    let duration = sim.simTime - startTime;
    if (duration < 0) duration += 86400;

    const kpiResults: Record<string, number> = {
      fleetUptimePct: kpi.fleetUptimePct,
      avgTurnaroundMin: kpi.avgTurnaroundMin,
      dcfcUtilization: kpi.dcfcUtilization,
      l2Utilization: kpi.l2Utilization,
      avgQueueWaitMin: kpi.avgQueueWaitMin,
      revenuePerBayPerHour: kpi.revenuePerBayPerHour,
      bessSOC: kpi.bessSOC,
      solarSelfConsumption: kpi.solarSelfConsumption,
      ottoQAccuracy: kpi.ottoQAccuracy,
      serviceCompletionRate: kpi.serviceCompletionRate,
      costPerVehicle: kpi.costPerVehicle,
      monthlyEBITDA: kpi.monthlyEBITDA,
      paybackYears: kpi.paybackYears,
      revenuePerMember: kpi.revenuePerMember,
      energyCostPerKwh: kpi.energyCostPerKwh,
      maintenanceScore: kpi.maintenanceScore,
      carbonOffsetKg: kpi.carbonOffsetKg,
      peakQueueDepth: kpi.peakQueueDepth,
      peakPowerDraw: kpi.peakPowerDraw,
    };

    const alertList = alerts.alerts;
    const row = {
      name,
      duration_seconds: Math.round(duration),
      config: sim.config,
      kpi_results: kpiResults,
      ai_summary: ai.runSummary || null,
      vehicles_processed: vehicles.vehiclesProcessed,
      avg_turnaround_minutes: Math.round(kpi.avgTurnaroundMin * 100) / 100,
      peak_queue_depth: kpi.peakQueueDepth,
      peak_power_draw_kw: Math.round(kpi.peakPowerDraw * 100) / 100,
      alert_count_critical: alertList.filter((a) => a.severity === 'critical').length,
      alert_count_warning: alertList.filter((a) => a.severity === 'warning').length,
      alert_count_info: alertList.filter((a) => a.severity === 'info').length,
    };

    const { error } = await (supabase as any).from('simulation_runs').insert(row);
    if (error) {
      console.error('Failed to save run:', error);
      return;
    }

    toast({ title: 'Run saved', description: name });
    useHistoryStore.getState().fetchRuns();
  } catch (err) {
    console.error('Failed to save run:', err);
  } finally {
    demo.setSaving(false);
  }
}

export async function loadConfig(run: { config: Record<string, unknown> | null; name: string | null }) {
  if (!run.config) return;
  const sim = useSimulationStore.getState();
  const depot = useDepotStore.getState();

  sim.updateConfig(run.config as any);
  const cfg = run.config as Record<string, number>;
  if (cfg.dcfcCount || cfg.l2Count || cfg.washBayCount || cfg.stagingStalls) {
    depot.regenerateStalls(
      cfg.dcfcCount ?? 10,
      cfg.l2Count ?? 40,
      cfg.washBayCount ?? 3,
      cfg.stagingStalls ?? 15,
    );
  }
  toast({ title: 'Configuration loaded', description: `From "${run.name}"` });
}
