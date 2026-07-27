import { describe, it, expect, beforeEach } from "vitest";
import { createRng, seedDemoRng, demoRandom, currentDemoSeed } from "./rng";
import { generateArrivals, resetArrivalGenerator } from "./ArrivalGenerator";
import { useSimulationStore } from "@/store/simulationStore";

describe("createRng", () => {
  it("replays identically from the same seed", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const draws = Array.from({ length: 200 }, () => [a.next(), b.next()]);
    for (const [x, y] of draws) expect(x).toBe(y);
  });

  it("diverges on a different seed", () => {
    const a = createRng(1), b = createRng(2);
    const same = Array.from({ length: 50 }, () => a.next() === b.next()).filter(Boolean);
    expect(same).toHaveLength(0);
  });

  it("stays inside [0,1)", () => {
    const r = createRng(999);
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() is inclusive on both bounds and never escapes them", () => {
    const r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      const v = r.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("chance() tracks its probability", () => {
    const r = createRng(42);
    const hits = Array.from({ length: 10000 }, () => r.chance(0.25)).filter(Boolean).length;
    expect(hits / 10000).toBeGreaterThan(0.22);
    expect(hits / 10000).toBeLessThan(0.28);
  });

  it("range() respects its bounds", () => {
    const r = createRng(5);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-15, 15);
      expect(v).toBeGreaterThanOrEqual(-15);
      expect(v).toBeLessThan(15);
    }
  });
});

describe("demo generator", () => {
  it("re-seeding restarts the stream", () => {
    seedDemoRng(2024);
    const first = Array.from({ length: 10 }, () => demoRandom().next());
    seedDemoRng(2024);
    const second = Array.from({ length: 10 }, () => demoRandom().next());
    expect(second).toEqual(first);
    expect(currentDemoSeed()).toBe(2024);
  });
});

describe("offline demo arrivals are reproducible", () => {
  const config = useSimulationStore.getState().config;

  // Drive many sim-seconds so the spawn probability actually fires; a single
  // tick would pass trivially by generating nothing on both runs.
  function runArrivals(seed: number) {
    seedDemoRng(seed);
    resetArrivalGenerator();
    const out: string[] = [];
    for (let t = 0; t < 86400; t += 30) {
      for (const v of generateArrivals(t, 30, config, out.length)) {
        out.push(`${v.type}|${v.priority}|${v.currentSoC.toFixed(4)}|${v.serviceQueue.join(">")}`);
      }
    }
    return out;
  }

  beforeEach(() => resetArrivalGenerator());

  it("produces an identical arrival stream for the same seed", () => {
    const a = runArrivals(777);
    const b = runArrivals(777);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("produces a different stream for a different seed", () => {
    expect(runArrivals(778)).not.toEqual(runArrivals(777));
  });
});
