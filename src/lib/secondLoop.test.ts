import { describe, expect, it } from "vitest";
import {
  dialReadText,
  episodeText,
  gradeLabel,
  gradeTone,
  hitRateText,
  lastPairText,
  nextCronUTC,
  outcomeLabel,
  outcomeTone,
  pairsProgress,
  realizedText,
  windowText,
  type ChallengerEpisode,
  type LearningBoard,
  type LearningExperiment,
} from "./secondLoop";

// Shapes below are those otto-q-core 0536's boards return. The episodes are 0532's V3 plant and the charge-target
// experiment 08262943 as it stood on 2026-09-27.

const q1: ChallengerEpisode = {
  finding_id: 1,
  tag: "Q1",
  question: "charging_above_floor_while_cars_wait",
  stall: "DCFC-03",
  car: "Waymo-AV-012",
  car_soc: 85.4,
  cars_waiting: 3,
  longest_wait_min: 42.6,
  claim: "ending this charge now hands the DCFC to the longest-waiting car",
  beneficiary: "Tesla-AV-041",
};

describe("episodeText", () => {
  it("says what the challenger saw, in the operator's words", () => {
    expect(episodeText(q1)).toBe(
      "Waymo-AV-012 still charging on DCFC-03 at 85%, past the deploy floor, while 3 cars wait (longest 43 min)",
    );
    expect(
      episodeText({ finding_id: 2, tag: "Q2", question: "charger_offerable_while_cars_wait", stall: "L2-14",
                    beneficiary: "Tesla-AV-041", cars_waiting: 1, longest_wait_min: 7 }),
    ).toBe("L2-14 free by every gate while Tesla-AV-041 waits (1 waiting, longest 7 min)");
    expect(
      episodeText({ finding_id: 3, tag: "Q3", question: "charger_faulted_while_cars_wait", stall: "DCFC-07", cars_waiting: 1 }),
    ).toBe("DCFC-07 faulted while 1 car waits");
  });

  it("leaves out what it did not measure rather than printing a zero", () => {
    expect(episodeText({ finding_id: 4, tag: "Q1", question: "charging_above_floor_while_cars_wait", stall: "DCFC-01" }))
      .toBe("A car still charging on DCFC-01, past the deploy floor,");
  });
});

describe("realizedText", () => {
  it("reads the hindsight fields the close wrote, and nothing else", () => {
    expect(
      realizedText({ ...q1, realized: { minutes_charged_after_first_sight: 22.4, beneficiary_waited_after_min: 31, saving_min: 22.4 } }),
    ).toBe("charged 22 min more · the next car waited 31 min more · claimed saving 22 min");
    expect(realizedText({ ...q1, realized: { minutes_charged_after_first_sight: 12, beneficiary_still_waiting: true } }))
      .toBe("charged 12 min more · the next car was still waiting");
    expect(realizedText({ ...q1, realized: null })).toBeNull();
  });
});

describe("grades", () => {
  it("warns when the challenger was right, because that is a gain the depot missed", () => {
    expect(gradeTone("confirmed")).toBe("warn");
    expect(gradeTone("refuted")).toBe("ok");
    expect(gradeTone("inconclusive")).toBe("idle");
    expect(gradeLabel("refuted")).toBe("refuted: the engine was right");
  });

  it("states a hit rate only over graded claims", () => {
    expect(hitRateText({ runs: 2, confirmed: 6, refuted: 4, hit_rate: 0.6 })).toBe("right 6 of 10 graded (60%) across 2 runs");
    expect(hitRateText({ runs: 1, confirmed: 0, refuted: 0, hit_rate: null })).toBeNull();
    expect(hitRateText(null)).toBeNull();
  });
});

const charge: LearningExperiment = {
  experiment_id: "08262943-e487-4a24-9ddb-0686737bcf98",
  param_key: "dcfc_target_soc_day",
  control: 90,
  treatment: 85,
  primary_metric: "unmet_demand_car_hours",
  first_look_pairs: 6,
  final_look_pairs: 12,
  pairs: { recorded: 1, counted: 0, invalid: 0, stale_engine: 1 },
  outcome: "collecting",
  dial_reads: { witnessed: 0, unread: 0, unmeasured: 0 },
  last_pair: { pair_id: 95, control: 336.3, treatment: 336.3, moved: [] },
};

describe("the learner", () => {
  it("names every outcome, the unread dial loudest", () => {
    expect(outcomeLabel("dial_not_read")).toBe("dial not read");
    expect(outcomeTone("dial_not_read")).toBe("bad");
    expect(outcomeTone("treatment_wins")).toBe("ok");
    expect(outcomeLabel("something_new")).toBe("something new");
  });

  it("counts toward the first look, then the final one", () => {
    expect(pairsProgress(charge)).toEqual({ counted: 0, needed: 6, pct: 0, label: "0 of 6 pairs for the first look" });
    expect(pairsProgress({ ...charge, pairs: { counted: 7 } }).label).toBe("7 of 12 pairs for the final look");
  });

  it("says whether the arms read their dial, and says nothing when nothing was measured", () => {
    expect(dialReadText(charge.dial_reads)).toBeNull();
    expect(dialReadText({ witnessed: 3, unread: 0, unmeasured: 0 })).toEqual({ text: "both arms read the dial in 3 of 3 pairs", tone: "ok" });
    expect(dialReadText({ witnessed: 0, unread: 1, unmeasured: 0 })?.tone).toBe("bad");
  });

  it("shows an identical pair as identical, the defect pair 95 exposed", () => {
    expect(lastPairText(charge)).toBe("last pair: unmet demand car hours 336.3 control vs 336.3 treatment · arms identical");
    expect(lastPairText({ ...charge, last_pair: { arm_error: "duplicate key value" } })).toBe("last pair failed in an arm: duplicate key value");
  });
});

describe("the window", () => {
  const now = new Date("2026-09-27T17:40:00Z");

  it("finds the next firing of a daily and of a one-shot schedule", () => {
    expect(nextCronUTC("41 10 * * *", now)?.toISOString()).toBe("2026-09-28T10:41:00.000Z");
    expect(nextCronUTC("0 6 28 9 *", now)?.toISOString()).toBe("2026-09-28T06:00:00.000Z");
    expect(nextCronUTC("*/10 * * * *", now)).toBeNull();
  });

  it("says when the night's pairs run, in Central time", () => {
    const board: LearningBoard = {
      runner: {
        enabled: false,
        window_jobs: [
          { job: "ottoq_dial_window_close", schedule_utc: "41 10 * * *", active: true },
          { job: "ottoq_dial_window_open", schedule_utc: "0 8 * * *", active: false },
          { job: "ottoq_dial_window_open_once_20260928", schedule_utc: "0 6 28 9 *", active: true },
        ],
      },
    };
    expect(windowText(board, now)).toBe("next window 1:00 AM CT – 5:41 AM CT");
    expect(windowText({ runner: { enabled: true } }, now)).toBe("running now: one pair every 10 minutes between runs");
    expect(windowText({ runner: { enabled: false, window_jobs: [] } }, now)).toBe("no window scheduled");
  });
});
