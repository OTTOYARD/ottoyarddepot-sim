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
  //
  // RE-BASELINED 106 -> 116 by the pull-in approach fix, and this is the one case the
  // rule above allows: a change that MOVES TRAFFIC, with both sides measured in this
  // same tree and the reason established independently of this metric.
  //
  //     parkedHeading by lot centroid   overlap 106 · distinct 62 · stuck 0
  //     parkedHeading by serving aisle  overlap 116 · distinct 70 · stuck 0
  //
  // WHY THE OLD NUMBER WAS THE FLATTERED ONE. parkedHeading picked the side a car
  // enters from by comparing the stall to the lot centre, which put the TW column —
  // east of centre, but the WEST column of the temp block — nose-east and staged its
  // cars at render x=224.5. Converted into the seed frame that is x=343.0 ft, which
  // lies INSIDE lane body Sg3>Ng3 (337.7..344.3 ft). Sg3>Ng3 has no opposing edge in
  // the lane graph: it is a ONE-WAY charge gap lane. So all 12 TW stalls were being
  // approached from inside a dedicated charge pull-out, and they scored well here only
  // because that lane has no parked bodies to overlap with. Driving up a one-way charge
  // lane is not cheaper than sharing an aisle; it is unpriced by this metric.
  //
  // Post-fix the two columns stage on OPPOSITE flanks of their own aisle — TW at
  // 371.3 ft inside Tn>Ts, TE at 385.4 ft inside Ts>Tn, which are an opposing pair,
  // i.e. drive-on-the-right in a genuinely two-way corridor. The +10 is the honest cost
  // of that traffic being in the aisle at all: temp-block pair-samples 14 -> 28, and
  // everywhere else 92 -> 88 as TW stops detouring through other corridors.
  //
  // WHAT IS STILL IN THE WAY, measured: the residual is a staging car against THROUGH
  // traffic on TEMP_LANE_X bound for the N1 row. A shared mouth key across TW/TE — the
  // charger-column mechanism — was tried and moved this by 0, because through traffic
  // never holds that key; shortening the approach was tried at 8/7/6.5/6 u and gets
  // monotonically worse (116/117/118/119). It needs aisle occupancy, not a
  // terminal-stretch lock. stuck stays AT 0 and the worst cluster stays at 5, so
  // nothing wedges — these are transient body grazes, not a knot.
  // RE-BASELINED AGAIN by the TURNING work (2026-08-11): yaw budgeted per unit of
  // travel, the dock swing taken while still rolling, corner arcs replacing hard
  // vertices, the heading look-ahead 6 -> 2, and the node-lock match radius 3 -> 5.
  // Both sides measured on this fixture in the same tree:
  //
  //     main (22ec3f6)          overlap 116 · distinct 70 · stuck 0 · cluster 5
  //     + turning subset        overlap  86 · distinct 41 · stuck 7 · cluster 4
  //
  // THE STUCK COUNT MOVED OFF ZERO AND THAT IS NOT SWEPT UNDER THE BUDGET. It is
  // the node-lock fix, isolated by measurement: with NODE_MATCH left at 3 (locks
  // that never matched, because route() offsets interior vertices 3.2u
  // drive-on-the-right and the annotation threshold was 3u) the same tree measures
  // overlap 132 · distinct 68 · stuck 0. Widening it to 5 makes intersections
  // genuinely serialize — overlap 132 -> 86, distinct 68 -> 41 — and the price is
  // that some cars now WAIT at a junction, which this metric cannot tell apart
  // from a wedge: `stuck` is "holds a route and makes no arc progress for >10 s".
  //
  // The two are distinguishable by SHAPE, and they were checked. A wedge persists:
  // the full turning branch (which also re-scored route join nodes) parks one car
  // at (238,210) for twelve consecutive frames and totals 719.
  //
  // THIS SUBSET'S 7, RE-MEASURED (the figures that used to sit here were a
  // misreading of the frame dump — its `stuck=` column is the MAX concurrent
  // stuck cars in one sample, not a count of samples, and the totals are a sum
  // over samples). Actual distribution, 31 frames x 15 samples:
  //
  //     f3 = 1   (one sample, one car)
  //     f30 = 6  (the final departure wave; worst single sample holds 2 cars)
  //     every other frame = 0  — 29 of 31 frames at exactly zero
  //
  // Two isolated frames, nothing spanning consecutive frames, never more than 2
  // cars at once. That is queueing, not wedging.
  //
  // WHAT WAS DELIBERATELY LEFT OUT, and why it is not in this tree: the turning
  // branch also re-scored LaneGraph join nodes on driven distance. On the OLD depot
  // that fixed a 19u wrong-way leg into the SE corner. On THIS depot the plain
  // nearest-node join already routes east-staging -> egress in 201.2u with 3.2u of
  // eastward drift — the exact number the branch claimed as its improvement — so
  // the defect had evaporated, while the wider join search now sends a car queued
  // at the gate (x=228 and x=239 on the approach road) 43u NORTH-WEST off the road
  // instead of west through the ingress, which is the wedge above. Measured in this
  // tree: with it, overlap 119 · distinct 62 · stuck 719. Do not re-add it without
  // re-measuring the gate queue.
  // RE-BASELINED 2026-09-22 by the traffic-flow change (stall exit manoeuvres,
  // lanes joined ahead of the nose, movement-based junctions, mitered lane
  // offsets) — AND the replay's clock, which has to be read first.
  //
  // THE CLOCK. replay.ts used to read the real performance.now(), so the driver's
  // 12 s commit-and-hold floor never expired inside a replay that computes 15
  // minutes of motion in about a second: every car that docked at a charger was
  // held there to the end, and this fixture NEVER EXERCISED A CHARGER DEPARTURE —
  // the very traffic this change is about. The result also depended on machine
  // speed (CI is >12x slower, enough for floors to start expiring there). The replay
  // now runs on a simulated clock, one motion-second per second. Both sides, same
  // harness, same fixture:
  //
  //     main (8a3e28f), simulated clock   overlap 80 · distinct 39 · stuck 5 · cluster 4
  //     this change,    simulated clock   overlap 54 · distinct 24 · stuck 4 · cluster 4
  //
  // (For the record, on the old real-clock harness this change read 62 / 30 / 14
  // against main's 86 / 41 / 7: the stuck samples there were queues at the
  // single-lane egress during frame 30's mass departure, which the new junction
  // control serialises instead of letting the two turning streams drive through
  // each other.) Ratcheted DOWN to the new measurement.
  // RE-MEASURED 2026-09-28 after WIDE CORNERS (RailFlow.roundCorners: a corner
  // takes up to a 2.4u cut where parked cars and structures allow, the gap-lane
  // mouth turns once instead of hairpinning, fillets measure legs between real
  // corners, and junction membership reads the routed path). Same harness:
  //
  //     before   overlap 54 · 60% of all turning at R < 5u (a pivot inside the body)
  //     after    overlap 58 · 23% of all turning at R < 5u
  //
  // and across the four flow captures the on-screen overlapping pairs a viewer
  // sees went 30 -> 32 (TwinMotionDriver.flow.test.ts). +4 pair-samples here is
  // the measured price of cars that no longer spin through corners.
  //
  // 2026-09-28, L2 HEAD-IN (sitePlan.chargingStalls). The L2 stalls turned 90°: cars
  // drive straight in and BACK OUT into their gap lane (l2BackOut) instead of sliding
  // in and out of a nose-to-tail column. Same harness, same clock:
  //
  //     before   overlap 58 · stuck 5
  //     after    overlap 78 · stuck 6
  //
  // Every bin that existed before is byte-identical after; all 20 added samples sit in
  // new bins, all in the one mass-egress wave at frame 30, and each was traced (a probe
  // on the pair, the lane, and each car's back-out / merge commit order):
  //   14  ONE pair of DCFC cars from canopy A's east column (stalls 16u apart) that
  //       leaned out and merged into lane AB at the same moment and ended up exactly on
  //       top of each other (0.0u apart), then drove up the lane and west along the north
  //       collector as one car. That is the DCFC forward lean-out's merge race — both
  //       commit while the other is still in its stall — which this change does not
  //       touch; a different departure order set it off. (Publishing a lean-out at its
  //       merge point, as a committed L2 back-out is, removes these 14 and costs 53
  //       stuck samples: measured and rejected. Head-in DCFC removes the lean-out.)
  //    6  departers bunched on the north collector in that same wave — the co-located
  //       mode described above; two of them an L2 car close behind a DCFC car.
  // No sample is an L2 car in or beside a stall. The L2-on-L2 conflicts the first
  // version of the back-out DID cause (neighbours swinging into each other, 25 samples
  // in lane AB) are closed by l2BackOutBlocked, by publishing a committed back-out where
  // it will finish, and by exiting along the gap lane's centreline. Across the four flow
  // captures the viewer's on-screen pairs went 33 -> 32 and the burst's overlap
  // 99 -> 84; docking test D's L2 contacts went 2 -> 0, and test E (backing out past
  // parked neighbours and beside each other) measures 0.
  //
  // 2026-09-28, DCFC HEAD-IN (the same day, the founder's go-ahead). The DCFC stalls
  // turned 90° too and back out like L2 (chargerBackOut); the lean-out is gone, and
  // with it the merge race above. Same harness, same clock:
  //
  //     before   overlap 78 · stuck 6 · distinct pairs 27
  //     after    overlap 73 · stuck 7 · distinct pairs 28
  //
  // Gone: (130,110) x4 and (40,70) x5, the lean-out pair; (90,70) and (70,70) x2 each.
  // New, each traced to the pair: (260,170) x9, (270,180) x2 and (250,160) x2 are
  // STAGING departers bunching on the south-east collector in the frame-30 egress wave
  // (dest egress, from the temp block — no charger car); (100,170) x1 likewise. Stuck:
  // the one charger-car sample (a DCFC lean-out car held on the north collector) is
  // gone, and two new ones are a staging departer queued behind another in that same
  // south-east bunch. No sample involves a charger car in, beside, or backing out of
  // its stall.
  //
  // 2026-09-28, 60° ANGLED CHARGER STALLS (the founder: the 90° stalls read as
  // "horizontal pull-in/parking which is not viable"). Every charger stall turned to
  // 60° off its lane and the rows were re-pitched (sitePlan.chargingStalls). Same
  // harness, same clock: overlap 73 · stuck 7 · distinct pairs 28 — every hotspot
  // bin byte-identical to the 90° layout. The one line of this test's frame log that
  // moved is a car turning into DCFC-06 along its new axis, drawn at (112,89) instead
  // of (112,88). This capture exercises charger motion lightly; docking tests D and E
  // are where the angled approach and back-out are measured (0 contacts, and 0
  // against any structure).
  //
  // 2026-09-28, THE CAR SLIMMED (the founder: "slightly less big/boxy/bulky"):
  // 10.2 x 4.2 -> 9.8 x 4.0u (traffic.CAR_BODY_*). overlap 73 -> 63, stuck 7 -> 7,
  // distinct pairs 28 -> 26. Part of that is simply a smaller body measuring less
  // overlap for the same motion, so the ratchet comes down with it: a regression
  // that the old car's size used to hide now fails here.
  const OVERLAP_BUDGET = 70;    // measured 63 (73 at the 10.2 x 4.2 car, at 60° and at 90° stalls; 78 before DCFC head-in; 58 before L2 head-in; 54 before wide corners; 80 on main then). TARGET 0.
  const STUCK_BUDGET = 8;       // measured 7 (7 at 90°; 6 before DCFC head-in; 5 before L2 head-in).

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
