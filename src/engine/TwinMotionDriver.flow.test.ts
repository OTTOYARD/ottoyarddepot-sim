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
//
//   fresh0922    public.vehicle_state_log of run 0682752c, started FRESH from
//                the cockpit after that fix merged (busy_day, 8x): the first
//                405 s, i.e. a whole opening dispatch wave — ~50 departures for
//                the one exit gate inside a minute. Replayed as captured (8x),
//                and `playAt: 3` — the same world, as the cockpit shows it when
//                the run plays at 3x. Both sides, same harness (main = cb58ef1):
//
//                                      main        this change
//   fresh0922, played at 3x stopped    5.7%        3.5%
//                           stuck      34          0
//                           overlap    92          70
//   fresh0922, at 8x        stopped    19.0%       12.6%
//                           stuck      227         71
//                           overlap    216         182
//
// Every stuck car on main was a LOOP of waits the 45 s watchdog broke: a stall
// exit waiting to merge beside a lane car stopped for its body, and four cars
// at Ts / Sg3 each waiting on the next. What is left at 8x is the opening wave
// itself. The renderer's motion is capped at 3x (setViewMult, founder spec
// 2026-07-25) while the world runs at 8x, so a wave that leaves the stalls at
// 8x reaches the exit at 3x and queues there; with that cap lifted to 8 the same
// capture measures 3.2% / 0 / 60. The 8x budgets hold the queue where it is —
// they are not a target.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { replayFlow, formatFlow, type FlowReport } from "./__fixtures__/flowReplay";

describe("traffic flow — the 2026-09-22 live run, replayed on the cockpit's cadence", () => {
  let burst: FlowReport;
  let rec: FlowReport;
  let fresh8: FlowReport;
  let fresh3: FlowReport;
  // ~5 s each locally; CI is a shared runner and much slower, so the ceiling is generous.
  beforeAll(() => {
    burst = replayFlow("live0922", { maxWallMs: 900_000 });
    rec = replayFlow("live0922rec", { maxWallMs: 600_000 });
    fresh8 = replayFlow("fresh0922", { maxWallMs: 420_000 });
    fresh3 = replayFlow("fresh0922", { playAt: 3, maxWallMs: 1_120_000 });
  }, 600_000);

  it("DIAGNOSTIC: dump the flow", () => {
    console.log("\n" + formatFlow("live0922 (burst, first 900 s)", burst) + "\n" + formatFlow("live0922rec (recorded, first 600 s)", rec) +
      "\n" + formatFlow("fresh0922 (fresh start, 8x)", fresh8) + "\n" + formatFlow("fresh0922 (fresh start, played at 3x)", fresh3));
    expect(burst.geometry.samples).toBeGreaterThan(0);
    expect(rec.geometry.samples).toBeGreaterThan(0);
    expect(fresh8.geometry.samples).toBeGreaterThan(0);
    expect(fresh3.geometry.samples).toBeGreaterThan(0);
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
    expect(fresh8.flow.lockCycleSteps).toBe(0);
    expect(fresh3.flow.lockCycleSteps).toBe(0);
  });

  it("a fresh start, played at 3x: the whole opening wave flows and nothing wedges", () => {
    // 5.7% / 34 stuck on main — two loops of waits, each until the watchdog
    expect(fresh3.flow.stoppedFraction).toBeLessThanOrEqual(0.04);
    expect(fresh3.geometry.stuckSamples).toBeLessThanOrEqual(5);
  });

  it("a fresh start at 8x: the opening wave queues for the exit, no loop of waits holds it", () => {
    // 19.0% / 227 stuck on main; see the header for why 8x cannot reach the 3x figures
    expect(fresh8.flow.stoppedFraction).toBeLessThanOrEqual(0.135);
    expect(fresh8.geometry.stuckSamples).toBeLessThanOrEqual(80);
  });

  it("the recorded stream flows freely and nothing wedges", () => {
    expect(rec.flow.stoppedFraction).toBeLessThanOrEqual(0.02);
    expect(rec.geometry.stuckSamples).toBeLessThanOrEqual(5);
  });

  it("body overlap stays within the ratchet on every capture (target 0)", () => {
    expect(burst.geometry.overlapPairSamples).toBeLessThanOrEqual(82);
    expect(rec.geometry.overlapPairSamples).toBeLessThanOrEqual(8);
    expect(fresh3.geometry.overlapPairSamples).toBeLessThanOrEqual(78);
    expect(fresh8.geometry.overlapPairSamples).toBeLessThanOrEqual(190);
  });

  it("no car is ever drawn off the lot", () => {
    expect(burst.geometry.worstOffMap).toBe(0);
    expect(rec.geometry.worstOffMap).toBe(0);
    expect(fresh8.geometry.worstOffMap).toBe(0);
    expect(fresh3.geometry.worstOffMap).toBe(0);
  });
});
