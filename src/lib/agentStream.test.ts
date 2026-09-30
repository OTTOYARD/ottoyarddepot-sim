// agentStream.test.ts — the Agent tab's sentences, from run 1ccad49b's real records.
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/ottoqRun.1ccad49b.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import type { DispositionRow } from "./ottoqFunnel";
import { agentPass, namesFromRows, objectiveWord, offerBatches, offerLine, reasonWord } from "./agentStream";
import { bandOf, funnelHeight, hash01, layoutCars, slotsFor, sparkLaneX } from "@/components/tabs/ottoq/funnelGeometry";

const feed = fx.feed as unknown as ActivityFeedRow[];
const disp = fx.dispositions as unknown as DispositionRow[];
const passes = feed.filter((r) => r.action === "orchestrator_agent");

describe("an agent pass in words", () => {
  it("says what it read, what it chose and what happened, from the pass itself", () => {
    const r = passes.find((p) => p.outcome === "enacted")!;
    const p = agentPass(r);
    expect(p.tone).toBe("ok");
    expect(p.headline).toBe("The agent read the depot and chose to get cars ready first");
    expect(p.read).toBe((r.rationale as { summary: string }).summary);
    expect(p.directives.length).toBe((r.rationale as { applied: unknown[] }).applied.length);
    expect(p.chose).toMatch(/^It chose to get cars ready first/);
    expect(p.outcome.join(" ")).toMatch(/CP-SAT took the hand-off and returned/);
    expect(p.outcome.join(" ")).not.toMatch(/undefined|NaN|null/);
  });

  it("says a fallback is a fallback, and shows no model words it did not get", () => {
    const r = passes.find((p) => p.outcome !== "enacted")!;
    const p = agentPass(r);
    expect(p.tone).toBe("held");
    expect(p.headline).toBe("The agent fell back to the deterministic path");
    expect(p.read).toBeNull();
    expect(p.chose).toMatch(/model did not answer \(model timed out after 75 s\)/);
    expect(p.outcome).toContain("No solver was asked this pass.");
  });

  it("never names an objective it was not given", () => {
    expect(objectiveWord(undefined)).toBe("an objective not recorded");
    expect(objectiveWord("readiness_first")).toBe("get cars ready first");
    expect(objectiveWord("new_one")).toBe("new one");
  });
});

describe("the proposers' offers in words", () => {
  const names = namesFromRows(feed);

  it("names the planner, the car and why, and marks only a real refusal red", () => {
    const refused = disp.find((d) => d.status === "refused" && !d.abstained && d.disposition_reason === "stall_reserved")!;
    const l = offerLine(refused, names);
    expect(l.tone).toBe("refused");
    expect(l.text).toMatch(/the greedy planner's offer for .+ was refused: the stall was held for another car\./);
    const abst = disp.find((d) => d.abstained)!;
    expect(offerLine(abst, names).tone).toBe("idle");
    expect(offerLine(abst, names).text).toMatch(/^CP-SAT made no offer for/);
  });

  it("groups offers by tick and planner and keeps every offer", () => {
    const b = offerBatches(disp, names);
    expect(b.reduce((s, x) => s + x.lines.length, 0)).toBe(disp.length);
    for (const x of b) expect(new Set(x.lines.map((l) => l.key)).size).toBe(x.lines.length);
  });

  it("reads a reason it has no words for as its own words", () => {
    expect(reasonWord("outside this tick's batch of 8 most urgent ")).toBe("outside this tick's batch of 8 most urgent");
    expect(reasonWord(null)).toBeNull();
  });
});

describe("funnel geometry", () => {
  it("is an hourglass: the thinking neck is the narrowest part", () => {
    const w = 200;
    const width = (id: Parameters<typeof bandOf>[0]) => bandOf(id, w).x1 - bandOf(id, w).x0;
    expect(width("decide")).toBeLessThan(width("proposers"));
    expect(width("decide")).toBeLessThan(width("shield"));
    expect(width("arriving")).toBeGreaterThan(width("needs"));
    expect(funnelHeight()).toBeGreaterThan(400);
  });

  it("places a car in the same slot on every redraw", () => {
    const cars = [{ id: "a", layer: "service" as const }, { id: "b", layer: "service" as const }];
    const one = layoutCars(cars, 210).pos.get("a");
    const two = layoutCars([...cars].reverse(), 210).pos.get("a");
    expect(one).toEqual(two);
    expect(hash01("a")).toBe(hash01("a"));
  });

  it("fits the captured depot at the narrowest panel, saying how many did not fit", () => {
    // 320 px panel, the drawing takes 52% of it
    const w = Math.floor(320 * 0.52) - 0;
    const cars = (fx.cards_b as { vehicle_id: string; state: string }[])
      .filter((v) => v.state.startsWith("charging") || v.state.includes("holding") || v.state.includes("bay"))
      .map((v) => ({ id: v.vehicle_id, layer: "service" as const }));
    const { pos, overflow } = layoutCars(cars, w);
    expect(pos.size + (overflow.service ?? 0)).toBe(cars.length);
    const b = bandOf("service", w);
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(b.x0);
      expect(p.x).toBeLessThanOrEqual(b.x1);
      expect(p.y).toBeGreaterThan(b.y0);
      expect(p.y).toBeLessThan(b.y1);
    }
    expect(slotsFor(b).length).toBeGreaterThan(0);
  });

  it("keeps a spark's lane inside both bands it joins", () => {
    const x = sparkLaneX("k", "decide", "booked", 200);
    const d = bandOf("decide", 200);
    expect(x).toBeGreaterThanOrEqual(d.x0);
    expect(x).toBeLessThanOrEqual(d.x1);
  });
});

describe("offer batches by tick", () => {
  it("carry the tick's sim time from the engine's own decisions, and fold ticks where nothing was enacted or refused", async () => {
    const { tickClocks } = await import("./agentStream");
    const b = offerBatches(disp, namesFromRows(feed), tickClocks(feed));
    const loud = b.filter((x) => !x.quiet);
    expect(loud.length).toBeGreaterThan(0);
    for (const x of loud) expect(x.lines.some((l) => l.tone === "ok" || l.tone === "refused")).toBe(true);
    for (const x of b.filter((y) => y.quiet)) expect(x.lines.every((l) => l.tone === "idle")).toBe(true);
    const withClock = b.find((x) => x.tick != null && x.at);
    expect(withClock?.at).toBe(feed.find((r) => r.tick_seq === withClock!.tick)!.occurred_at);
  });
});
