import { describe, expect, it } from "vitest";
import { challengerText, decisionCategory, describeDecision, DEFAULT_CATEGORIES } from "./decisionText";
import type { ActivityFeedRow } from "@/store/activityFeedStore";

// Rows in the shape otto-q-core 0536's ottoq_activity_feed_v2 returns for the challenger, from its V3 plants.
const flag = {
  occurred_at: "2026-09-01T15:00:00Z",
  vehicle_id: null,
  display_name: "Waymo-AV-012",
  action: "challenger_flag",
  engine: "challenger Q1",
  target: "NASH-DC-03",
  outcome: "flagged",
  rationale: {
    question: "charging_above_floor_while_cars_wait",
    claim: "ending this charge now hands the DCFC to the longest-waiting car",
    car_soc: 86.4,
    cars_waiting: 5,
    longest_wait_min: 41.8,
    changes_the_engine: false,
  },
  reason: "ending this charge now hands the DCFC to the longest-waiting car",
  decision_seq: null,
  tick_seq: null,
  held_ticks: 3,
  last_at: "2026-09-01T15:03:00Z",
  standing: true,
} as unknown as ActivityFeedRow;

const grade = {
  ...flag,
  action: "challenger_grade",
  outcome: "confirmed",
  standing: false,
  rationale: {
    question: "charging_above_floor_while_cars_wait",
    grade: "confirmed",
    realized: { minutes_charged_after_first_sight: 22.4, beneficiary_waited_after_min: 31, saving_min: 22.4 },
    changes_the_engine: false,
  },
} as unknown as ActivityFeedRow;

describe("the challenger in the decision stream", () => {
  it("files its rows under their own filter, shown by default", () => {
    expect(decisionCategory("challenger_flag")).toBe("challenger");
    expect(decisionCategory("challenger_grade")).toBe("challenger");
    expect(DEFAULT_CATEGORIES.has("challenger")).toBe(true);
  });

  it("words a flag as a question about the engine's choice, never as something done", () => {
    const t = describeDecision(flag);
    expect(t).toEqual(challengerText(flag));
    expect(t.title).toBe("Challenger Q1 asks: charging past the deploy floor while cars wait");
    expect(t.detail).toBe(
      "NASH-DC-03 at 86% · 5 waiting, longest 42 min · claim: ending this charge now hands the DCFC to the longest-waiting car",
    );
    expect(t.tone).toBe("warn");
  });

  it("words a grade by what hindsight made of the question", () => {
    const t = describeDecision(grade);
    expect(t.title).toBe("Challenger Q1 graded: right: a gain was missed");
    expect(t.detail).toBe("charging past the deploy floor while cars wait · charged 22 min more · the next car waited 31 min more");
    expect(t.tone).toBe("warn");
    const refuted = describeDecision({ ...grade, rationale: { ...(grade.rationale as object), grade: "refuted", realized: {} } } as ActivityFeedRow);
    expect(refuted.title).toBe("Challenger Q1 graded: wrong: the engine's choice held");
    expect(refuted.tone).toBe("idle");
  });
});
