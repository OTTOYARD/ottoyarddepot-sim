import { describe, expect, it } from "vitest";
import { decisionReasonText } from "./TwinDecisionLogTab";
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
