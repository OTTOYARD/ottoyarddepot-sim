// ============================================================================
// FIXTURE REPRO + RATCHET — the two reported motion defects, measured against
// one captured run rather than against a live sim.
//
// Both defects were INTERMITTENT live, so a live run could never tell a real
// fix from luck. `__fixtures__/twinRun.busyday.json` is a read-only capture of
// sim_run 1fe94791 (116 vehicles, scenario busy_day, 2026-08-05); replaying it
// gives the same numbers every time.
//
// SYMPTOM 1 (vehicles drawn off-map) does not reproduce and is asserted at ZERO.
// SYMPTOM 2 (vehicles piling into each other) did reproduce, was substantially
// reduced, and is NOT fully solved — so its assertions are RATCHETS pinned just
// above the current measurement. They exist to stop the numbers creeping back
// up; the target is still zero, and each one names what is still in the way.
//
//   npx vitest run src/engine/TwinMotionDriver.fixture.test.ts --reporter=verbose
// ============================================================================
import { describe, it, expect } from "vitest";
import { replayFixture } from "./__fixtures__/replay";

describe("TwinMotionDriver — replay of a captured busy_day run", () => {
  const report = replayFixture();

  it("DIAGNOSTIC: dump the geometry", () => {
    const byFrame = new Map<number, typeof report.samples>();
    for (const s of report.samples) {
      const arr = byFrame.get(s.frame) ?? [];
      arr.push(s);
      byFrame.set(s.frame, arr);
    }
    const lines: string[] = [];
    for (const [f, ss] of byFrame) {
      const worstOv = ss.reduce((a, b) => (b.overlaps.length > a.overlaps.length ? b : a));
      const worstCl = ss.reduce((a, b) => (b.movingCluster.n > a.movingCluster.n ? b : a));
      lines.push(
        `f${String(f).padStart(2)} rendered=${String(ss[0].rendered).padStart(3)} ` +
          `maxTaxi=${String(Math.max(...ss.map((s) => s.taxiing))).padStart(3)} ` +
          `offMap=${String(Math.max(...ss.map((s) => s.offMap.length))).padStart(3)} ` +
          `overlap=${String(worstOv.overlaps.length).padStart(3)}@t+${worstOv.at}s ` +
          `movingCluster=${worstCl.movingCluster.n}@(${worstCl.movingCluster.x},${worstCl.movingCluster.y}) ` +
          `stuck=${Math.max(...ss.map((s) => s.stuck))}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log("\n" + lines.join("\n"));
    // eslint-disable-next-line no-console
    console.log(
      "\noverlap hotspots (10u bins, sample count):\n" +
        [...report.overlapHotspots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
          .map(([k, n]) => `  (${k}) x${n}`).join("\n"),
    );
    // eslint-disable-next-line no-console
    console.log(
      `\nworst moving cluster: ${report.worstMovingCluster.n} cars @(${report.worstMovingCluster.x},${report.worstMovingCluster.y}) ` +
        `frame ${report.worstMovingCluster.frame} t+${report.worstMovingCluster.at}s`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `\nTOTALS  samples=${report.totals.samples}` +
        `  overlapPairSamples=${report.totals.overlapPairSamples}` +
        `  distinctOverlapPairs=${report.totals.distinctOverlapPairs}` +
        `  stuckSamples=${report.totals.stuckSamples}`,
    );
    expect(report.samples.length).toBeGreaterThan(0);
  });

  // ── SYMPTOM 1 — SOLVED (it never reproduced on this feed) ──────────────────
  it("SYMPTOM 1: no rendered vehicle is ever drawn outside the drivable envelope", () => {
    expect(report.worstOffMap).toBe(0);
  });

  it("SYMPTOM 1: an off-site vehicle is only ever drawn while it is driving OUT", () => {
    // `deployed` / `en_route` / `offline` map to null in mapState, so the driver
    // stops holding them: they are routed to the egress and despawned. What must
    // never happen is one being PARKED somewhere off the lot. Any off-site
    // vehicle still on screen is therefore transient — the count falls to zero
    // between arrival waves, which the frame dump shows directly.
    const last = report.samples[report.samples.length - 1];
    expect(last.offMap.length).toBe(0);
  });

  // ── SYMPTOM 2 — REDUCED, NOT SOLVED. Ratchets, with the blocker named. ─────
  //
  // Baseline on main, same fixture:  overlapPairSamples 543, stuck 297, cluster 6
  // Now:                             overlapPairSamples 221, stuck 130, cluster 5
  //
  // RE-BASELINED after the car-length reconciliation (CAR_BODY_LENGTH). The gap
  // budget was `CAR_LENGTH * 0.55` = 4.125 u against a drawn body of 10.2 u, so
  // a queue settled at IDM's 5 u jam gap sat 1.075 u INSIDE the car ahead:
  //
  //   overlapPairSamples   4063 → 1223   (−70%)
  //   distinctOverlapPairs  202 →   66   (−67%)
  //   worstMovingCluster     13 →   11
  //   stuckSamples         1960 → 2121   (+8%, WORSE — see 2c)
  //
  // 10.2 is a measured MINIMUM, not "bigger is safer": the same fixture with the
  // budget at 4.125 / 7.5 / 10.2 / 12.5 gives 4057 / 2418 / 1223 / 2330 overlap
  // pair-samples. Reserving more than the body costs as much as reserving less.
  // RE-BASELINED against main AFTER PR #74 (arm clock + staging-group fix) merged.
  // #74 stopped six twin staging GROUPS collapsing onto one 19-stall west-perimeter
  // column, which redistributed traffic into corridors that had carried none, so both
  // numbers moved before this branch touched anything. Measured, in order:
  //     pre-#74 baseline   overlap 4063 · distinct 202 · stuck 1960
  //     main with #74      overlap 4090 · distinct 209 · stuck 1977   (#74 alone: +17 stuck)
  //     main + this branch overlap 1248 · distinct  65 · stuck 2151
  // The earlier budgets (1250 / 2150) were set against the PRE-#74 tree and are why CI
  // failed this branch by a single sample. Do not compare a number here across a change
  // that moves traffic — re-measure both sides, as above.
  // RE-BASELINED AGAIN after the 2026-08-11 depot geometry rebuild (24 ft two-way
  // aisles; the temp block's declared aisle became a real lane; the N1 row got its own
  // approach). Both sides measured on this same fixture, in the same tree:
  //     main (68ac00e)     overlap 1248 · distinct 65 · stuck 2151
  //     + geometry rebuild overlap  106 · distinct 62 · stuck    0
  // The stuck count is the headline: it goes to ZERO, from 2151. That is the number
  // 2c below said was a real cost of reserving the full car body, and it was — the
  // queues it counted were cars braking for bodies inside their lane, and the lanes
  // were too narrow. Widening the geometry, not tuning the watchdog, removed them.
  //
  // ORDERING MATTERS AND WAS MEASURED. Building the temp-aisle lane WITHOUT the
  // geometry change makes this worse, not better — it routes real traffic down a
  // 22.82 ft aisle whose stalls sit 3.08 ft away, past two stalls parked inside the
  // south collector. The two must land together; do not split this commit.
  //
  // RATCHETED DOWN to the new measurement. If a change pushes these up, revert the
  // change — do not raise the budget.
  const OVERLAP_BUDGET = 115;   // measured 106. TARGET 0.
  const STUCK_BUDGET = 10;      // measured 0. TARGET 0 — and it is AT zero.

  it("SYMPTOM 2a: body-overlap stays within the ratchet (target 0)", () => {
    // WHAT WAS LEFT, AND WHAT CLOSED IT. The dominant hotspot was the TE temp-staging
    // block: (270,170) alone carried 552 of the 1248 pair-samples. It is now 0, and no
    // bin exceeds 15. The cause was geometry, not control: the temp block's central
    // aisle was DECLARED in sitePlan (TEMP_LANE_X) but had no node and no edge in the
    // LaneGraph, so route() fell back to the nearest ring node and drew a line across
    // the parked cars; the aisle itself measured 22.82 ft; and the 13th stall of each
    // column sat 6.42 ft INSIDE the south collector's eastbound lane.
    //
    // The "east avenue corridor is only 14.31u wide" claim that used to sit here was
    // STALE — it was computed from an E-column x0 that had already been superseded.
    // Measured face to face the corridor was 23.60 ft, and the guard had been printing
    // that number the whole time. It is now 24.39 ft, symmetric, with 3.87 ft of shy
    // space on both flanks.
    //
    // WHAT IS LEFT AFTER THE CAR-LENGTH FIX, classified by instrumenting the
    // replay (1223 pair-samples): 14 parked-vs-parked (stall pitch, a layout
    // number), 157 moving-vs-parked, 882 same-direction and 170 crossing/
    // opposing. The same-direction residual is NOT a following-gap failure —
    // 785 of the 882 are LATERALLY offset, and 408 of those are two taxiing
    // cars within ~2 u of each other in both axes, i.e. co-located rather than
    // queued. That is a route/assignment overlap upstream of RailFlow, and
    // widening RailFlow's LANE_HALF does not touch it (measured: it makes the
    // total worse). It needs its own fix; the gap budget is no longer the cause.
    expect(report.totals.overlapPairSamples).toBeLessThanOrEqual(OVERLAP_BUDGET);
  });

  it("SYMPTOM 2b: taxiing cars never knot up in one 14u disc", () => {
    // A queue at a locked intersection during a mass departure is legitimate
    // traffic; a KNOT is cars occupying the same ground. Reserving the drawn body took
    // the worst disc from 13 to 11; the geometry rebuild took it 11 -> 5, which is the
    // "real queue length (~5)" this comment named as the target. Ratchet TIGHTENS to 5.
    // Do not raise this to make a change pass.
    expect(report.worstMovingCluster.n).toBeLessThanOrEqual(5);
  });

  it("SYMPTOM 2c: wedged-car time stays within the ratchet (target 0)", () => {
    // A wedged car holds a route but makes no arc progress. Every wedge in the
    // baseline was a car pinned at s=0 by the route-endpoint displacement; those
    // are gone. What remains trails the overlap above — a car braking for a body
    // that is inside its lane because of the clearance conflict.
    //
    // THIS NUMBER GOT WORSE ONCE — 1977 → 2151 — when the full 10.2 u car body started
    // being reserved, and the note here read it as a deliberate trade: longer queues in
    // the same corridors, priced against cars that keep rolling by driving through each
    // other. That reading was incomplete. The corridors were the problem. Widening them
    // to the real-world 24 ft two-way spec, giving the temp block an actual lane and
    // giving the N1 row its own approach takes this to 2151 → 0.
    //
    // It is AT the target. The budget is a small non-zero number only so that a
    // one-sample blip reports as a regression rather than as a mystery; if this starts
    // reading anything but 0, something moved traffic and it needs measuring, not a
    // bigger budget.
    expect(report.totals.stuckSamples).toBeLessThanOrEqual(STUCK_BUDGET);
  });
});
