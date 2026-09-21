// TwinDecisionLogTab — the live "why" stream from OTTO-Q's decision ledger.
//
// Polls ottoq_activity_feed every 4s while a run is active AND NOT PAUSED.
// Chase, 2026-09-21: "If I pause the depot or the simulation at any given point
// that should also pause the intelligence live stream ... so that I can toggle
// over to it and scroll through recent decisions or proposals." The polling
// half of that lives in useActivityFeed; what this file adds is saying so on
// screen, and making the stream stable enough to actually read while frozen:
// rows are keyed by their content identity (rowKey) rather than array index, so
// a merge cannot renumber the list under a reader mid-scroll.
import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useActivityFeedStore, rowKey, type ActivityFeedRow } from "@/store/activityFeedStore";
import {
  Brain, ShieldCheck, Zap, Droplets, Wrench, Truck,
  ArrowRight, Clock, AlertTriangle, CheckCircle2, XCircle, Pause, Radio,
} from "lucide-react";

const ACTION_BADGE: Record<string, { label: string; color: string; icon: typeof Brain }> = {
  orchestrator_agent: { label: "Orchestrate", color: "#A78BFA", icon: Brain },
  task_start: { label: "Promote", color: "#00B4A6", icon: Truck },
  stall_assignment: { label: "Assign", color: "#C8102E", icon: Zap },
  shield_override: { label: "Shield", color: "#F59E0B", icon: ShieldCheck },
  wash_dispatch: { label: "Wash", color: "#3B82F6", icon: Droplets },
  service_dispatch: { label: "Service", color: "#E8893F", icon: Wrench },
};

function countItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function decisionReasonText(r: ActivityFeedRow): string | null {
  if (r.reason) return r.reason;
  if (!r.rationale) return null;
  const entries = Object.entries(r.rationale).filter(([, value]) =>
    value !== null && value !== undefined && !Array.isArray(value) && typeof value !== "object"
  );
  return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ") : null;
}

// Display names for the providers ottoq_model_call_ledger records. An unknown
// provider renders as its raw key rather than a guess — see solverLabel.
// Exported so intelligenceStack.test.ts can assert it agrees with
// STACK_PROVIDER_LABEL — two provider maps in one app is a drift waiting to
// happen, and a provider renamed in one place must fail a test, not a demo.
export const PROVIDER_LABEL: Record<string, string> = {
  nvidia_cuopt: "cuOpt",
  nvidia_nemotron: "Nemotron",
  cpsat_service: "CP-SAT",
  anthropic_advisor: "Advisor",
  local_fallback: "local fallback",
};

// THIS STRIP USED TO LIE, and the lie was in the engine's feed rather than here.
// otto-q-core migration 0346: ottoq_activity_feed joined the proposer fire log on
// fire->>'agent_chain_id' — a key present on 0 of 112 rows, matching 0 of 1,956
// agent decisions — and COALESCEd the solver name onto a hardcoded CP-SAT literal.
// So this label read "CP-SAT" on every line it has ever rendered, while CP-SAT had
// submitted nothing since 2026-09-14 and cuOpt did all the work; and planned /
// submitted were always NULL, so the kernel chip read "pending" on runs where the
// kernel had enacted every proposal.
//
// The feed now reports the measured provider or nothing at all. The rule here is
// the same one: render what it says, and never fill a gap with a name.
export function solverLabel(detail: Record<string, unknown>): string {
  const raw = typeof detail.solver_engine === "string" ? detail.solver_engine.trim() : "";
  if (!raw) return "no solver call";
  // one chain can be served by more than one provider; the feed joins them with '+'
  return raw.split("+").map((p) => PROVIDER_LABEL[p] ?? p).join(" + ");
}

