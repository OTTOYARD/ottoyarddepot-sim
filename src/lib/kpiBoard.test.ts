// kpiBoard.test.ts — the KPI board as the engine computed it for run fd6ed035 (busy_day, 2026-10-06, the run Chase
// watched), read-only capture in ../components/tabs/__fixtures__/kpiBoard.fd6ed035.json.
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/kpiBoard.fd6ed035.json";
import type { TwinKpiBoard } from "@/lib/ottoTwin";
import {
  TIME_SEGMENTS, boardCaption, chargerRows, energyRows, fmtMin, fmtPct, headlineTiles, serviceRows, timeSplit, topServices,
  turnaroundRows, waitingShare, windowLabel,
} from "./kpiBoard";

const b = fx.board as unknown as TwinKpiBoard;

describe("where fleet time went", () => {
  it("accounts for every car-hour of the run once", () => {
    const seg = timeSplit(b);
    const hours = seg.reduce((a, s) => a + s.hours, 0);
    expect(Math.abs(hours - (b.fleet_hours ?? 0))).toBeLessThan(0.5);
    expect(Math.round(seg.reduce((a, s) => a + s.pct, 0))).toBe(100);
    expect(seg.map((s) => s.key)).toEqual(TIME_SEGMENTS.map((s) => s.key));
  });

  it("matches the engine's uptime: on the road plus ready", () => {
    const seg = timeSplit(b);
    const up = seg.filter((s) => s.key === "road" || s.key === "ready").reduce((a, s) => a + s.pct, 0);
    expect(up).toBeCloseTo(b.uptime!.pct!, 0);
  });

  it("names the wait: after arrival and between steps, 40% of fleet time on this run", () => {
    const w = waitingShare(timeSplit(b))!;
    expect(w).toBeGreaterThan(39);
    expect(w).toBeLessThan(41);
  });

  it("draws nothing for a run without a state history", () => {
    expect(timeSplit({ ok: false, error: "no_state_history" })).toEqual([]);
    expect(waitingShare([])).toBeNull();
  });
});

describe("headline tiles", () => {
  it("lead with turnaround, battery at dispatch, on time and cars out, with their denominators", () => {
    const t = headlineTiles(b);
    expect(t.map((x) => x.label)).toEqual(["Turnaround", "Left fully charged", "Ready on time", "Cars sent out"]);
    expect(t[0]).toMatchObject({ value: "1 h 57 min", sub: "median, arrival to ready · 54 of 143 visits done" });
    expect(t[1]).toMatchObject({ value: "118 of 118", sub: "battery at dispatch: average 100%, lowest 99%", tone: "good" });
    expect(t[2]).toMatchObject({ value: "75%", sub: "45 of 60 visits with a due time" });
    expect(t[3]).toMatchObject({ value: "118", sub: "20.2 an hour · 143 came in" });
  });

  it("says nothing left yet instead of 0 of 0", () => {
    const t = headlineTiles({ ok: true, departures: { dispatched: 0, at_99_or_more: 0, soc_avg: null, soc_min: null, soc_unknown: 0, trips_back: 0, miles: null, kwh_used: null, soc_back_avg: null } });
    expect(t[1]).toMatchObject({ value: "—", sub: "no car left yet", tone: null });
  });
});

describe("sections", () => {
  it("turnaround says how many visits each figure is over, and counts the visits still open", () => {
    const r = turnaroundRows(b);
    expect(r[0]).toMatchObject({ label: "Arrival to first service", value: "15 min" });
    expect(r[1].detail).toBe("median · 90% within 4 h 10 min · over 54 visits done");
    expect(r[2]).toMatchObject({ value: "89", detail: "visits · median 3 h 29 min so far" });
    expect(r[3]).toMatchObject({ label: "Wait for a charger", value: "21 min" });
    expect(r[3].detail).toContain("48 still waiting at the end");
  });

  it("energy and chargers read the run's own integrals", () => {
    const e = energyRows(b);
    expect(e[0].value).toBe("4,364 kWh");
    expect(e[1]).toMatchObject({ value: "$230", detail: "3,198 kWh at $0.072 a kWh" });
    expect(e[2].value).toBe("36%");
    expect(e[3].detail).toBe("the battery cut 105 kW off a site peak of 773 kW");
    const c = chargerRows(b);
    expect(c.map((x) => x.value)).toEqual(["85%", "95%", "176"]);
  });

  it("service counts steps and lists the services with the most done", () => {
    expect(serviceRows(b)[0]).toMatchObject({ value: "437 of 747" });
    const top = topServices(b, 3);
    expect(top.map((x) => x.name)).toEqual(["Interior inspection", "Readiness gate", "Charge to target"]);
    expect(top[0].pct).toBeCloseTo((100 * 133) / 179, 5);
  });
});

describe("formatting", () => {
  it("says minutes the way people do, and a dash for nothing", () => {
    expect(fmtMin(14.5)).toBe("15 min");
    expect(fmtMin(116.7)).toBe("1 h 57 min");
    expect(fmtMin(120)).toBe("2 h");
    expect(fmtMin(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
  });

  it("puts the run's window on the sim clock, in Central time", () => {
    expect(windowLabel(b.window)).toBe("sim 8:00 AM – 1:50 PM CT");
    expect(windowLabel({ from: "2026-09-01T11:00:00Z", to: "2026-09-02T11:00:00Z" })).toBe("sim Sep 1 6:00 AM – Sep 2 6:00 AM CT");
    expect(boardCaption(b)).toBe("Run fd6ed035 · busy_day · sim 8:00 AM – 1:50 PM CT · 116 cars");
  });
});
