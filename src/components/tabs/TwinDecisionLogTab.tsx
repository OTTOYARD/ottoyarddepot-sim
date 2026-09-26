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

/** Every clock in the cockpit reads Nashville time (the TopBar says "CT"). */
const DEPOT_TZ = "America/Chicago";

export function formatClockCT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: DEPOT_TZ,
  });
}

// ── categories: what an operator filters by ─────────────────────────────────
export type DecisionCategory = "agent" | "dispatch" | "energy" | "plans";

export const CATEGORY_META: Record<DecisionCategory, { label: string; color: string; icon: typeof Brain }> = {
  agent: { label: "Agent", color: "#A78BFA", icon: Brain },
  dispatch: { label: "Dispatch", color: "#00B4A6", icon: Truck },
  energy: { label: "Energy", color: "#F59E0B", icon: BatteryCharging },
  plans: { label: "Plan changes", color: "#7B818D", icon: CalendarClock },
};

export function decisionCategory(action: string): DecisionCategory {
  if (action === "orchestrator_agent") return "agent";
  if (action === "bess_dispatch") return "energy";
  if (action === "itinerary_amended") return "plans";
  return "dispatch";
}

/** Plan re-timings are real decisions but the loudest ones (~40% of changes); they start hidden. */
export const DEFAULT_CATEGORIES: ReadonlySet<DecisionCategory> = new Set(["agent", "dispatch", "energy"]);