// The kernel's own disposition, from ottoq_external_proposals joined on the chain
// id the producer actually writes. Never the fire log's `submitted`, which is the
// forward_lex bridge's number and is NULL for a cuOpt-served run.
export function kernelLabel(detail: Record<string, unknown>): string {
  const enacted = Number(detail.kernel_enacted ?? 0);
  const refused = Number(detail.kernel_refused ?? 0);
  const superseded = Number(detail.kernel_superseded ?? 0);
  if (enacted > 0) return `${enacted} enacted`;
  if (refused > 0) return `${refused} refused`;
  if (superseded > 0) return `${superseded} superseded`;
  const status = String(detail.solver_status ?? detail.handoff_status ?? "");
  return status === "empty" ? "no action" : "pending";
}

// G60, made visible: when every serviceable vehicle is already holding a charge
// place, the solver is handed an empty instance and can only abstain. An operator
// seeing "0 enacted" deserves to know the solver was never asked a question.
export function starvationNote(detail: Record<string, unknown>): string | null {
  const serviceable = Number(detail.frame_serviceable ?? 0);
  const held = Number(detail.frame_held ?? 0);
  if (serviceable > 0 && held >= serviceable) {
    return `solver saw an empty instance: all ${serviceable} serviceable vehicles already held a place`;
  }
  return null;
}

const AgentPipeline = ({ r }: { r: ActivityFeedRow }) => {
  const detail = r.rationale ?? {};
  const objective = String(detail.objective ?? "readiness_first");
  const solverStatus = String(detail.solver_status ?? detail.handoff_status ?? "queued");
  const returned = Number(detail.proposals_returned ?? 0);
  const attempts = Array.isArray(detail.retry_attempts) ? detail.retry_attempts.length : 0;
  const chainId = typeof detail.chain_id === "string" ? detail.chain_id.slice(0, 8) : null;
  const solver = solverLabel(detail);
  const kernel = kernelLabel(detail);
  const starved = starvationNote(detail);
  const unshielded = Number(detail.l1_rules_evaluated ?? 0) === 0;
  const slow = detail.agent_over_one_tick === true;

  return (
    <div className="mt-1.5 space-y-1">
      {typeof detail.summary === "string" && detail.summary && (
        <p className="text-[9px] leading-4 text-ink-dim line-clamp-3">{detail.summary}</p>
      )}
      <div className="flex flex-wrap items-center gap-1 text-[8px] font-mono">
        <span className="rounded border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-violet-300">
          Agent: {objective.replace(/_/g, " ")}
        </span>
        <ArrowRight size={9} className="text-ink-faint" />
        <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-cyan-300">
          {solver}: {solverStatus} {returned > 0 ? `(${returned} proposed)` : ""}
        </span>
        <ArrowRight size={9} className="text-ink-faint" />
        <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-emerald-300">
          Kernel: {kernel}
        </span>
        {slow && (
          <span
            className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-amber-300"
            title="The agent took longer than one 30-second beat, so the deterministic path fell back and this advice landed on a later tick."
          >
            agent &gt; 1 tick
          </span>
        )}
        {unshielded && (
          <span
            className="rounded border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-rose-300"
            title="No L1 rule was evaluated for this agent action. A policy-dial write is not a stall assignment, so the deterministic shield does not inspect it."
          >
            no L1 gate
          </span>
        )}
      </div>
      {starved && <p className="text-[8px] leading-3 text-amber-300/80">{starved}</p>}
      <div className="flex flex-wrap gap-x-2 text-[8px] text-ink-faint font-mono">
        <span>applied {countItems(detail.applied)}</span>
        <span>rejected {countItems(detail.rejected)}</span>
        <span>solve attempts {attempts || 1}</span>
        {chainId && <span>chain {chainId}</span>}
        {typeof detail.solver_evidence === "string" && (
          <span title="Which ledger answered for the solver leg. 'none' means no solver call was recorded — not that CP-SAT ran.">
            evidence {detail.solver_evidence}
          </span>
        )}
      </div>
      {typeof detail.objective_why === "string" && detail.objective_why && (
        <p className="text-[8px] leading-3 text-ink-faint">Why this objective: {detail.objective_why}</p>
      )}
    </div>
  );
};

