import { describe, expect, it } from "vitest";
import {
  challengerText, decisionCategory, decisionKey, decisionPlace, describeDecision, DEFAULT_CATEGORIES, holdText,
} from "./decisionText";
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
    finding_id: 41,
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
    finding_id: 41,
    first_seen: "2026-09-01T15:00:00Z",
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
    // 0538 (G264): Q1's grade is local, so a confirmation is held locally and does not warn.
    const t = describeDecision(grade);
    expect(t.title).toBe("Challenger Q1 graded: held locally, not a verdict on the day");
    expect(t.detail).toBe("charging past the deploy floor while cars wait · charged 22 min more · the next car waited 31 min more");
    expect(t.tone).toBe("idle");
    const fault = describeDecision({
      ...grade,
      engine: "challenger Q3",
      rationale: { question: "charger_faulted_while_cars_wait", grade: "confirmed", realized: { faulted_while_waiting_min_at_least: 504 } },
    } as unknown as ActivityFeedRow);
    expect(fault.title).toBe("Challenger Q3 graded: right: charger capacity lost while cars waited");
    expect(fault.detail).toBe("a faulted charger while cars wait · faulted at least 504 min");
    expect(fault.tone).toBe("warn");
    const refuted = describeDecision({ ...grade, rationale: { ...(grade.rationale as object), grade: "refuted", realized: {} } } as ActivityFeedRow);
    expect(refuted.title).toBe("Challenger Q1 graded: wrong: the engine's choice held");
    expect(refuted.tone).toBe("idle");
  });

  it("says a question is open or was asked, never that it is in force or held", () => {
    const hhmm = (iso: string) => iso.slice(11, 16);
    expect(holdText(flag, hhmm)).toBe("open since 15:00");
    expect(holdText({ ...flag, standing: false, held_ticks: 23, last_at: "2026-09-01T15:22:00Z" } as ActivityFeedRow, hhmm))
      .toBe("open 22 min");
    expect(holdText({ ...flag, standing: false, held_ticks: 1, last_at: "2026-09-01T15:00:00Z" } as ActivityFeedRow, hhmm))
      .toBeNull();
    expect(holdText(grade, hhmm)).toBe("asked at 15:00");
  });

  it("draws no destination for a question, and keys it by its finding", () => {
    expect(decisionPlace(flag)).toBeNull();
    expect(decisionPlace({ ...flag, action: "stall_assignment", rationale: { verb: "assign_stall" } } as ActivityFeedRow))
      .toBe("NASH-DC-03");
    expect(decisionKey(flag)).toBe("challenger_flag:41");
    expect(decisionKey(grade)).toBe("challenger_grade:41");
    expect(decisionKey({ ...flag, decision_seq: 9 } as ActivityFeedRow)).toBe("d9");
  });
});
