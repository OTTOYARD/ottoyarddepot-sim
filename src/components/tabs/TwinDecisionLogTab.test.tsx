import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATEGORIES,
  decisionCategory,
  decisionReasonText,
  describeDecision,
  formatClockCT,
  holdText,
  kernelLabel,
  modelErrorText,
  solverLabel,
  starvationNote,
} from "./TwinDecisionLogTab";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { isPlace } from "@/lib/decisionText";

const row = (overrides: Partial<ActivityFeedRow>): ActivityFeedRow => ({
  occurred_at: "2026-09-16T12:00:00Z",
  vehicle_id: "vehicle-1",
  display_name: "Vehicle 1",
  action: "stall_assignment",
  engine: "forward_lex",
  target: "L2-1",
  outcome: "enacted",
  rationale: null,
  reason: null,
  ...overrides,
});

describe("Decision Log reason rendering", () => {
  it("renders the database reason as plain text instead of string characters", () => {
    expect(decisionReasonText(row({ reason: "blocked: grid ceiling" })))
      .toBe("blocked: grid ceiling");
  });

  it("falls back to scalar structured rationale fields", () => {
    expect(decisionReasonText(row({ rationale: { soc: 22, floor: 30, attempts: [1, 2] } })))
      .toBe("soc: 22 · floor: 30");
  });
});

// These three exist because this strip used to assert "CP-SAT" on every line it
// rendered. otto-q-core 0346: the feed joined the proposer fire log on a key
// present on 0 of 112 rows and COALESCEd the solver name onto a hardcoded CP-SAT
// literal, so the label was a constant dressed as a measurement. The rule now is
// that an absent value renders as absent.
describe("agent pipeline labels never name a solver that did not run", () => {
  it("names the provider the engine measured", () => {
    expect(solverLabel({ solver_engine: "nvidia_cuopt" })).toBe("cuOpt");
    expect(solverLabel({ solver_engine: "cpsat_service" })).toBe("CP-SAT");
  });

  it("joins a chain served by more than one provider", () => {
    expect(solverLabel({ solver_engine: "nvidia_cuopt+nvidia_nemotron" }))
      .toBe("cuOpt + Nemotron");
  });

  it("passes an unknown provider through rather than guessing", () => {
    expect(solverLabel({ solver_engine: "some_new_solver" })).toBe("some_new_solver");
  });

  // THE REGRESSION TEST. Absent must never render as CP-SAT.
  it("says no solver call when the engine recorded none", () => {
    expect(solverLabel({})).toBe("no solver call");
    expect(solverLabel({ solver_engine: null })).toBe("no solver call");
    expect(solverLabel({ solver_engine: "   " })).toBe("no solver call");
    expect(solverLabel({})).not.toContain("CP-SAT");
  });

  it("reports the kernel's own disposition, not the fire log's submitted count", () => {
    // 17 enacted with submitted absent is exactly run ac402e07: the old strip read
    // "pending" here because it keyed off the fire log, which had zero rows.
    expect(kernelLabel({ kernel_enacted: 17, submitted: null })).toBe("17 enacted");
    expect(kernelLabel({ kernel_enacted: 0, kernel_refused: 4 })).toBe("4 refused");
    expect(kernelLabel({ kernel_enacted: 0, kernel_superseded: 2 })).toBe("2 superseded");
  });

  it("distinguishes an empty frame from a pending one", () => {
    expect(kernelLabel({ solver_status: "empty" })).toBe("no action");
    expect(kernelLabel({ solver_status: "submitted" })).toBe("pending");
    expect(kernelLabel({})).toBe("pending");
  });

  it("does not call a completed solve that proposed nothing 'pending'", () => {
    // Run 736406cf: CP-SAT answered every fallback pass with zero proposals and the strip read "pending".
    expect(kernelLabel({ handoff_status: "completed", proposals_returned: 0 })).toBe("nothing to dispose");
    expect(kernelLabel({ handoff_status: "completed", proposals_returned: 3 })).toBe("pending");
  });

  it("reports every non-zero disposition, not just the first", () => {
    expect(kernelLabel({ kernel_enacted: 2, kernel_refused: 1, kernel_expired: 1 }))
      .toBe("2 enacted · 1 refused · 1 expired");
  });

  it("surfaces G60: every serviceable vehicle already held a place", () => {
    expect(starvationNote({ frame_serviceable: 11, frame_held: 11 }))
      .toContain("all 11 serviceable vehicles already held a place");
    // headroom existed, so the solver was genuinely asked something
    expect(starvationNote({ frame_serviceable: 11, frame_held: 4 })).toBeNull();
    expect(starvationNote({})).toBeNull();
  });
});