const OUTCOME_ICON: Record<string, typeof CheckCircle2> = {
  enacted: CheckCircle2,
  refused: XCircle,
  shielded: ShieldCheck,
  deferred: Clock,
  error: AlertTriangle,
};

export const Row = ({ r, isNew = false }: { r: ActivityFeedRow; isNew?: boolean }) => {
  const badge = ACTION_BADGE[r.action] ?? { label: r.action, color: "#8A8F99", icon: Brain };
  const Icon = badge.icon;
  const OIcon = OUTCOME_ICON[r.outcome] ?? CheckCircle2;
  const outcomeColor = r.outcome === "enacted" ? "#00B4A6" : r.outcome === "refused" ? "#C8102E" : "#8A8F99";

  const reasonText = useMemo(() => decisionReasonText(r), [r]);
  const isAgent = r.action === "orchestrator_agent";

  return (
    <div
      className={`flex items-start gap-2 rounded-md px-2.5 py-2 border transition-colors hover:bg-white/[0.03] ${
        isNew ? "border-brand-cool/40 bg-brand-cool/[0.07]" : "border-white/[0.06]"
      }`}
    >
      <span
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-display uppercase tracking-wide leading-none shrink-0"
        style={{ color: badge.color, background: `${badge.color}1A`, border: `1px solid ${badge.color}40` }}
      >
        <Icon size={10} />
        {badge.label}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink truncate font-medium">{r.display_name || r.vehicle_id?.slice(0, 8)}</span>
          <ArrowRight size={10} className="text-ink-faint shrink-0" />
          <span className="font-mono text-[10px] text-ink-dim truncate">{r.target || "—"}</span>
        </div>
        {isAgent ? <AgentPipeline r={r} /> : reasonText && (
          <div className="text-[9px] text-ink-faint mt-0.5 truncate">{reasonText}</div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <OIcon size={12} style={{ color: outcomeColor }} />
        <span className="font-mono text-[9px] tabular-nums text-ink-faint" style={{ color: outcomeColor }}>
          {r.occurred_at ? new Date(r.occurred_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—"}
        </span>
      </div>
    </div>
  );
};

/** LIVE / PAUSED chip. Exported so the Intelligence tab shows the same state
 *  rather than inventing a second vocabulary for one fact. */
export const StreamState = ({ frozen }: { frozen: boolean }) =>
  frozen ? (
    <span
      className="inline-flex items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] text-amber-300"
      title="The simulation is paused, so the stream is frozen and no polling is happening. Everything already received stays scrollable."
    >
      <Pause size={9} /> paused
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] text-emerald-300">
      <Radio size={9} /> live
    </span>
  );

export default function TwinDecisionLogTab() {
  useActivityFeed();
  const { rows, error, frozen, arrivedKeys } = useActivityFeedStore();
  const arrived = useMemo(() => new Set(arrivedKeys), [arrivedKeys]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-brand-cool" />
          <span className="text-[11px] font-display uppercase tracking-wide text-ink-dim">Decision Log</span>
          <span className="font-mono text-[10px] tabular-nums text-ink-faint bg-white/[0.04] rounded px-1.5 py-0.5">
            {rows.length}
          </span>
          <StreamState frozen={frozen} />
        </div>
        {error && (
          <span className="text-[9px] text-brand-hot truncate max-w-[200px]">{error}</span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {rows.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-ink-faint">
              <Brain size={24} className="opacity-30" />
              <span className="text-[11px]">
                {frozen
                  ? "Paused with nothing received yet — resume the run to start the stream."
                  : "No decisions yet — start a run to see OTTO-Q's reasoning live."}
              </span>
            </div>
          )}
          {rows.map((r) => (
            <Row key={rowKey(r)} r={r} isNew={arrived.has(rowKey(r))} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
