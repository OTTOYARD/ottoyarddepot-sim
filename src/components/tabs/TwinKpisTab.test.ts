import { describe, expect, it } from "vitest";
import { latestDay } from "./TwinKpisTab";
import { chargeWaitDetail } from "@/lib/chargeWait";

// ottoq_kpi_five keys per-day KPIs in UTC. A booking that runs past midnight UTC creates the NEXT day's
// key with 0 turns while the run is still on the current day; run 736406cf read "0.00 turns per point"
// off exactly that entry at 14:40 CT.
describe("latestDay reads the day the sim clock is on", () => {
  const turns = { "2026-09-23": 3.61, "2026-09-24": 0 };

  it("ignores a day the sim clock has not reached", () => {
    expect(latestDay(turns, "2026-09-23T19:40:00Z")).toEqual({ day: "2026-09-23", value: 3.61 });
  });

  it("moves to the next day once the sim clock does", () => {
    expect(latestDay(turns, "2026-09-24T01:10:00Z")).toEqual({ day: "2026-09-24", value: 0 });
  });

  it("falls back to the latest key without a clock, and to null without data", () => {
    expect(latestDay(turns)).toEqual({ day: "2026-09-24", value: 0 });
    expect(latestDay(null, "2026-09-23T19:40:00Z")).toBeNull();
    expect(latestDay({}, "2026-09-23T19:40:00Z")).toBeNull();
  });
});

// Engine 0501 (G233): the wait for a charger, beside KPI 5. The numbers are the query behind 0501 on validation run
// 394e1e83, whose KPI 5 read 0.7 minutes while 42 cars were still waiting for a charger when it stopped.
describe("chargeWaitDetail says when its p95 is a floor", () => {
  const base = {
    sim_run_id: "394e1e83-f835-44a1-9c9f-7921c44af8c5", horizon: "2026-09-26T16:52:11Z",
    visits_owing_a_charge: 135, charged: 92, closed_without_a_session: 1,
    p50_wait_min: 16.2, p95_wait_min: 154.4, max_wait_min: 190.9, p95_wait_floor_min: 198.2,
  };

  it("names the cars still waiting and their longest wait so far", () => {
    expect(chargeWaitDetail({ ...base, waiting_at_horizon: 42, waiting_p50_so_far_min: 142.3, waiting_max_so_far_min: 232.2 }))
      .toBe("at least: 42 still waiting, the longest 232 min so far · p50 16.2 min over 92 charged");
  });

  it("reads as a finished wait when nothing is waiting", () => {
    expect(chargeWaitDetail({ ...base, charged: 134, waiting_at_horizon: 0, waiting_p50_so_far_min: null, waiting_max_so_far_min: null }))
      .toBe("p50 16.2 min over 134 charged of 135 owing a charge");
  });

  it("says none charged yet, never a zero-minute p50, before any car has charged", () => {
    expect(chargeWaitDetail({ ...base, charged: 0, p50_wait_min: null, waiting_at_horizon: 3, waiting_p50_so_far_min: 4, waiting_max_so_far_min: 6.4 }))
      .toBe("at least: 3 still waiting, the longest 6 min so far · none charged yet");
  });

  it("says so when no visit has arrived owing a charge", () => {
    expect(chargeWaitDetail({ ...base, visits_owing_a_charge: 0, charged: 0, closed_without_a_session: 0, p50_wait_min: null,
                              waiting_at_horizon: 0, waiting_p50_so_far_min: null, waiting_max_so_far_min: null }))
      .toBe("no visit has arrived owing a charge yet");
  });
});
