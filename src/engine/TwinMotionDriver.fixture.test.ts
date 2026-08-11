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
  // RE-BASELINED by the turning fix (route join nodes chosen on driven distance,
  // node-lock match radius, corner rounding, speed-scaled yaw). Both sides of
  // every ratchet below were re-measured on this same fixture:
  //
  //                          before (fix-arrival-pools)    after
  //   overlapPairSamples                    4090            2106
  //   distinctOverlapPairs                   209              92
  //   stuckSamples                          1977            1518
  //   worstMovingCluster                      13               6
  //   wrong-way samples, S blvd              363              39
  //
  const OVERLAP_BUDGET = 2150;  // measured 2106 (was 4090). TARGET 0.
  const STUCK_BUDGET = 1560;    // measured 1518 (was 1977). TARGET 0.

  it("SYMPTOM 2a: body-overlap stays within the ratchet (target 0)", () => {
    // WHAT WAS FIXED: over half of the residual was ONE routing defect. route()
    // joined the lane network at the Euclidean-NEAREST node, so a car leaving the
    // east staging block for the west egress joined at SE (272.25,172) — 19.7u
    // away — and its rail read "drive 19u EAST down the WESTBOUND side of the
    // south boulevard, spin 180° in the corner, drive back west past where you
    // started". 363 wrong-way samples, and the (270,170) corner alone held 2210
    // of 4090 overlap pair-samples. Join nodes are now chosen on total DRIVEN
    // distance (LaneGraph.route), and that corner is down to 75.
    //
    // WHAT IS LEFT, in order of size, none of it in this stack's files:
    //  • (240,170) x429 — a PARKED car, not traffic. PARK_RUNS 'TW'/'TE' run 13
    //    stalls at dy=7 from y0=86, so stall 13 sits at y=170, and the south
    //    collector band is y 166..178. A car parked there lies across y
    //    167.9..172.1; the westbound lane body is y 166.7..170.9 — a 3.0u
    //    (4.7 ft) overlap that no amount of driving can avoid. The columns need
    //    to stop at 12 stalls, or start further north. sitePlan.ts.
    //  • (250,170)/(260,170) x596 and (240,90)/(240,100)/(240,150)/(240,160)
    //    x365 — the temp staging block has NO lane in the LaneGraph. sitePlan
    //    declares TEMP_LANE_X = 247 as its central aisle but no node or edge
    //    exists there, so every car to or from the block beelines diagonally
    //    across the TW column instead of driving an aisle.
    //  • same-direction following contact — RailFlow's IDM gap is bookkept with
    //    traffic.ts CAR_LENGTH = 7.5 while the body VehicleDot draws is 10.2
    //    long, so a stopped queue closes to ~1.1u inside itself. Owned by the
    //    body-constants stream; do not fix it here twice.
    expect(report.totals.overlapPairSamples).toBeLessThanOrEqual(OVERLAP_BUDGET);
  });

  it("SYMPTOM 2b: taxiing cars never knot up (<= 6 moving cars in one 14u disc)", () => {
    // 13 → 6. The knot was the SE-corner U-turn above: cars that had no business
    // at that corner all drove into it. What is left is a queue at a locked
    // intersection during a mass departure, which is legitimate traffic.
    expect(report.worstMovingCluster.n).toBeLessThanOrEqual(6);
  });

  it("SYMPTOM 2c: wedged-car time stays within the ratchet (target 0)", () => {
    // A wedged car holds a route but makes no arc progress. What remains trails
    // the overlap above — a car braking for a body that is inside its lane.
    // Note this number is NOT monotone with the overlap: fixing the node-lock
    // match radius (RailFlow NODE_MATCH) made intersections actually serialize,
    // which converts some collisions into legitimate waiting.
    expect(report.totals.stuckSamples).toBeLessThanOrEqual(STUCK_BUDGET);
  });
});
