import { describe, expect, it } from "vitest";
import {
  decisionReasonText,
  kernelLabel,
  solverLabel,
  starvationNote,
} from "./TwinDecisionLogTab";
import type { ActivityFeedRow } from "@/store/activityFeedStore";

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

  it("surfaces G60: every serviceable vehicle already held a place", () => {
    expect(starvationNote({ frame_serviceable: 11, frame_held: 11 }))
      .toContain("all 11 serviceable vehicles already held a place");
    // headroom existed, so the solver was genuinely asked something
    expect(starvationNote({ frame_serviceable: 11, frame_held: 4 })).toBeNull();
    expect(starvationNote({})).toBeNull();
  });
});
