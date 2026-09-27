// ============================================================================
// TwinAlertsTab — the Events tab: what HAPPENED in the depot, in sim time.
//
// It used to render ottoq_twin_snapshot.recent_events: the newest 15 rows by REAL insert time. On run 736406cf
// two-thirds of those were whole-row audit diffs ("Vehicle.state changed · vehicle"), passing rule checks arrived
// painted critical because they carried the rule's severity, per-tick summaries restated themselves every tick,
// and the clock read real time (01:33) beside a cockpit on sim time (14:40 CT).
//
// Now it reads ottoq_run_event_feed (otto-q-core 0462): sim time, no audit trail, a per-tick summary collapsed into
// one row that says how often and since when, entity names resolved. Like the Decisions stream, polling stops
// while the sim is paused so a reader can scroll without the list moving.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Activity, BatteryCharging, Truck, Building2, FileText } from "lucide-react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import { formatClockCT } from "@/components/tabs/TwinDecisionLogTab";
import {
  DEFAULT_DOMAINS, DOMAIN_META, describeEvent, eventDomain, eventTone, repeatText,
  type EventDomain, type RunEventRow,
} from "@/lib/eventFeed";

const POLL_MS = 10_000;
const WINDOW_MIN = 120;

const TONE: Record<ReturnType<typeof eventTone>, { color: string; ring: string }> = {
  critical: { color: "text-brand-hot", ring: "border-brand-hot/30 bg-brand-hot/5" },
  problem: { color: "text-state-warn", ring: "border-state-warn/25 bg-state-warn/5" },
  normal: { color: "text-ink-dim", ring: "border-white/[0.06] bg-white/[0.02]" },
};

const DOMAIN_ICON: Record<EventDomain, typeof Activity> = {
  charging: BatteryCharging, vehicles: Truck, depot: Building2, records: FileText,
};

function useRunEvents(simRunId: string | null, paused: boolean) {
  const [rows, setRows] = useState<RunEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A new or absent run replaces the list; pausing only suspends it.
  useEffect(() => { setRows([]); setError(null); }, [simRunId]);

  useEffect(() => {
    if (!simRunId || paused) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data, error: e } = await ottoQ.rpc("ottoq_run_event_feed", {
          p_sim_run_id: simRunId, p_limit: 120, p_window_min: WINDOW_MIN,
        });
        if (cancelled) return;
        if (e) { setError(String(e.message ?? e)); return; }
        setError(null);
        setRows((data as RunEventRow[] | null) ?? []);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [simRunId, paused]);

  return { rows, error };
}

export const TwinAlertsTab = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const { rows, error } = useRunEvents(activeSimRunId, paused);
  const [shown, setShown] = useState<Set<EventDomain>>(() => new Set(DEFAULT_DOMAINS));
  const [problemsOnly, setProblemsOnly] = useState(false);

  const counts = useMemo(() => {
    const c: Record<EventDomain, number> = { charging: 0, vehicles: 0, depot: 0, records: 0 };
    for (const r of rows) c[eventDomain(r.event_type)] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(
    () => rows.filter((r) => shown.has(eventDomain(r.event_type)) && (!problemsOnly || eventTone(r.severity) !== "normal")),
    [rows, shown, problemsOnly],
  );

  if (!activeSimRunId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <span className="text-ink-faint text-xs">Start a run on the Control tab to see what happens in the depot.</span>
      </div>
    );
  }

  const toggle = (d: EventDomain) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-white/[0.06] px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Activity size={14} className="shrink-0 text-brand-cool" />
            <span className="truncate text-[11px] font-display uppercase tracking-wide text-ink-dim">Events</span>
            {paused && <span className="rounded border border-white/[0.08] px-1 text-[9px] font-mono text-ink-faint">PAUSED</span>}
          </div>
          {error && <span className="min-w-0 truncate text-[9px] text-brand-hot" title={error}>{error}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(DOMAIN_META) as EventDomain[]).map((d) => {
            const on = shown.has(d);
            const m = DOMAIN_META[d];
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                aria-pressed={on}
                className={`rounded border px-1.5 py-0.5 text-[9px] font-mono transition-colors ${
                  on ? "text-ink" : "text-ink-faint border-white/[0.06] hover:text-ink-dim"
                }`}
                style={on ? { borderColor: `${m.color}66`, background: `${m.color}1A` } : undefined}
              >
                {m.label} {counts[d]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setProblemsOnly((v) => !v)}
            aria-pressed={problemsOnly}
            className={`ml-auto rounded border px-1.5 py-0.5 text-[9px] font-mono transition-colors ${
              problemsOnly ? "text-state-warn border-state-warn/40 bg-state-warn/10" : "text-ink-faint border-white/[0.06] hover:text-ink-dim"
            }`}
          >
            Problems only
          </button>
        </div>
        <p className="text-[9px] leading-3.5 text-ink-faint">
          The last two sim-hours. A summary the engine repeats every tick is one row with a count. Times are sim time, CT.
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {visible.length === 0 && !error && (
            <div className="text-ink-faint text-xs text-center py-8">
              {rows.length > 0 ? "Nothing in the filters shown." : paused ? "Paused before anything arrived." : "No events yet."}
            </div>
          )}
          {visible.map((r) => {
            const tone = TONE[eventTone(r.severity)];
            const domain = eventDomain(r.event_type);
            const Icon = eventTone(r.severity) === "normal" ? DOMAIN_ICON[domain] : AlertTriangle;
            const text = describeEvent(r.event_type, r.payload);
            const rep = repeatText(r, (iso) => formatClockCT(iso).slice(0, 5));
            return (
              <div key={r.row_key} className={`flex items-start gap-2 rounded-md border px-2.5 py-2 ${tone.ring}`} title={r.event_type}>
                <Icon size={13} className={`${tone.color} mt-0.5 shrink-0`} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] text-ink">{text.title}</span>
                    <span className="shrink-0 font-mono text-[9px] text-ink-faint">{formatClockCT(r.sim_at)}</span>
                  </div>
                  {text.detail && <span className="truncate text-[10px] text-ink-dim" title={text.detail}>{text.detail}</span>}
                  {(r.entity_name || rep || r.standing) && (
                    <div className="flex items-center gap-1.5 text-[9px] text-ink-faint">
                      {r.entity_name && <span className="truncate">{r.entity_name}</span>}
                      {rep && <span className="font-mono">{rep}</span>}
                      {r.standing && <span className="rounded bg-white/[0.06] px-1 font-mono text-ink-dim">now</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
