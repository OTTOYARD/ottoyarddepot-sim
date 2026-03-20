import { useEffect, useState } from 'react';
import { useHistoryStore, type SimulationRun } from '@/store/historyStore';
import { loadConfig } from '@/lib/runPersistence';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight, Minus,
  Trash2, Download, GitCompare, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// KPI metadata: label, unit, higherIsBetter
const KPI_META: Record<string, { label: string; unit: string; higherIsBetter: boolean }> = {
  fleetUptimePct: { label: 'Fleet Uptime', unit: '%', higherIsBetter: true },
  avgTurnaroundMin: { label: 'Avg Turnaround', unit: 'min', higherIsBetter: false },
  dcfcUtilization: { label: 'DCFC Utilization', unit: '%', higherIsBetter: true },
  l2Utilization: { label: 'L2 Utilization', unit: '%', higherIsBetter: true },
  avgQueueWaitMin: { label: 'Avg Queue Wait', unit: 'min', higherIsBetter: false },
  revenuePerBayPerHour: { label: 'Revenue/Bay/Hr', unit: '$', higherIsBetter: true },
  serviceCompletionRate: { label: 'Service Completion', unit: '%', higherIsBetter: true },
  costPerVehicle: { label: 'Cost/Vehicle', unit: '$', higherIsBetter: false },
  monthlyEBITDA: { label: 'Monthly EBITDA', unit: '$', higherIsBetter: true },
  carbonOffsetKg: { label: 'Carbon Offset', unit: 'kg', higherIsBetter: true },
  maintenanceScore: { label: 'Maintenance Score', unit: '', higherIsBetter: true },
  peakQueueDepth: { label: 'Peak Queue Depth', unit: '', higherIsBetter: false },
  peakPowerDraw: { label: 'Peak Power Draw', unit: 'kW', higherIsBetter: false },
};

