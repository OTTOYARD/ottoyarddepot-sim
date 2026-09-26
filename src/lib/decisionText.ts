// decisionText — one decision in words, from ottoq_activity_feed's own verdict columns (otto-q-core 0455).
//
// Pure, and deliberately free of React and of this app's stores, so the other cockpits that read the same feed
// (PULSE, OrchestrAV: "one read contract, three projections") can carry this file verbatim and word every
// decision the same way. The row type is the feed's columns; each cockpit supplies its own alias for it.
import type { ActivityFeedRow } from "@/store/activityFeedStore";

/** Every clock in the cockpit reads Nashville time (the TopBar says "CT"). */
export const DEPOT_TZ = "America/Chicago";

export function formatClockCT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: DEPOT_TZ,
  });
}

// ── the verdict, in words ────────────────────────────────────────────────────
export const human = (s: unknown): string => (typeof s === "string" ? s.replace(/_/g, " ") : "");
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type DecisionTone = "enacted" | "held" | "warn" | "idle";
export interface DecisionText { title: string; detail: string | null; tone: DecisionTone }

/** A target that is a verb, not a place, is not worth an arrow. */
export function isPlace(target: string | null | undefined, verb: string): boolean {
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

