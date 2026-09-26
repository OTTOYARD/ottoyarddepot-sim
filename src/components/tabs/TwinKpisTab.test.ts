import { describe, expect, it } from "vitest";
import { latestDay } from "./TwinKpisTab";

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
