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
// poll every 1.5 s, motion at the driver's view multiplier — and measure flow
// (see __fixtures__/flowReplay.ts for every definition):
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
// at Ts / Sg3 each waiting on the next. What was left at 8x was the opening
// wave itself, and that was the motion cap:
//
// MOTION FOLLOWS PLAYBACK (MAX_VIEW_MULT). The renderer's motion was capped at
// 3x while the world ran at 8x, so a wave that left the stalls at 8x drained at
// 3x and the picture ran behind the twin. The cap is now the backend's own
// playback ceiling. Both sides, same harness (main = e48dc4e, motion at 3x):
//
//                                      motion 3x   follows playback
//   live0922, first 900 s   stopped    3.0%        2.5%
//                           stuck      5           2
//                           max trip   87.6 s      68.4 s
//                           overlap    5.5% · 26   2.5% · 10
//   live0922rec, first 600 s stopped   0.5%        0.5%
//                           stuck      0           0
//                           overlap    0.3% · 1    0.2% · 0
//   fresh0922, at 8x        stopped    12.6%       3.2%
//                           stuck      71          0
//                           overlap    30.0% · 78  3.7% · 1
//   fresh0922, played at 3x            unchanged (3x is inside both caps)
//
// Overlap reads "share of samples · pairs on screen". It is budgeted as those
// two, not as the raw sample count used above: samples are taken every 2 MOTION
// seconds, so 8x motion puts 8/3 as many into the same wall window, and a raw
// count compared across multipliers read 75 -> 90 for a picture whose
// overlapping pairs went 26 -> 10. "On screen" is one census per snapshot poll —
// uniform in WALL time, i.e. what a viewer watching for the length of the capture
// sees. And the picture is behind OTTO-Q less: on the recording (the one capture
// with travel legs), driving cars already past their leg's end_sim went from
// 29.2% to 14.5% of car-polls; that is also why the recording's trips run a few
// percent longer in motion time — a car paced to its leg arrives on time, where
// a car capped at 3x was always late and at full speed.
//
// WAITS THAT USED TO BE COLLISIONS (2026-10-07). The founder, 2026-10-06: "making
// sure as vehicles approach each other they don't collide or pass through one
// another." The motion audit (__fixtures__/motionAudit.ts) sorted every overlap by
// situation, and most were a car driving THROUGH something it should have waited
// for: a staging back-out, or a car standing at its cusp, across its lane (RailFlow
// finds a leader by its CENTRE on the follower's path, and a body standing across a
// lane has its centre off it); a car pulling out across the near stream to join the
// far one; the gate queue's cars converging on the throat into the car in front.
// They wait now (TwinMotionDriver.streamClaims, merge `cross`, GATE_QUEUE_TURN_X),
// and the waiting is the stopped time below. Both sides, same harness
// (before = f007035):
//
//                                      before      after
//   live0922, first 900 s   stopped    1.8%        3.0%
//                           stuck      1           6
//                           overlap    1.2% · 4    0.2% · 1
//   live0922rec, first 600 s stopped   0.6%        0.8%
//                           overlap    0.2% · 0    0.04% · 0
//   fresh0922, at 8x        stopped    3.0%        4.2%
//                           overlap    2.3% · 3    0.5% · 2
//   fresh0922, played at 3x stopped    2.7%        4.7%
//                           stuck      0           2
//                           overlap    1.5% · 12   0.4% · 2
//
// Where fresh0922 @3x's extra ~77 stopped car-seconds went (limiter of every
// stopped car, every step): ~33 s is the gate queue now leaving one car at a time,
// ~56 s is lane traffic and joining cars waiting for back-outs and for cars at their
// cusps, and ~15 s fewer is spent at junctions and merges. live0922's 6 stuck
// samples are ONE wait: a south-row car at its cusp, its rail starting at a
// junction, held ~22 s while the neighbour that committed first backs out across
// its path. The stopped and stuck budgets moved up to this measurement for that
// reason only; the overlap and on-screen budgets moved DOWN to it.
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
    // 25.9% before #105, almost all of it cars stopped behind a body that never
    // moved; 3.0% with motion capped at 3x; 1.8% -> 3.0% when cars began waiting for
    // back-outs instead of driving through them (header)
    expect(burst.flow.stoppedFraction).toBeLessThanOrEqual(0.032);
  });

  it("the opening burst wedges nothing", () => {
    // stuck = holds a route, no arc progress for >10 s. 793 samples before #105;
    // 6 now, all one car waiting ~22 s for a neighbour's back-out (header)
    expect(burst.geometry.stuckSamples).toBeLessThanOrEqual(7);
    // longest finished trip; one of 261.6 s before #105 (a car looping a block it
    // could never enter), 87.6 s with motion capped at 3x
    expect(burst.flow.maxTripS).toBeLessThanOrEqual(80);
  });

  it("no two cars ever wait on each other at a junction", () => {
    expect(burst.flow.lockCycleSteps).toBe(0);
    expect(rec.flow.lockCycleSteps).toBe(0);
    expect(fresh8.flow.lockCycleSteps).toBe(0);
    expect(fresh3.flow.lockCycleSteps).toBe(0);
  });

  it("a fresh start, played at 3x: the whole opening wave flows and nothing wedges", () => {
    // 5.7% / 34 stuck on main — two loops of waits, each until the watchdog; 2.7% ->
    // 4.7% when cars began queueing at the gate and waiting for back-outs (header)
    expect(fresh3.flow.stoppedFraction).toBeLessThanOrEqual(0.05);
    expect(fresh3.geometry.stuckSamples).toBeLessThanOrEqual(5);
  });

  it("a fresh start at 8x flows like it does at 3x: the wave drains as fast as it leaves", () => {
    // 19.0% / 227 stuck before #106; 12.6% / 71 with motion capped at 3x; 3.0% ->
    // 4.2% when cars began queueing at the gate and waiting for back-outs (header)
    expect(fresh8.flow.stoppedFraction).toBeLessThanOrEqual(0.045);
    expect(fresh8.geometry.stuckSamples).toBeLessThanOrEqual(5);
  });

  it("the recorded stream flows freely and nothing wedges", () => {
    expect(rec.flow.stoppedFraction).toBeLessThanOrEqual(0.01);
    expect(rec.geometry.stuckSamples).toBeLessThanOrEqual(2);
  });

  it("body overlap stays within the ratchet on every capture (target 0)", () => {
    // share of motion samples (see the header for why not the raw count). 2026-10-07:
    // 1.2% / 0.2% / 2.3% / 1.5% -> 0.2% / 0.04% / 0.5% / 0.4% (header)
    expect(burst.geometry.overlapRate).toBeLessThanOrEqual(0.004);
    expect(rec.geometry.overlapRate).toBeLessThanOrEqual(0.002);
    expect(fresh8.geometry.overlapRate).toBeLessThanOrEqual(0.007);
    expect(fresh3.geometry.overlapRate).toBeLessThanOrEqual(0.006);
  });

  it("the picture a viewer sees: overlapping pairs on screen, once per poll", () => {
    // motion capped at 3x: 26 / 1 / 78 (fresh, 8x) / 23 (fresh, played at 3x);
    // 2026-10-07: 4 / 0 / 3 / 12 -> 1 / 0 / 2 / 2 (header)
    expect(burst.viewer.overlapPairPolls).toBeLessThanOrEqual(3);
    expect(rec.viewer.overlapPairPolls).toBeLessThanOrEqual(1);
    expect(fresh8.viewer.overlapPairPolls).toBeLessThanOrEqual(3);
    expect(fresh3.viewer.overlapPairPolls).toBeLessThanOrEqual(4);
  });

  it("no car is ever drawn off the lot", () => {
    expect(burst.geometry.worstOffMap).toBe(0);
    expect(rec.geometry.worstOffMap).toBe(0);
    expect(fresh8.geometry.worstOffMap).toBe(0);
    expect(fresh3.geometry.worstOffMap).toBe(0);
  });
});
