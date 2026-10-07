// ============================================================================
// MOTION RATCHETS — the founder's 2026-10-06 report, measured on every verify.
//
// Chase, watching run fd6ed035 (twinRun.chase1006.json): "major vehicle issues
// with the vehicle still spin in place when they approach other vehicles or
// potential traffic jams ... making sure as vehicles approach each other they
// don't collide or pass through one another."
//
// Three windows of the captures motionAudit.measure.test.ts reports in full, run
// through the same instrument (__fixtures__/motionAudit.ts holds every definition):
//
//   busyday          the whole capture (930 s, 1x)
//   fresh0922 @8x    the opening dispatch wave of run 0682752c (405 s)
//   chase1006 10min  the first 10 minutes of the founder's run (3x; the measure
//                    file also reports 30 min and the whole 2 h)
//
// A PIVOT is the drawn heading turning >= 45° within 4u of travel (p45) or >= 90°
// within 9.8u (p90): a body turning about a point inside its own length. "Near"
// counts the ones with another car within 15u, which is what the founder saw.
// OVERLAP is two oriented 9.8 x 4.0 bodies intersecting at flowReplay's sample
// cadence (every 2 motion s); ON SCREEN is one census of the drawn poses per
// snapshot poll. A CUSP RAIL is the rail a staging back-out ends on; "off" is how
// far its start points from the way the car does (a kink the heading can only take
// by pivoting). Before this work (2113ef3) and after it (2026-10-07):
//
//                      p45 (near)            p90        overlap   on screen  cusp rails >60° off
//   busyday           159 (44) -> 29 (14)   92 -> 16   40 -> 12     -         29 -> 2
//   fresh0922 @8x     202 (59) -> 63 (22)  115 -> 29   33 -> 8    0 -> 1      35 -> 2
//   chase1006 10min   149 (28) -> 35 (14)   93 -> 18   15 -> 3    3 -> 4      20 -> 1
//
// What moved them, in order (commits on 2026-10-06/07): rails open on the car's
// heading and U-turns are priced (RailFlow.startOnHeading, LaneGraph's U-turn
// search); the perimeter ring divided with a median; back-outs, cusps and the gate
// queue claimed so traffic waits for them (TwinMotionDriver.streamClaims, merge
// `cross`, GATE_QUEUE_TURN_X); openings kept out of stalls and structures; cusps
// kept 2u off the far row (CUSP_CLEAR).
//
// ON SCREEN rose on two windows while overlap fell 4-5x. The census looks once per
// poll and the overlaps left are few and long: on chase1006's first 30 min, 7
// episodes, and one is 7 s of motion (inside the first 10) — W-24, the west column's
// last stall, backing out with both swings and every straight down to 6u sweeping a
// parked car (W-23's or S1-2's, across the south-west corner). That one is layout,
// not motion.
//
// Each budget sits just above the measurement. If a change pushes one up, it is
// putting back what the founder saw: measure it with motionAudit.measure.test.ts
// on all seven captures before you raise anything.
//
// One window per describe, each replayed in its own hook (15 s at most locally): a
// replay is synchronous, and one hook running all three blocked the worker long
// enough under `npm run verify`'s parallel load for vitest's own RPC to time out.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { auditFixture, formatAudit, type AuditReport } from "./__fixtures__/motionAudit";

interface Budget { p45: number; p45Near: number; p90: number; overlap: number; onScreen: number; tight: number; cuspOff60: number }

const WINDOWS: { label: string; fixture: "busyday" | "fresh0922" | "chase1006"; opts: { maxWallMs?: number }; budget: Budget }[] = [
  // measured 2026-10-07: 29 (14) / 16 / 12 / – / 7.0% / 2
  { label: "busyday", fixture: "busyday", opts: {}, budget: { p45: 33, p45Near: 17, p90: 19, overlap: 14, onScreen: 0, tight: 0.08, cuspOff60: 3 } },
  // measured 2026-10-07: 63 (22) / 29 / 8 / 1 / 7.9% / 2
  { label: "fresh0922 @8x", fixture: "fresh0922", opts: { maxWallMs: 420_000 }, budget: { p45: 68, p45Near: 25, p90: 33, overlap: 10, onScreen: 3, tight: 0.09, cuspOff60: 3 } },
  // measured 2026-10-07: 35 (14) / 18 / 3 / 4 / 6.3% / 1
  { label: "chase1006 10min", fixture: "chase1006", opts: { maxWallMs: 600_000 }, budget: { p45: 39, p45Near: 17, p90: 21, overlap: 5, onScreen: 5, tight: 0.07, cuspOff60: 2 } },
];

for (const w of WINDOWS) {
  describe(`motion — the founder's 2026-10-06 report, replayed: ${w.label}`, () => {
    let r: AuditReport;
    // CI is a shared runner and much slower than the 5-15 s this takes locally.
    beforeAll(() => {
      r = auditFixture(w.fixture, w.opts, w.label);
    }, 300_000);

    it("DIAGNOSTIC: the audit", () => {
      console.log(formatAudit(r));
      expect(r.flow.geometry.samples).toBeGreaterThan(0);
    });

    it("no car spins in place, and none drives through a structure", () => {
      expect(r.spinSteps).toBe(0);
      expect(r.structureHits).toBe(0);
    });

    it("cars turn about a point outside their own length: pivot events stay within the budget", () => {
      expect(r.pivots.p45, "p45").toBeLessThanOrEqual(w.budget.p45);
      expect(r.pivotsNear.p45, "p45 near another car").toBeLessThanOrEqual(w.budget.p45Near);
      expect(r.pivots.p90, "p90").toBeLessThanOrEqual(w.budget.p90);
      expect(r.tightShare, "share of turning at R < 5u").toBeLessThanOrEqual(w.budget.tight);
    });

    it("a rail starts the way its car points", () => {
      // a car's first rail (spawn, departure, residue repair) never starts > 30° off
      expect(r.rails.start?.kink30 ?? 0, "start rails > 30° off").toBe(0);
      expect(r.rails.cusp?.kink60 ?? 0, "cusp rails > 60° off").toBeLessThanOrEqual(w.budget.cuspOff60);
      for (const c of ["start", "cusp"] as const) expect(r.rails[c]?.hairpin ?? 0, `${c} rails with a hairpin`).toBe(0);
    });

    it("bodies do not pass through one another beyond the budget (target 0)", () => {
      expect(r.overlapSamples, "overlap pair-samples").toBeLessThanOrEqual(w.budget.overlap);
      expect(r.flow.viewer.overlapPairPolls, "pairs on screen").toBeLessThanOrEqual(w.budget.onScreen);
    });
  });
}
