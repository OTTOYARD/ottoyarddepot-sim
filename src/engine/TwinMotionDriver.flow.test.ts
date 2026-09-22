// ============================================================================
// TRAFFIC FLOW RATCHET — does the depot actually MOVE?
//
// The founder, 2026-09-22, watching live run 6a8a7029 (busy_day, 8x): "the
// traffic gets horribly backed up so that we can't even accurately see if
// vehicles are staging properly … hesitating and stopping when they begin to
// collide and meet one another at intersections and in passing."
//
// The busy_day ratchets (TwinMotionDriver.fixture.test.ts) could not see it: a
// car that stops at every junction never overlaps anything, and a car wedged for
// the rest of a run is one line in a stuck count. These replay two captures OF
// THAT RUN through the real driver on the cockpit's own cadence — a snapshot
// poll every 1.5 s, motion at min(3, speed_x) — and measure flow (see
// __fixtures__/flowReplay.ts for every definition):
//
//   live0922     public.vehicle_state_log from the run's start: the opening
//                burst (64 arrivals in its first minute), which is what a cockpit
//                opened with the run sees.
//   live0922rec  the public snapshot endpoint itself, recorded every ~2 s for
//                25 min mid-run: exact stalls, reservations and travel legs.
//
// Both sides, same harness, same windows (main = 8a3e28f):
//
//                                      main        this change
//   live0922, first 900 s   stopped    25.9%       3.0%
//                           stuck      793         5
//                           overlap    238         75
//                           max trip   261.6 s     < 90 s
//   live0922rec, first 600 s stopped   3.9%        0.5%
//                           stuck      15          0
//                           overlap    38          3
//
// On main the burst WEDGES four cars for the rest of the run: a car leaving a
// stall was routed from the nearest graph node, drove into its parked
// neighbour, and never moved again; the ledger then handed its stall to the
// next car, which looped the block. The budgets below sit just above this
// change's measurement. If a change pushes them up, it is putting that back.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { replayFlow, formatFlow, type FlowReport } from "./__fixtures__/flowReplay";

describe("traffic flow — the 2026-09-22 live run, replayed on the cockpit's cadence", () => {
  let burst: FlowReport;
  let rec: FlowReport;
  // ~5 s each locally; CI is a shared runner and much slower, so the ceiling is generous.
  beforeAll(() => {
    burst = replayFlow("live0922", { maxWallMs: 900_000 });
    rec = replayFlow("live0922rec", { maxWallMs: 600_000 });
  }, 600_000);

  it("DIAGNOSTIC: dump the flow", () => {
    console.log("\n" + formatFlow("live0922 (burst, first 900 s)", burst) + "\n" + formatFlow("live0922rec (recorded, first 600 s)", rec));
    expect(burst.geometry.samples).toBeGreaterThan(0);
    expect(rec.geometry.samples).toBeGreaterThan(0);
  });

  it("the opening burst keeps moving: cars are stopped for a small share of their taxi time", () => {
    // 25.9% on main, almost all of it cars stopped behind a body that never moved
    expect(burst.flow.stoppedFraction).toBeLessThanOrEqual(0.045);
  });

  it("the opening burst wedges nothing", () => {
    // stuck = holds a route, no arc progress for >10 s. 793 samples on main.
    expect(burst.geometry.stuckSamples).toBeLessThanOrEqual(10);
    // longest finished trip; main had one of 261.6 s (a car looping a block it
    // could never enter)
    expect(burst.flow.maxTripS).toBeLessThanOrEqual(100);
  });

  it("no two cars ever wait on each other at a junction", () => {
    expect(burst.flow.lockCycleSteps).toBe(0);
    expect(rec.flow.lockCycleSteps).toBe(0);
  });

  it("the recorded stream flows freely and nothing wedges", () => {
    expect(rec.flow.stoppedFraction).toBeLessThanOrEqual(0.02);
    expect(rec.geometry.stuckSamples).toBeLessThanOrEqual(5);
  });

  it("body overlap stays within the ratchet on both captures (target 0)", () => {
    expect(burst.geometry.overlapPairSamples).toBeLessThanOrEqual(82);
    expect(rec.geometry.overlapPairSamples).toBeLessThanOrEqual(8);
  });

  it("no car is ever drawn off the lot", () => {
    expect(burst.geometry.worstOffMap).toBe(0);
    expect(rec.geometry.worstOffMap).toBe(0);
  });
});
