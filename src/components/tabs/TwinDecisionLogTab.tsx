// TwinDecisionLogTab — the live "why" stream from OTTO-Q's decision ledger.
//
// Polls ottoq_activity_feed every 4s while a run is active AND NOT PAUSED.
// Chase, 2026-09-21: "If I pause the depot or the simulation at any given point
// that should also pause the intelligence live stream ... so that I can toggle
// over to it and scroll through recent decisions or proposals." The polling
// half of that lives in useActivityFeed; what this file adds is saying so on
// screen, and making the stream stable enough to actually read while frozen:
// rows are keyed by their ledger identity (rowKey), so a merge cannot renumber
// the list under a reader mid-scroll.
//
// CHANGES, NOT RESTATEMENTS (2026-09-23, otto-q-core 0452-0455). The decide path
// writes a verdict for every waiting vehicle on every tick, so the raw feed was
// 97% the same verdict restated: 39 "Promote -> promote_ready" rows a tick, and
// the newest 500 rows held no agent decision at all. The feed is now read in
// changes-only mode: one row when a vehicle's verdict CHANGES, carrying how long
// it then held and whether it still does. And each row now says what was
// decided and why in words, from the decision's own verb and reason, instead of
// the engine's name ("deterministic_v1") or a JSON blob.
import { useMemo, useState, type ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useActivityFeedStore, rowKey, type ActivityFeedRow } from "@/store/activityFeedStore";
import {
  Brain, Truck, BatteryCharging, CalendarClock,
  ArrowRight, Pause, Radio,
} from "lucide-react";
// The verdict in words, and the category it is filed under, live in src/lib/decisionText.ts so PULSE and
// OrchestrAV carry the same file verbatim.
import {
  formatClockCT, describeDecision, decisionReasonText, holdText, PROVIDER_LABEL, solverLabel, kernelLabel, starvationNote, modelErrorText,
  human, num, isPlace, decisionCategory, DEFAULT_CATEGORIES, CATEGORY_LABEL,
  type DecisionText, type DecisionTone, type DecisionCategory,
} from "@/lib/decisionText";

// ── categories: what an operator filters by ─────────────────────────────────
// The category of a decision and its label are shared with PULSE and OrchestrAV (src/lib/decisionText.ts);
// the icon and colour are this cockpit's own.
export const CATEGORY_META: Record<DecisionCategory, { label: string; color: string; icon: typeof Brain }> = {
  agent: { label: CATEGORY_LABEL.agent, color: "#A78BFA", icon: Brain },
  dispatch: { label: CATEGORY_LABEL.dispatch, color: "#00B4A6", icon: Truck },
  energy: { label: CATEGORY_LABEL.energy, color: "#F59E0B", icon: BatteryCharging },
  plans: { label: CATEGORY_LABEL.plans, color: "#7B818D", icon: CalendarClock },
};

export {
  formatClockCT, describeDecision, decisionReasonText, holdText, PROVIDER_LABEL, solverLabel, kernelLabel, starvationNote, modelErrorText,
  decisionCategory, DEFAULT_CATEGORIES,
};
export type { DecisionText, DecisionTone, DecisionCategory };

const Chip = ({ tone, children, title }: { tone: "violet" | "cyan" | "emerald" | "amber"; children: ReactNode; title?: string }) => {
  const cls = {
    violet: "border-violet-400/30 bg-violet-400/10 text-violet-300",
    cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
    emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  }[tone];
  // CHIPS MUST BE ABLE TO WRAP INSIDE THEMSELVES (min-w-0 max-w-full break-words): a
  // flex item defaults to min-width:auto, so one long chip overflowed the side panel
  // and was clipped (Chase, 2026-09-22).
  return <span title={title} className={`min-w-0 max-w-full break-words rounded border px-1.5 py-0.5 ${cls}`}>{children}</span>;
};

