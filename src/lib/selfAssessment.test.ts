// selfAssessment.test.ts — the morning self-review card says what the engine's review says, in words. The review and the
// clock are real captures through the same anon reads the hook makes (otto-q-core, depot 11111111-…: assessment 1,
// written 2026-10-08 16:46:28 UTC; charge clock fit 1, 16:24:12 UTC). The edge shapes below are built to the contract.
import { describe, expect, it } from "vitest";
import review from "@/components/tabs/__fixtures__/selfAssessment.assessment1.json";
import fit from "@/components/tabs/__fixtures__/chargeClock.fit1.json";
import {
  AREAS_SHOWN, areaTitle, classMake, clockView, ctTime, kindLabel, plainFinding, selfAssessmentView,
  type ClockFitRow, type SelfAssessmentRow,
} from "./selfAssessment";

const row = review as unknown as SelfAssessmentRow;
const clock = fit as unknown as ClockFitRow;
const AT = Date.parse("2026-10-08T17:00:00Z");

describe("the real review (assessment 1)", () => {
  const v = selfAssessmentView(row, clock, AT)!;

  it("says how many orders it replayed, over what span, and how many places it names", () => {
    expect(v.headline).toBe(
      "It replayed 61 agent orders from the past 7 days with what actually happened and graded its own check on each. "
      + "It names 18 places the check falls short.",
    );
    expect(v.tone).toBe("held");
  });

  it("partitions the 61 graded orders the way the engine does", () => {
    expect(v.facts).toEqual([
      "Graded 61: took 2 (won 1, tied 0, lost 1) · refused 16 (rightly 10, a winner 6) · nothing to decide 43 (mattered in fact 14)",
    ]);
    // 2 + 16 + 43 = 61: every graded order lands in exactly one bucket
  });

  it("draws the five causes largest first, summing to the whole", () => {
    expect(v.causesLabel).toBe("What made its forecasts wrong, over 15 orders");
    expect(v.causes.map((c) => [c.label, c.text])).toEqual([
      ["Cars it never saw coming", "24%"],
      ["Charges already under way", "24%"],
      ["When cars came home", "22%"],
      ["How long charges took", "15%"],
      ["Chargers that faulted", "15%"],
    ]);
    expect(v.causes[0].detail).toBe(
      "Cars it never saw coming: 24% of the difference between its forecasts and what happened; it shifted the verdict on 5 orders of 15",
    );
  });

  it("keeps the engine's order and splits it at the first five", () => {
    expect(v.areas).toHaveLength(AREAS_SHOWN);
    expect(v.more).toHaveLength(18 - AREAS_SHOWN);
    expect(v.areas.map((a) => a.title)).toEqual([
      "Its arrival forecasts are surer than the arrivals",
      "Its simulator places a plug-in 10.7 min off, even given what happened",
      "It cannot see a car leave, work and come back",
      "The charge clock ignores air temperature on L2",
      "The charge clock ignores the run on L2",
    ]);
    expect(v.areas.map((a) => a.kindLabel)).toEqual(["Off calibration", "Can't model yet", "Can't model yet", "Can't model yet", "Can't model yet"]);
  });

  it("names every one of the 18 areas in words, never by its code", () => {
    for (const a of [...v.areas, ...v.more]) {
      expect(a.title).not.toMatch(/_/);
      expect(a.finding).not.toMatch(/\b[a-z]+_[a-z0-9_]+\b/); // no engine key survives in the sentence
    }
    expect(v.more.map((a) => a.title)).toContain("Waymo charges on L2 finish 9% sooner than the clock says");
    expect(v.more.map((a) => a.title)).toContain("The charge clock's level for make and model has drifted on fast chargers");
    expect(v.more.map((a) => a.title)).toContain("A stricter bar would have done better on these orders");
  });

  it("says when it was written, in CT", () => {
    expect(v.basis).toBe("Reviewed Oct 8, 11:46 AM CT · a review runs each morning");
  });

  it("says so when the review is older than a day", () => {
    const later = selfAssessmentView(row, clock, AT + 2 * 86_400_000)!;
    expect(later.basis).toBe("Reviewed Oct 8, 11:46 AM CT · older than a day: the morning review may have missed a run");
  });
});

describe("the real charge clock (fit 1)", () => {
  const c = clockView(clock)!;

  it("says what it learned from and when, with the half-life", () => {
    expect(c.headline).toBe("Learned from 3,274 charges across 38 runs, refit Oct 8, 11:24 AM CT. Recent charges count more: a charge 3 days old counts half.");
  });

  it("gives each make's factor on each kind against the depot-wide clock", () => {
    expect(c.facts).toEqual([
      "Fast charge: Tesla ×1.43 · Waymo ×1.02 · Zoox ×0.31",
      "L2: Tesla ×0.99 · Waymo ×1.00 · Zoox ×1.01",
    ]);
  });

  it("is absent when the depot has no fit", () => {
    expect(clockView(null)).toBeNull();
    expect(clockView({})).toBeNull();
  });
});

