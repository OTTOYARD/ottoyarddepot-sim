// ============================================================================
// TwinHistoryTab — run-history ledger + 2-run compare, from the backend
// (ottoq_twin_run_list via GET /sim_runs). Replaces the legacy client-engine
// HistoryTab. All metrics are run-scoped (keyed on sim_run_id) so they're
// reproducible per run. The currently-live run is badged; a running/paused run
// can be re-opened in the cockpit.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight, Minus, GitCompare,
  Loader2, RefreshCw, Radio, Play, Download,
} from "lucide-react";
import { twin, type TwinRunSummary } from "@/lib/ottoTwin";
import { downloadBlackbox } from "@/lib/blackbox";
import { useTwinStore } from "@/store/twinStore";
import { toast } from "sonner";

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return `${new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Chicago" })} CT`; }
  catch { return "—"; }
};
const fmtDur = (min: number) => {
  if (!min) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const STATUS_COLOR: Record<string, string> = {
  running: "text-state-go border-state-go/30 bg-state-go/5",
  paused: "text-state-warn border-state-warn/30 bg-state-warn/5",
  completed: "text-ink-dim border-white/[0.1] bg-white/[0.03]",
  failed: "text-brand-hot border-brand-hot/30 bg-brand-hot/5",
};

// metrics shown in compare, with direction (true = higher is better, null = neither: a count of
// telemetry packets or events says how much happened, not how well, so it gets a grey arrow)
const METRICS: { key: keyof TwinRunSummary["counters"]; label: string; better: boolean | null }[] = [
  { key: "dispatches_total", label: "Dispatches", better: true },
  { key: "charge_sessions", label: "Charge sessions", better: null },
  { key: "telemetry_packets", label: "Telemetry pkts", better: null },
  { key: "faults", label: "Faults", better: false },
  { key: "incidents_open", label: "Incidents open", better: false },
  { key: "events_total", label: "Events", better: null },
];

const Delta = ({ a, b, better }: { a: number; b: number; better: boolean | null }) => {
  const d = b - a;
  if (Math.abs(d) < 0.5) return <Minus size={12} className="text-ink-faint" />;
  if (better === null) {
    return d > 0 ? <ArrowUpRight size={12} className="text-ink-faint" /> : <ArrowDownRight size={12} className="text-ink-faint" />;
  }
  const good = better ? d > 0 : d < 0;
  return good ? <ArrowUpRight size={12} className="text-state-go" /> : <ArrowDownRight size={12} className="text-brand-hot" />;
};

/** The forensic bundle for one run (ottoq-run-blackbox). ~20 MB and ~12 s, so it shows a spinner. */
const BlackBoxButton = ({ simRunId }: { simRunId: string }) => {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      await downloadBlackbox(simRunId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Black Box download failed");
    } finally {
      setBusy(false);
    }
  }, [simRunId]);
  return (
    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-ink-dim hover:text-ink" onClick={run} disabled={busy}
      title="Download this run's Black Box: every decision, event and ledger row, as one JSON file">
      {busy ? <Loader2 size={10} className="mr-1 animate-spin" /> : <Download size={10} className="mr-1" />} Black Box
    </Button>
  );
};