const AgentPipeline = ({ r }: { r: ActivityFeedRow }) => {
  const detail = r.rationale ?? {};
  const objective = human(detail.objective ?? "readiness_first");
  const modelError = modelErrorText(detail.model_error);
  const model = typeof detail.agent_model === "string" ? detail.agent_model.split("/").pop() : null;
  const solverStatus = String(detail.handoff_status ?? detail.solver_status ?? "queued");
  const returned = Number(detail.proposals_returned ?? 0);
  const attempts = Array.isArray(detail.retry_attempts) ? detail.retry_attempts.length : 0;
  const chainId = typeof detail.chain_id === "string" ? detail.chain_id.slice(0, 8) : null;
  const late = num(detail.advice_ticks_late);
  const starved = starvationNote(detail);
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

  return (
    <div className="mt-1.5 space-y-1">
      {modelError ? (
        <p className="break-words text-[9px] leading-4 text-amber-300/90">
          {/^model /.test(modelError) ? `M${modelError.slice(1)}` : `Model unavailable (${modelError})`}. The deterministic
          path decided this pass; the solver was still asked.
        </p>
      ) : typeof detail.summary === "string" && detail.summary ? (
        <p className="text-[9px] leading-4 text-ink-dim line-clamp-3">{detail.summary}</p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[9px]">
        <Chip tone="violet" title={model ? `model: ${model}` : "no model answered this pass"}>
          {modelError ? "Fallback" : "Agent"}: {objective}
        </Chip>
        <ArrowRight size={9} className="shrink-0 text-ink-faint" />
        <Chip tone="cyan">
          {solverLabel(detail)}: {human(solverStatus)} {returned > 0 ? `(${returned} proposed)` : ""}
        </Chip>
        <ArrowRight size={9} className="shrink-0 text-ink-faint" />
        <Chip tone="emerald">Kernel: {kernelLabel(detail)}</Chip>
      </div>
      {starved && <p className="break-words text-[9px] leading-4 text-amber-300/80">{starved}</p>}
      <div className="flex min-w-0 flex-wrap gap-x-2 font-mono text-[9px] text-ink-faint">
        <span>applied {count(detail.applied)}</span>
        {count(detail.queued) > 0 && <span>queued for approval {count(detail.queued)}</span>}
        <span>rejected {count(detail.rejected)}</span>
        {late != null && (
          <span title="Ticks between the tick the advice was computed from and the tick it was applied at. The tick never waits for the agent.">
            applied {late} tick{late === 1 ? "" : "s"} later
          </span>
        )}
        {attempts > 1 && <span>solve attempts {attempts}</span>}
        {chainId && <span>chain {chainId}</span>}
      </div>
      {typeof detail.objective_why === "string" && detail.objective_why && !modelError && (
        <p className="break-words text-[9px] leading-4 text-ink-faint">Why this objective: {detail.objective_why}</p>
      )}
    </div>
  );
};

const TONE_COLOR: Record<DecisionTone, string> = {
  enacted: "#00B4A6",
  held: "#E8893F",
  warn: "#C8102E",
  idle: "#7B818D",
};

export const Row = ({ r, isNew = false }: { r: ActivityFeedRow; isNew?: boolean }) => {
  const category = decisionCategory(r.action);
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const isAgent = r.action === "orchestrator_agent";
  const text = useMemo(() => (isAgent ? null : describeDecision(r)), [r, isAgent]);
  const hold = holdText(r);
  const verb = typeof r.rationale?.verb === "string" ? r.rationale.verb : "";
  const place = isPlace(r.target, verb) ? r.target : null;
  const who = isAgent ? "OTTO-Q agent" : r.display_name || (r.action === "bess_dispatch" ? "Site battery" : r.vehicle_id?.slice(0, 8));

  return (
    <div
      className={`flex items-start gap-2 rounded-md px-2.5 py-2 border transition-colors hover:bg-white/[0.03] ${
        isNew ? "border-brand-cool/40 bg-brand-cool/[0.07]" : "border-white/[0.06]"
      }`}
    >
      <span
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-display uppercase tracking-wide leading-none shrink-0"
        style={{ color: meta.color, background: `${meta.color}1A`, border: `1px solid ${meta.color}40` }}
      >
        <Icon size={10} />
        {meta.label}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] text-ink truncate font-medium">{who}</span>
          {place && (
            <>
              <ArrowRight size={10} className="text-ink-faint shrink-0" />
              <span className="font-mono text-[10px] text-ink-dim truncate">{place}</span>
            </>
          )}
        </div>
        {isAgent ? (
          <AgentPipeline r={r} />
        ) : text && (
          <div className="mt-0.5 min-w-0">
            <span className="text-[10px]" style={{ color: TONE_COLOR[text.tone] }}>{text.title}</span>
            {text.detail && <span className="text-[9px] text-ink-faint"> · {text.detail}</span>}
          </div>
        )}
        {hold && <div className={`text-[9px] mt-0.5 ${r.standing ? "text-ink-dim" : "text-ink-faint"}`}>{hold}</div>}
      </div>

      <span className="font-mono text-[9px] tabular-nums text-ink-faint shrink-0" title="sim time, CT">
        {formatClockCT(r.occurred_at)}
      </span>
    </div>
  );
};

/** LIVE / PAUSED chip. Exported so the Intelligence tab shows the same state
 *  rather than inventing a second vocabulary for one fact. */
export const StreamState = ({ frozen }: { frozen: boolean }) =>
  frozen ? (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] text-amber-300"
      title="The simulation is paused, so the stream is frozen and no polling is happening. Everything already received stays scrollable."
    >
      <Pause size={9} /> paused
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] text-emerald-300">
      <Radio size={9} /> live
    </span>
  );