describe("words", () => {
  it("strips the engine's ids and reads class codes and keys as words", () => {
    expect(plainFinding("the return model (0619 return_v1) times them poorly")).toBe("the return model times them poorly");
    expect(plainFinding("The bar is a person's dial (agent_charge_order_win_frac), changed only as a certified change."))
      .toBe("The bar is a person's dial, changed only as a certified change.");
    expect(plainFinding("Charges of class waymo_jaguar_ipace_2024 on l2 ran -9% against the check's clock (z mean -0.544)."))
      .toBe("Charges of class Waymo on L2 ran -9% against the check's clock (z mean -0.544).");
    expect(plainFinding("On dcfc, ambient_c explains 26% of what the clock leaves unexplained"))
      .toBe("On DCFC, air temperature explains 26% of what the clock leaves unexplained");
    expect(plainFinding("error is 0.13 against 0619's 0.11")).toBe("error is 0.13 against the earlier clock's 0.11");
    expect(plainFinding(null)).toBe("");
  });

  it("titles every area code the engine writes, and falls back to the code in words", () => {
    expect(areaTitle({ area: "charge_clock_stale_vehicle_dcfc" })).toBe("The charge clock's level for each car has drifted on fast chargers");
    expect(areaTitle({ area: "charge_clock_misses_sim_hour_l2" })).toBe("The charge clock ignores the hour of day on L2");
    expect(areaTitle({ area: "charge_clock_worse_than_v1_l2" })).toBe("The charge clock trails the one before it on L2");
    expect(areaTitle({ area: "charge_clock_dcfc", evidence: { factor_off_by: 1.087 } })).toBe("Charges on fast chargers take 9% longer than the clock says");
    expect(areaTitle({ area: "charge_clock_l2_zoox_robotaxi_2024", evidence: {} })).toBe("Zoox charges on L2 run off the clock");
    expect(areaTitle({ area: "agent_move_loses_low_battery_on_l2" })).toBe("The agent keeps losing by putting a low battery on L2");
    expect(areaTitle({ area: "agent_move_wins_refused_due_rescue_fast" }))
      .toBe("The check keeps refusing orders that win by making a late car ready on a fast charger");
    expect(areaTitle({ area: "bar_looser" })).toBe("A looser bar would have done better on these orders");
    expect(areaTitle({ area: "forecast_faults" })).toBe("Charger faults it never sampled moved its verdicts");
    expect(areaTitle({ area: "something_new" })).toBe("Something new");
    expect(areaTitle({ area: "arrival_spread", title: "The engine's own name" })).toBe("The engine's own name");
  });

  it("labels kinds, makes and times", () => {
    expect(kindLabel("threshold")).toBe("A person's dial");
    expect(kindLabel("agent")).toBe("Agent's move");
    expect(kindLabel(null)).toBe("Finding");
    expect(classMake("tesla_model_y_robotaxi_2024")).toBe("Tesla");
    expect(classMake("acme_hauler_2030")).toBe("acme hauler 2030");
    expect(ctTime("2026-12-01T18:05:00Z")).toBe("Dec 1, 12:05 PM CT"); // CST in December
    expect(ctTime("garbage")).toBe("—");
  });
});

describe("edges", () => {
  it("draws nothing without a review", () => {
    expect(selfAssessmentView(null, clock)).toBeNull();
    expect(selfAssessmentView({}, clock)).toBeNull();
  });

  it("says plainly when nothing has been graded yet", () => {
    const v = selfAssessmentView({ assessment_id: 9, assessed_at: "2026-10-08T12:55:00Z", since: "2026-10-01T12:55:00Z", n_graded: 0,
      improvement_areas: [] }, null, Date.parse("2026-10-08T13:00:00Z"))!;
    expect(v.tone).toBe("idle");
    expect(v.headline).toBe("No agent order from the past 7 days has been replayed with what happened yet, so the review has nothing to grade.");
    expect(v.facts).toEqual([]);
    expect(v.causes).toEqual([]);
    expect(v.clock).toBeNull();
  });

  it("is green when it grades orders and names no gap", () => {
    const v = selfAssessmentView({ assessment_id: 9, n_graded: 3, improvement_areas: [], verdicts: { right_take: 3 } }, null)!;
    expect(v.tone).toBe("ok");
    expect(v.headline).toBe("It replayed 3 agent orders from the past week with what actually happened and graded its own check on each. It names no place the check falls short.");
    expect(v.facts[0]).toBe("Graded 3: took 3 (won 3, tied 0, lost 0) · refused 0 (rightly 0, a winner 0) · nothing to decide 0 (mattered in fact 0)");
  });
});