/* ── Run card ── */
const RunCard = ({ run, selected, onToggle, isLive, onOpen }: {
  run: TwinRunSummary; selected: boolean; onToggle: () => void; isLive: boolean; onOpen: () => void;
}) => {
  const c = run.counters;
  const v = run.variability;
  const canOpen = run.status === "running" || run.status === "paused";
  return (
    <div className={`rounded-lg border bg-canvas-panel p-3 space-y-2 ${selected ? "border-brand-red/50 ring-1 ring-brand-red/30" : "border-white/[0.06]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-ink capitalize truncate">{run.scenario.replace(/_/g, " ")}</span>
            {isLive && <span className="flex items-center gap-0.5 text-[8px] text-state-go"><Radio size={9} className="animate-pulse" /> LIVE</span>}
          </div>
          <span className="text-[10px] text-ink-faint">{fmtDate(run.started_at)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`font-mono text-[8px] uppercase tracking-wide border rounded px-1 py-0.5 ${STATUS_COLOR[run.status] ?? STATUS_COLOR.completed}`}>{run.status}</span>
          <Checkbox checked={selected} onCheckedChange={onToggle} className="border-ink-faint data-[state=checked]:bg-brand-red data-[state=checked]:border-brand-red" />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          { l: "Sim", v: fmtDur(run.sim_minutes) },
          { l: "Ticks", v: String(run.tick_count) },
          { l: "Dispatch", v: String(c.dispatches_total) },
          { l: "Charge", v: String(c.charge_sessions) },
        ].map((s) => (
          <div key={s.l} className="rounded bg-white/[0.02] py-1">
            <div className="font-mono text-[12px] text-ink tabular-nums">{s.v}</div>
            <div className="text-[8px] text-ink-faint uppercase tracking-wide">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {c.faults > 0 && <span className="text-[9px] text-state-warn border border-state-warn/25 rounded px-1 py-0.5">{c.faults} faults</span>}
        {c.incidents_open > 0 && <span className="text-[9px] text-brand-hot border border-brand-hot/25 rounded px-1 py-0.5">{c.incidents_open} open incidents</span>}
        {c.telemetry_packets > 0 && <span className="text-[9px] text-ink-dim border border-white/[0.08] rounded px-1 py-0.5">{c.telemetry_packets.toLocaleString()} telemetry</span>}
        {v && v.tuned_knobs > 0 && <span className="text-[9px] text-state-info border border-state-info/25 rounded px-1 py-0.5">{v.tuned_knobs} knobs tuned</span>}
        {v && v.spread_mult !== 1 && <span className="text-[9px] text-state-info border border-state-info/25 rounded px-1 py-0.5">spread ×{v.spread_mult}</span>}
        {v && v.rate_mult !== 1 && <span className="text-[9px] text-state-info border border-state-info/25 rounded px-1 py-0.5">rate ×{v.rate_mult}</span>}
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <span className="font-mono text-[8px] text-ink-faint">seed {run.seed}</span>
        <div className="flex items-center gap-1">
          <BlackBoxButton simRunId={run.sim_run_id} />
          {canOpen && !isLive && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-brand-red hover:text-brand-red/80" onClick={onOpen}>
              <Play size={10} className="mr-1" /> Open in cockpit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Compare view ── */
const CompareView = ({ a, b, onBack }: { a: TwinRunSummary; b: TwinRunSummary; onBack: () => void }) => (
  <div className="flex flex-col h-full">
    <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
      <Button size="sm" variant="ghost" className="h-6 text-ink-dim hover:text-ink" onClick={onBack}><ArrowLeft size={12} className="mr-1" /> Back</Button>
      <span className="text-xs text-ink font-medium">Compare runs</span>
    </div>
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-4">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-xs items-center">
          <div className="text-brand-red font-medium capitalize truncate text-right">{a.scenario.replace(/_/g, " ")}</div>
          <div className="text-ink-faint text-[10px]">vs</div>
          <div className="text-brand-red font-medium capitalize truncate">{b.scenario.replace(/_/g, " ")}</div>
        </div>

        <div className="space-y-1">
          <h4 className="font-display text-[10px] text-ink-faint uppercase tracking-wider">Run-scoped metrics</h4>
          {METRICS.map((m) => {
            const va = a.counters[m.key] ?? 0, vb = b.counters[m.key] ?? 0;
            return (
              <div key={m.key} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-[11px] py-0.5">
                <span className="text-ink text-right tabular-nums">{va.toLocaleString()}</span>
                <div className="flex items-center gap-1 justify-center min-w-[110px]">
                  <Delta a={va} b={vb} better={m.better} />
                  <span className="text-ink-faint text-[10px] truncate">{m.label}</span>
                </div>
                <span className="text-ink tabular-nums">{vb.toLocaleString()}</span>
              </div>
            );
          })}
          {/* sim duration + ticks (informational, no direction) */}
          {[
            { l: "Sim minutes", va: a.sim_minutes, vb: b.sim_minutes },
            { l: "Ticks", va: a.tick_count, vb: b.tick_count },
          ].map((row) => (
            <div key={row.l} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-[11px] py-0.5">
              <span className="text-ink-dim text-right tabular-nums">{row.va}</span>
              <div className="flex items-center justify-center min-w-[110px]"><span className="text-ink-faint text-[10px]">{row.l}</span></div>
              <span className="text-ink-dim tabular-nums">{row.vb}</span>
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <h4 className="font-display text-[10px] text-ink-faint uppercase tracking-wider">Variability fingerprint</h4>
          {[
            { l: "Knobs tuned", va: a.variability?.tuned_knobs ?? 0, vb: b.variability?.tuned_knobs ?? 0 },
            { l: "Spread ×", va: a.variability?.spread_mult ?? 1, vb: b.variability?.spread_mult ?? 1 },
            { l: "Event-rate ×", va: a.variability?.rate_mult ?? 1, vb: b.variability?.rate_mult ?? 1 },
            { l: "Seed", va: a.seed, vb: b.seed },
          ].map((row) => {
            const diff = row.va !== row.vb;
            return (
              <div key={row.l} className={`grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-[11px] py-0.5 px-2 rounded ${diff ? "bg-state-info/5" : ""}`}>
                <span className={`text-right tabular-nums ${diff ? "text-state-info" : "text-ink-dim"}`}>{row.va}</span>
                <div className="flex items-center justify-center min-w-[110px]"><span className="text-ink-faint text-[10px]">{row.l}</span></div>
                <span className={`tabular-nums ${diff ? "text-state-info" : "text-ink-dim"}`}>{row.vb}</span>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  </div>
);

/* ── Main ── */
export const TwinHistoryTab = () => {
  const [runs, setRuns] = useState<TwinRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const setActiveSimRunId = useTwinStore((s) => s.setActiveSimRunId);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    twin.runs(30)
      .then((d) => setRuns(d.runs ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load runs"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 2 ? [s[1], id] : [...s, id]));

  if (comparing && selected.length === 2) {
    const a = runs.find((r) => r.sim_run_id === selected[0]);
    const b = runs.find((r) => r.sim_run_id === selected[1]);
    if (a && b) return <CompareView a={a} b={b} onBack={() => setComparing(false)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-xs text-ink-dim">{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-ink-dim hover:text-ink" onClick={load}><RefreshCw size={11} className={loading ? "animate-spin" : ""} /></Button>
          <Button size="sm" className="h-6 text-[10px] bg-brand-red/15 text-brand-red hover:bg-brand-red/25 border-0" disabled={selected.length !== 2} onClick={() => setComparing(true)}>
            <GitCompare size={11} className="mr-1" /> Compare ({selected.length}/2)
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-ink-faint text-xs"><Loader2 className="animate-spin mr-2" size={14} /> Loading runs…</div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1 p-4 text-center">
          <p className="text-xs text-ink-dim">Could not load run history.</p>
          <p className="text-[10px] text-brand-hot">{error}</p>
          <Button size="sm" variant="ghost" className="mt-1 text-[10px] text-ink-dim" onClick={load}>Retry</Button>
        </div>
      ) : runs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center"><p className="text-xs text-ink-faint">No runs yet. Start a scenario in Run Control.</p></div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            {runs.map((run) => (
              <RunCard
                key={run.sim_run_id}
                run={run}
                selected={selected.includes(run.sim_run_id)}
                onToggle={() => toggle(run.sim_run_id)}
                isLive={run.sim_run_id === activeSimRunId}
                onOpen={() => setActiveSimRunId(run.sim_run_id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