export default function TwinDecisionLogTab() {
  useActivityFeed();
  const { rows, error, frozen, arrivedKeys } = useActivityFeedStore();
  const arrived = useMemo(() => new Set(arrivedKeys), [arrivedKeys]);
  const [shown, setShown] = useState<Set<DecisionCategory>>(() => new Set(DEFAULT_CATEGORIES));

  const counts = useMemo(() => {
    const c: Record<DecisionCategory, number> = { agent: 0, dispatch: 0, energy: 0, plans: 0 };
    for (const r of rows) c[decisionCategory(r.action)]++;
    return c;
  }, [rows]);
  const visible = useMemo(() => rows.filter((r) => shown.has(decisionCategory(r.action))), [rows, shown]);
  const toggle = (c: DecisionCategory) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });

  return (
    <div className="flex flex-col h-full">
      {/* min-w-0 on both halves, and the error truncates rather than pushing the
          LIVE/PAUSED chip past the panel's right edge (the panel clips). */}
      <div className="shrink-0 border-b border-white/[0.06] px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Brain size={14} className="shrink-0 text-brand-cool" />
            <span className="truncate text-[11px] font-display uppercase tracking-wide text-ink-dim">Decisions</span>
            <StreamState frozen={frozen} />
          </div>
          {error && (
            <span className="min-w-0 truncate text-[9px] text-brand-hot" title={error}>{error}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(CATEGORY_META) as DecisionCategory[]).map((c) => {
            const on = shown.has(c);
            const m = CATEGORY_META[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                aria-pressed={on}
                className={`rounded border px-1.5 py-0.5 text-[9px] font-mono transition-colors ${
                  on ? "text-ink" : "text-ink-faint border-white/[0.06] hover:text-ink-dim"
                }`}
                style={on ? { borderColor: `${m.color}66`, background: `${m.color}1A` } : undefined}
              >
                {m.label} {counts[c]}
              </button>
            );
          })}
        </div>
        <p className="text-[9px] leading-3.5 text-ink-faint">
          One row when a decision changes, not every tick it is restated. Times are sim time, CT.
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {visible.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-ink-faint">
              <Brain size={24} className="opacity-30" />
              <span className="text-[11px] text-center px-4">
                {rows.length > 0
                  ? "Nothing in the categories shown. Turn one on above."
                  : frozen
                    ? "Paused with nothing received yet. Resume the run to start the stream."
                    : "No decisions yet. Start a run to see OTTO-Q decide."}
              </span>
            </div>
          )}
          {visible.map((r) => (
            <Row key={rowKey(r)} r={r} isNew={arrived.has(rowKey(r))} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
