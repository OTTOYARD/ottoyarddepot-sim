// runLearning.test.ts — the "Learned this run" strip says what ottoq_run_learning says, in words, and draws "—" where a
// number is missing. The ended run is a real capture (run fd6ed035, Chase's busy_day of 2026-10-06); the live shapes
// below are built to the same contract, because no run was live to capture (they test wording, not a measurement).
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/runLearning.fd6ed035.json";
import { learningError, learningView, reasonShort, type RunLearning } from "./runLearning";

const live = (over: Partial<RunLearning>): RunLearning => ({
  ok: true,
  live: true,
  run: { tick: 214, status: "running", sim_run_id: "x" },
  window_ticks: 20,
  chargers: { dcfc: { free: 1, total: 10, faulted: 2 }, l2: { free: 0, total: 30, faulted: 1 } },
  chargers_free: 1,
  queue: { waiting: 41, waiting_for_a_charger: 34 },
  batch: { max_assets: 1, priority: [] },
  offers: {
    planners_recent: { offered: 3, used: 1, moved: 1, refused: 2, refused_by_reason: { stall_occupied: 1, stall_reserved: 1 } },
    planners_run: { offered: 40, used: 9, moved: 4, refused: 25 },
  },
  refusals: [],
  dispatched: [],
  lesson: { code: "more_cars_than_chargers" },
  ...over,
});

describe("an ended run (real capture, run fd6ed035)", () => {
  const v = learningView(fx as unknown as RunLearning)!;

  it("gives the run's offer totals and nothing read from the depot now", () => {
    expect(v.headline).toBe("The run ended. The planners made 49 offers: 0 used, 0 moved to an equal charger, 48 refused.");
    expect(v.tone).toBe("idle");
    expect(v.facts).toEqual([]); // its chargers and queue are the depot at read time, not the run's
    expect(v.basis).toBe("Run ended at tick 1578");
  });

  it("says where each refused charger went, by the planner's public name", () => {
    expect(v.refusals.map((r) => r.text)).toEqual([
      "Tick 1536: The lexicographic planner offered CANOPY-01 E-08 to Waymo-006. Tesla-AV-064 got it at tick 1534.",
      "Tick 1512: The lexicographic planner offered CANOPY-01 W-02 to Waymo-006. Tesla-AV-067 got it at tick 1510.",
      "Tick 1498: The lexicographic planner offered CANOPY-01 W-03 to Waymo-006. Waymo-AV-004 got it at tick 1496.",
      "Tick 1452: The lexicographic planner offered CANOPY-01 E-06 to Tesla-AV-061. That car already had it.",
    ]);
    expect(new Set(v.refusals.map((r) => r.key)).size).toBe(v.refusals.length);
    expect(v.moved).toEqual([]);
  });
});

describe("a live run", () => {
  it("more cars than chargers: says a taken charger went to a car ahead, and plans only the next free ones", () => {
    const v = learningView(live({
      dispatched: [
        { tick: 212, vehicle: "Waymo-AV-012", vehicle_id: "v1", stall: "CANOPY-01 E-04", moved_from_offer: true },
        { tick: 211, vehicle: "Zoox-AV-072", vehicle_id: "v2", stall: "CANOPY-01 E-07", moved_from_offer: false },
      ],
    }))!;
    expect(v.tone).toBe("held");
    expect(v.headline).toBe(
      "34 cars wait for 1 free charger. The planners plan only the next 1. When an offered charger is taken first, a car ahead in line got it.",
    );
    expect(v.facts).toEqual([
      "Free chargers: DCFC 1 of 10 · L2 0 of 30 · 3 chargers down",
      "Waiting for a charger: 34 · the planners plan the next 1",
      "Last 20 ticks: 3 offers · 1 used · 1 moved · 2 refused (1 charger taken, 1 held for another car)",
    ]);
    expect(v.moved.map((m) => m.text)).toEqual([
      "Tick 212: the offer for Waymo-AV-012 moved to CANOPY-01 E-04 when its first charger was taken.",
    ]);
    expect(v.basis).toBe("Tick 214 · last 20 ticks · the planners and the agent read this on each pass");
  });

  it("names every lesson the engine can give", () => {
    expect(learningView(live({ lesson: { code: "no_one_waiting" } }))!.headline).toBe("No car waits for a charger.");
    expect(learningView(live({
      lesson: { code: "offers_lost_their_charger" },
      offers: { planners_recent: { offered: 5, used: 2, moved: 1, refused: 2, refused_by_reason: { stall_occupied: 2 } } },
    }))!.headline).toBe("2 of the last 5 offers lost their charger before use. 1 moved to an equal free charger.");
    const ok = learningView(live({
      lesson: { code: "chargers_free" }, chargers_free: 5, queue: { waiting_for_a_charger: 2 },
      offers: { planners_recent: { offered: 4, used: 3, moved: 0, refused: 1 } },
    }))!;
    expect(ok.tone).toBe("ok");
    expect(ok.headline).toBe("5 free chargers for 2 waiting cars. In the last 20 ticks, the planners made 4 offers. The decide path used 3.");
    expect(learningView(live({ lesson: { code: "something_new" } }))!.headline).toBe("The run's learning has no lesson yet.");
  });

  it("draws a missing number as —, never 0", () => {
    const v = learningView({ ok: true, live: true, lesson: { code: "more_cars_than_chargers" } })!;
    expect(v.headline).toBe("— cars wait for — free chargers. The planners plan only the next —. When an offered charger is taken first, a car ahead in line got it.");
    expect(v.facts[0]).toBe("Free chargers: DCFC — of — · L2 — of —");
    expect(v.facts[2]).toBe("Last — ticks: — offers · — used · — moved · — refused");
    expect(v.basis).toBe("Tick — · last — ticks · the planners and the agent read this on each pass");
    for (const line of [v.headline, ...v.facts]) expect(line).not.toMatch(/\b0\b/);
  });

  it("keeps each sentence short", () => {
    for (const code of ["run_ended", "no_one_waiting", "more_cars_than_chargers", "offers_lost_their_charger", "chargers_free"]) {
      const v = learningView(live({ lesson: { code } }))!;
      for (const s of v.headline.split(/(?<=\.)\s+/)) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    }
  });
});

describe("a read that failed", () => {
  it("draws nothing and says why", () => {
    expect(learningView({ ok: false, error: "statement timeout" })).toBeNull();
    expect(learningView(null)).toBeNull();
    expect(learningError({ ok: false, error: "statement timeout" }, null)).toBe("statement timeout");
    expect(learningError(null, "network down")).toBe("network down");
    expect(learningError(fx as unknown as RunLearning, null)).toBeNull();
  });

  it("puts a disposer reason in words", () => {
    expect(reasonShort("stall_occupied")).toBe("charger taken");
    expect(reasonShort("stall_reserved")).toBe("held for another car");
    expect(reasonShort("some_new_reason")).toBe("some new reason");
  });
});