// 0452-0455: the stream says what was decided, in words, from the decision's own verb and reason.
describe("decision verdicts in words", () => {
  it("does not call a service check a promotion", () => {
    const t = describeDecision(row({
      action: "task_start", target: "promote_ready",
      rationale: { verb: "promote_ready", step: "need_charge", deferred: [] },
    }));
    expect(t.title).toBe("No bay work needed");
    expect(t.detail).toBe("next: charge");
    expect(t.title.toLowerCase()).not.toContain("promot");
  });

  it("says when bay work is being deferred because the bays are full", () => {
    const t = describeDecision(row({
      action: "task_start",
      rationale: { verb: "promote_ready", step: "need_service", deferred: ["cosmetic_repair"] },
    }));
    expect(t.title).toBe("Service deferred: bays full");
    expect(t.detail).toBe("carried to next visit: cosmetic repair");
  });

  it("shows a charge stall wait by its own reason, never the engine name", () => {
    const t = describeDecision(row({
      action: "stall_assignment", outcome: "noop_no_candidate", target: "",
      reason: "no_compatible_available_stall",
      rationale: { reason: "no_compatible_available_stall" },
    }));
    expect(t.title).toBe("No compatible stall free");
    expect(`${t.title} ${t.detail ?? ""}`).not.toContain("deterministic_v1");
  });

  it("names a battery setpoint and a shield hold", () => {
    expect(describeDecision(row({
      action: "bess_dispatch", rationale: { verb: "set_bess", bess_action: "charge", mode: "plan_charge", soc_pct: 91.7 },
    })).detail).toBe("plan charge · SoC 92%");
    const held = describeDecision(row({
      action: "task_start", outcome: "overridden_to_default",
      rationale: { verb: "hold_in_queue", reason: "service_shield_blocked", override_rule_codes: ["HW.002"] },
    }));
    expect(held).toEqual({ title: "Held by the shield", detail: "HW.002", tone: "warn" });
  });

  it("renders an unknown verdict as its own words", () => {
    expect(describeDecision(row({ action: "something_new", rationale: { verb: "do_the_thing" } })).title)
      .toBe("Do the thing");
  });

  it("puts an agent pass on one line: objective, solver, kernel (for cockpits without the chip strip)", () => {
    const pass = describeDecision(row({
      action: "orchestrator_agent",
      rationale: {
        objective: "readiness_first", solver_engine: "cpsat_service", handoff_status: "completed",
        proposals_returned: 3, kernel_enacted: 2, kernel_refused: 1,
      },
    }));
    expect(pass).toEqual({
      title: "Agent: readiness first",
      detail: "CP-SAT: completed (3 proposed) → kernel: 2 enacted · 1 refused",
      tone: "enacted",
    });
    const fallback = describeDecision(row({
      action: "orchestrator_agent",
      rationale: { model_error: "model timeout after 75000 ms", objective: "throughput_first", handoff_status: "fallback" },
    }));
    expect(fallback.title).toBe("Fallback: throughput first");
    expect(fallback.detail).toBe("no solver call: fallback → kernel: pending");
    expect(fallback.tone).toBe("warn");
  });

  it("draws an arrow only to a place: a stall code, never a verb or the agent's objective label", () => {
    expect(isPlace("NASH-DCFC-STALL-04", "assign_stall")).toBe(true);
    expect(isPlace("promote_ready", "promote_ready")).toBe(false);
    expect(isPlace("deploy", "")).toBe(false);
    expect(isPlace("objective: readiness_first", "")).toBe(false);
    expect(isPlace(null, "")).toBe(false);
  });
});

describe("stream presentation", () => {
  it("prints times in Nashville time, not the viewer's", () => {
    // 17:14:02 UTC is 12:14:02 CDT
    expect(formatClockCT("2026-09-23T17:14:02Z")).toBe("12:14:02");
    expect(formatClockCT(null)).toBe("—");
  });

  it("says how long a verdict held, and when it still holds", () => {
    expect(holdText(row({ held_ticks: 1, last_at: "2026-09-16T12:00:00Z" }))).toBeNull();
    expect(holdText(row({ held_ticks: 37, last_at: "2026-09-16T12:18:00Z", standing: false }))).toBe("held 18 min");
    expect(holdText(row({ held_ticks: 37, last_at: "2026-09-16T12:18:00Z", standing: true })))
      .toBe("since 07:00, still in force");
  });

  it("turns the agent's timeout into words", () => {
    expect(modelErrorText("model timeout after 75000 ms")).toBe("model timed out after 75 s");
    expect(modelErrorText("HTTP 404: not found")).toBe("HTTP 404: not found");
    expect(modelErrorText(undefined)).toBeNull();
  });

  it("files plan re-timings separately and hides them by default", () => {
    expect(decisionCategory("itinerary_amended")).toBe("plans");
    expect(decisionCategory("orchestrator_agent")).toBe("agent");
    expect(decisionCategory("bess_dispatch")).toBe("energy");
    expect(decisionCategory("stall_assignment")).toBe("dispatch");
    expect(DEFAULT_CATEGORIES.has("plans")).toBe(false);
    expect(DEFAULT_CATEGORIES.has("agent")).toBe(true);
  });
});
