// decisionText.names.test.ts — words a decision carries that this app did not write (the engine's free-text reason, an
// upstream model error) reach the screen with every product in its public name. publicNames.test.ts reads the app's own
// strings; these read what arrives as data.
import { describe, expect, it } from "vitest";
import { decisionReasonText, describeDecision, modelErrorText, solverLabel, solverPhrase } from "./decisionText";
import { PRODUCT_NAMES } from "./publicNames";
import type { ActivityFeedRow } from "@/store/activityFeedStore";

const row = (over: Record<string, unknown>): ActivityFeedRow => ({
  occurred_at: "2026-11-07T15:00:00Z",
  vehicle_id: null,
  display_name: "Waymo-AV-012",
  action: "stall_assignment",
  engine: "deterministic_v1",
  target: null,
  outcome: "enacted",
  rationale: null,
  reason: null,
  decision_seq: 7,
  tick_seq: 3,
  held_ticks: 1,
  last_at: null,
  standing: false,
  ...over,
}) as unknown as ActivityFeedRow;

const named = (text: string | null) => PRODUCT_NAMES.some((re) => re.test(text ?? ""));

describe("a decision's engine-written words", () => {
  it("names a product in a free-text reason by its public name and leaves the rest as written", () => {
    expect(decisionReasonText(row({ reason: "CP-SAT made no offer: 0 cars it could serve" })))
      .toBe("The lexicographic planner made no offer: 0 cars it could serve");
    expect(decisionReasonText(row({ reason: "Held for cuOpt, 1 tick" }))).toBe("Held for the GPU planner, 1 tick");
    expect(decisionReasonText(row({ reason: "Depot throughput is blocked by service bays: 2 bays with 6392 min queued" })))
      .toBe("Depot throughput is blocked by service bays: 2 bays with 6392 min queued");
  });

  it("does the same for a rationale it can only list field by field", () => {
    const text = decisionReasonText(row({ reason: null, rationale: { verb: "x", agent_model: "nvidia/nemotron-3-ultra-550b-a55b", soc: 44 } }));
    expect(text).toBe("agent_model: the agent model · soc: 44");
    expect(named(text)).toBe(false);
  });

  it("leaves a reason key and an empty row as they were", () => {
    expect(decisionReasonText(row({ reason: "no_compatible_available_stall" }))).toBe("no_compatible_available_stall");
    expect(decisionReasonText(row({}))).toBeNull();
  });

  it("an unknown verdict falls back to those words, never to a product", () => {
    const d = describeDecision(row({ action: "some_new_action", reason: "Nemotron 3 Ultra asked for a re-plan" }));
    expect(d.title).toBe("Some new action");
    expect(d.detail).toBe("The agent model asked for a re-plan");
  });
});

describe("an upstream model error", () => {
  it("keeps its own words, with a product in its public name and a small first letter", () => {
    expect(modelErrorText("nemotron HTTP 502: upstream unavailable")).toBe("the agent model HTTP 502: upstream unavailable");
    expect(modelErrorText("model nvidia/nemotron-3-ultra-550b-a55b not found")).toBe("model the agent model not found");
    expect(modelErrorText("HTTP 404: not found")).toBe("HTTP 404: not found");
    expect(modelErrorText("model timeout after 75000 ms")).toBe("model timed out after 75 s");
    expect(modelErrorText('HTTP 429: {"status":429,"title":"Too Man')).toBe("model rate-limited (HTTP 429)");
  });

  it("an agent pass that fell back says so without the model's name", () => {
    const d = describeDecision(row({
      action: "orchestrator_agent",
      engine: "deterministic_fallback -> no solver call recorded",
      rationale: { objective: "readiness_first", model_error: "nemotron HTTP 502: upstream unavailable", handoff_status: "skipped" },
    }));
    expect(d).toEqual({ title: "Fallback: readiness first", detail: "no solver call: skipped → kernel: pending", tone: "warn" });
  });
});

describe("the solver of an agent pass", () => {
  // solver_engine is ottoq_model_call_ledger.provider, joined with "+" when more than one served the hand-off.
  it("reads by its public name on the line a cockpit draws", () => {
    const v = { objective: "readiness_first", solver_engine: "cpsat_service+nvidia_cuopt", handoff_status: "completed", proposals_returned: 3, kernel_enacted: 2 };
    const d = describeDecision(row({ action: "orchestrator_agent", engine: "nvidia/nemotron-3-ultra-550b-a55b -> cpsat_service+nvidia_cuopt", rationale: v }));
    expect(d.title).toBe("Agent: readiness first");
    expect(d.detail).toBe("Lexicographic planner + GPU planner: completed (3 proposed) → kernel: 2 enacted");
    expect(named(`${d.title} ${d.detail}`)).toBe(false);
    expect(solverLabel(v)).toBe("Lexicographic planner + GPU planner");
    expect(solverPhrase(v)).toBe("the lexicographic planner and the GPU planner");
  });
});