/* ── Run Card ── */
const RunCard = ({ run }: { run: SimulationRun }) => {
  const { selectedForCompare, toggleCompare, deleteRun } = useHistoryStore();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(run.name || '');
  const isSelected = selectedForCompare.includes(run.id);

  const handleRename = () => {
    if (editName.trim()) {
      useHistoryStore.getState().renameRun(run.id, editName.trim());
    }
    setEditing(false);
  };

  const kpis = (run.kpi_results || {}) as Record<string, number>;

  return (
    <Card className={`border-white/10 bg-otto-charcoal/60 ${isSelected ? 'ring-1 ring-otto-teal' : ''}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="h-6 text-xs bg-transparent border-otto-teal/50 text-white"
                autoFocus
              />
            ) : (
              <p
                className="text-sm font-medium text-white truncate cursor-pointer hover:text-otto-teal transition-colors"
                onClick={() => { setEditName(run.name || ''); setEditing(true); }}
              >
                {run.name || 'Unnamed Run'}
              </p>
            )}
            <p className="text-[10px] text-otto-gray mt-0.5">
              {run.created_at ? format(new Date(run.created_at), 'MMM d, yyyy h:mm a') : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleCompare(run.id)}
              className="border-otto-gray data-[state=checked]:bg-otto-teal data-[state=checked]:border-otto-teal"
            />
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-3 text-[10px]">
          <div>
            <span className="text-otto-gray">Duration </span>
            <span className="text-white font-medium">{formatDuration(run.duration_seconds)}</span>
          </div>
          <div>
            <span className="text-otto-gray">Vehicles </span>
            <span className="text-white font-medium">{run.vehicles_processed ?? 0}</span>
          </div>
          <div>
            <span className="text-otto-gray">Turnaround </span>
            <span className="text-white font-medium">{run.avg_turnaround_minutes?.toFixed(1) ?? '—'}m</span>
          </div>
          <div>
            <span className="text-otto-gray">Uptime </span>
            <span className="text-white font-medium">{(kpis.fleetUptimePct ?? 0).toFixed(0)}%</span>
          </div>
        </div>

        {/* Alert badges */}
        <div className="flex gap-1.5">
          {(run.alert_count_critical ?? 0) > 0 && (
            <Badge className="bg-otto-red/20 text-otto-red border-otto-red/30 text-[10px] px-1.5 py-0">
              {run.alert_count_critical} Critical
            </Badge>
          )}
          {(run.alert_count_warning ?? 0) > 0 && (
            <Badge className="bg-otto-amber/20 text-otto-amber border-otto-amber/30 text-[10px] px-1.5 py-0">
              {run.alert_count_warning} Warning
            </Badge>
          )}
          {(run.alert_count_info ?? 0) > 0 && (
            <Badge className="bg-otto-teal/20 text-otto-teal border-otto-teal/30 text-[10px] px-1.5 py-0">
              {run.alert_count_info} Info
            </Badge>
          )}
        </div>

        {/* AI Summary preview */}
        {run.ai_summary && (
          <p className="text-[10px] text-otto-gray line-clamp-2 italic">
            {run.ai_summary.slice(0, 100)}…
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 pt-1">
          <Button
            size="sm"
            className="h-6 text-[10px] bg-otto-teal/20 text-otto-teal hover:bg-otto-teal/30 border-0"
            onClick={() => loadConfig(run)}
          >
            <Download size={10} /> Load Config
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-otto-gray hover:text-otto-red">
                <Trash2 size={10} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-otto-dark border-white/10">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Delete run?</AlertDialogTitle>
                <AlertDialogDescription className="text-otto-gray">
                  This will permanently delete "{run.name}".
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-white/10 text-white">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-otto-red hover:bg-otto-red/90"
                  onClick={() => deleteRun(run.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
};

/* ── Delta Indicator ── */
const Delta = ({ a, b, higherIsBetter }: { a: number; b: number; higherIsBetter: boolean }) => {
  const diff = b - a;
  if (Math.abs(diff) < 0.01) return <Minus size={12} className="text-otto-gray" />;
  const improved = higherIsBetter ? diff > 0 : diff < 0;
  return improved
    ? <ArrowUpRight size={12} className="text-otto-teal" />
    : <ArrowDownRight size={12} className="text-otto-red" />;
};

/* ── Comparison View ── */
const ComparisonView = ({ runA, runB }: { runA: SimulationRun; runB: SimulationRun }) => {
  const { setCompareMode } = useHistoryStore();
  const kpiA = (runA.kpi_results || {}) as Record<string, number>;
  const kpiB = (runB.kpi_results || {}) as Record<string, number>;
  const cfgA = (runA.config || {}) as Record<string, unknown>;
  const cfgB = (runB.config || {}) as Record<string, unknown>;

  // Find config differences
  const allKeys = [...new Set([...Object.keys(cfgA), ...Object.keys(cfgB)])];
  const diffs = allKeys.filter((k) => JSON.stringify(cfgA[k]) !== JSON.stringify(cfgB[k]));

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Button size="sm" variant="ghost" className="h-6 text-otto-gray" onClick={() => setCompareMode(false)}>
          <ArrowLeft size={12} /> Back
        </Button>
        <span className="text-xs text-white font-medium">Comparing Runs</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-xs">
            <div className="text-otto-teal font-medium truncate">{runA.name}</div>
            <div className="text-otto-gray">vs</div>
            <div className="text-otto-teal font-medium truncate text-right">{runB.name}</div>
          </div>

          {/* KPI comparison */}
          <div className="space-y-1">
            <h4 className="text-[10px] text-otto-gray uppercase tracking-wider">KPIs</h4>
            {Object.entries(KPI_META).map(([key, meta]) => {
              const valA = kpiA[key] ?? 0;
              const valB = kpiB[key] ?? 0;
              return (
                <div key={key} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-[11px] py-0.5">
                  <span className="text-white text-right tabular-nums">
                    {valA.toFixed(1)}{meta.unit}
                  </span>
                  <div className="flex items-center gap-1 justify-center min-w-[80px]">
                    <Delta a={valA} b={valB} higherIsBetter={meta.higherIsBetter} />
                    <span className="text-otto-gray text-[10px] truncate">{meta.label}</span>
                  </div>
                  <span className="text-white tabular-nums">
                    {valB.toFixed(1)}{meta.unit}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Config differences */}
          {diffs.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[10px] text-otto-gray uppercase tracking-wider">Config Differences</h4>
              {diffs.map((key) => (
                <div key={key} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-[11px] py-0.5 bg-otto-amber/5 px-2 rounded">
                  <span className="text-otto-amber text-right">{String(cfgA[key] ?? '—')}</span>
                  <span className="text-otto-gray text-[10px] text-center truncate min-w-[80px]">{key}</span>
                  <span className="text-otto-amber">{String(cfgB[key] ?? '—')}</span>
                </div>
              ))}
            </div>
          )}

          {/* AI Summaries */}
          {(runA.ai_summary || runB.ai_summary) && (
            <div className="space-y-1">
              <h4 className="text-[10px] text-otto-gray uppercase tracking-wider">AI Summaries</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-[10px] text-otto-gray bg-white/5 p-2 rounded">
                  {runA.ai_summary || 'No AI summary'}
                </div>
                <div className="text-[10px] text-otto-gray bg-white/5 p-2 rounded">
                  {runB.ai_summary || 'No AI summary'}
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

/* ── Main HistoryTab ── */
export const HistoryTab = () => {
  const { runs, isLoading, error, selectedForCompare, compareMode, setCompareMode, fetchRuns } = useHistoryStore();

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Comparison mode
  if (compareMode && selectedForCompare.length === 2) {
    const runA = runs.find((r) => r.id === selectedForCompare[0]);
    const runB = runs.find((r) => r.id === selectedForCompare[1]);
    if (runA && runB) return <ComparisonView runA={runA} runB={runB} />;
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-otto-gray">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading runs…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-otto-gray gap-2 p-4">
        <p className="text-xs text-center">Could not load history. The simulation works fully without persistence.</p>
        <p className="text-[10px] text-otto-red">{error}</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-otto-gray p-4">
        <p className="text-xs text-center">No saved runs yet. Pause a simulation to auto-save it.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Compare button */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
        <span className="text-xs text-otto-gray">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
        <Button
          size="sm"
          className="h-6 text-[10px] bg-otto-teal/20 text-otto-teal hover:bg-otto-teal/30 border-0"
          disabled={selectedForCompare.length !== 2}
          onClick={() => setCompareMode(true)}
        >
          <GitCompare size={10} /> Compare ({selectedForCompare.length}/2)
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