// ── the verdict, in words ────────────────────────────────────────────────────
const human = (s: unknown): string => (typeof s === "string" ? s.replace(/_/g, " ") : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type DecisionTone = "enacted" | "held" | "warn" | "idle";
export interface DecisionText { title: string; detail: string | null; tone: DecisionTone }

/** A target that is a verb, not a place, is not worth an arrow. */
function isPlace(target: string | null | undefined, verb: string): boolean {
  return !!target && target !== verb && !/^[a-z_]+$/.test(target);
}

export function describeDecision(r: ActivityFeedRow): DecisionText {
  const v = (r.rationale ?? {}) as Record<string, unknown>;
  const verb = typeof v.verb === "string" ? v.verb : "";
  const reason = typeof v.reason === "string" ? v.reason : "";
  const overridden = r.outcome === "overridden_to_default";
  const noop = r.outcome === "noop_no_candidate";
  const codes = Array.isArray(v.override_rule_codes) ? (v.override_rule_codes as string[]).join(", ") : "";

  switch (r.action) {
    case "task_start": {
      if (verb === "promote_ready") {
        const deferred = Array.isArray(v.deferred) ? (v.deferred as string[]).map(human) : [];
        const step = String(v.step ?? "");
        const carried = deferred.length ? `carried to next visit: ${deferred.join(", ")}` : null;
        // promote_ready with step need_service is ottoq_l2_propose_service finding the service bays FULL
        // and the work deferrable: there IS bay work, it is being put off.
        if (step === "need_service") {
          return { title: "Service deferred: bays full", detail: carried, tone: "held" };
        }
        const next: Record<string, string> = {
          need_charge: "next: charge",
          ready: "ready to depart",
          overnight_draining: "overnight drain",
          need_deploy: "awaiting deploy",
        };
        return {
          title: carried ? "No bay work now" : "No bay work needed",
          detail: [next[step] ?? human(step), carried].filter(Boolean).join(" · ") || null,
          tone: "idle",
        };
      }
      if (verb === "hold_in_queue") {
        if (overridden || reason === "service_shield_blocked") {
          return { title: "Held by the shield", detail: codes || human(reason), tone: "warn" };
        }
        const waited = num(v.waited_min), patience = num(v.patience_min);
        return {
          title: "Held: must-do service, bays full",
          detail: waited != null && patience != null ? `waited ${waited} of ${patience} min` : null,
          tone: "held",
        };
      }
      if (verb === "admit_service") return { title: "Admitted to a service bay", detail: human(v.step) || null, tone: "enacted" };
      if (verb === "admit_wash") return { title: `Admitted to the wash bay${v.purpose ? ` (${human(v.purpose)})` : ""}`, detail: null, tone: "enacted" };
      if (verb === "skip_wash") return { title: "Wash skipped", detail: null, tone: "idle" };
      if (reason === "wash_lane_full_hold") return { title: "Held: wash lane full", detail: null, tone: "held" };
      break;
    }
    case "stall_assignment": {
      if (overridden) return { title: "Assignment overridden by the shield", detail: codes || null, tone: "warn" };
      if (reason === "no_compatible_available_stall") return { title: "No compatible stall free", detail: null, tone: "held" };
      if (verb === "hold_no_space") return { title: `Held: no free ${human(v.purpose) || "space"}`, detail: human(v.need) || null, tone: "held" };
      if (verb === "gate_intake") return { title: "Gate intake", detail: null, tone: "enacted" };
      if (verb === "assign_stall" || (!noop && r.outcome === "enacted")) {
        const what = human(v.need) || human(v.purpose) || human(v.stall_type);
        return { title: "Assigned a stall", detail: what || null, tone: "enacted" };
      }
      break;
    }
    case "bay_reconcile": {
      if (verb === "unbacked_bay_occupant") {
        return { title: "Bay occupant has no booking", detail: [human(v.stall_type), human(v.purpose)].filter(Boolean).join(" · ") || null, tone: "warn" };
      }
      if (verb === "bind_bay_occupant") return { title: "Bay occupant bound to a booking", detail: human(v.purpose) || null, tone: "enacted" };
      if (verb === "displace_and_bind") return { title: "Bay re-bound after a displacement", detail: human(v.purpose) || null, tone: "enacted" };
      break;
    }
    case "bess_dispatch": {
      if (verb === "set_bess") {
        const soc = num(v.soc_pct);
        return {
          title: `Battery: ${human(v.bess_action) || "set"}`,
          detail: [human(v.mode), soc != null ? `SoC ${Math.round(soc)}%` : null].filter(Boolean).join(" · ") || null,
          tone: "enacted",
        };
      }
      if (noop) return { title: "Battery on standby", detail: reason === "no_active_energy_plan_or_standby" ? "no active energy plan" : human(reason) || null, tone: "idle" };
      break;
    }
    case "redeployment": {
      if (verb === "deploy") {
        const soc = num(v.soc), floor = num(v.floor);
        return { title: "Deployed", detail: soc != null && floor != null ? `SoC ${soc}% ≥ floor ${floor}%` : null, tone: "enacted" };
      }
      if (verb === "hold_in_staging") return { title: "Deploy held", detail: codes || human(reason) || null, tone: overridden ? "warn" : "held" };
      break;
    }
    case "itinerary_amended": {
      const s = num(v.shift_s);
      const mins = s != null ? Math.round(s / 60) : null;
      return { title: "Plan re-timed", detail: mins != null ? `${mins >= 0 ? "+" : ""}${mins} min` : null, tone: "idle" };
    }
    case "triage_verdict": {
      const what: Record<string, string> = { triage_confirm: "confirmed", triage_escalate: "escalated", triage_clear: "cleared" };
      return { title: `Triage ${what[verb] ?? human(verb)}`, detail: human(v.svc) || null, tone: verb === "triage_escalate" ? "warn" : "enacted" };
    }
    case "gate_intake_no_charge":
      return { title: "Gate intake, no charge needed", detail: null, tone: "enacted" };
  }
  // Anything this map does not know renders as its own words, never as an engine name.
  const fallback = human(verb) || human(reason) || human(r.action);
  return { title: fallback.charAt(0).toUpperCase() + fallback.slice(1), detail: decisionReasonText(r), tone: overridden ? "warn" : noop ? "idle" : "enacted" };
}

/** Scalar fields of a structured rationale, as text. The last resort for an unknown verdict. */
export function decisionReasonText(r: ActivityFeedRow): string | null {
  if (r.reason && !/^[a-z0-9_]+$/.test(r.reason) && !r.reason.startsWith("{")) return r.reason;
  if (!r.rationale) return r.reason ?? null;
  const entries = Object.entries(r.rationale).filter(([key, value]) =>
    key !== "verb" && value !== null && value !== undefined && !Array.isArray(value) && typeof value !== "object"
  );
  return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ") : null;
}

/** "held 18 min", or "since 14:05, still in force". Null for a one-tick event. */
export function holdText(r: ActivityFeedRow): string | null {
  if (r.standing) return `since ${formatClockCT(r.occurred_at).slice(0, 5)}, still in force`;
  if (!r.held_ticks || r.held_ticks <= 1 || !r.last_at) return null;
  const mins = Math.max(1, Math.round((Date.parse(r.last_at) - Date.parse(r.occurred_at)) / 60_000));
  return `held ${mins} min`;
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
  const parts: string[] = [];
  const add = (key: string, word: string) => {
    const n = Number(detail[key] ?? 0);
    if (n > 0) parts.push(`${n} ${word}`);
  };
  add("kernel_enacted", "enacted");
  add("kernel_refused", "refused");
  add("kernel_superseded", "superseded");
  add("kernel_expired", "expired");
  if (parts.length) return parts.join(" · ");
  const solverStatus = String(detail.solver_status ?? "");
  if (solverStatus === "empty") return "no action";
  // A handoff the solver completed with nothing proposed leaves the kernel nothing to dispose.
  // Reading that as "pending" is what this line used to do.
  if (detail.handoff_status === "completed" && Number(detail.proposals_returned ?? 0) === 0) return "nothing to dispose";
  return "pending";
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

/** "model timeout after 75000 ms" -> "model timed out after 75 s". Anything else passes through. */
export function modelErrorText(err: unknown): string | null {
  if (typeof err !== "string" || !err.trim()) return null;
  const t = err.match(/timeout after (\d+) ms/);
  if (t) return `model timed out after ${Math.round(Number(t[1]) / 1000)} s`;
  return err.trim();
}

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
          Model unavailable ({modelError}). The deterministic path decided this pass; the solver was still asked.
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
