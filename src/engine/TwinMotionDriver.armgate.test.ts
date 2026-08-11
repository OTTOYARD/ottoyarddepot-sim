// ============================================================================
// THE DEPART GATE AT SCALE — the busy_day fixture, replayed with the arms live.
//
// WHY THIS FILE EXISTS SEPARATELY FROM TwinMotionDriver.fixture.test.ts.
// The committed fixture replay publishes `legs: []` and `stalls_status: []`, so
// no service window ever reaches a car, no OTTO-CHARGE ARM ever mates, and the
// depart gate is INERT for the whole run. Its headline numbers are byte-identical
// with the gate and with the gate stubbed out (measured both ways: 116 / 70 / 0
// on origin/main, and again after the turning work at 86 / 41 / 7) — which proves
// the gate costs nothing when no arm is engaged, and proves NOTHING AT ALL about
// the gate itself. A guard that is silently inert looks exactly like a guard that
// works.
//
// So this replays the same 116-vehicle capture with a DWELL LEG attached to
// every charging vehicle — the one thing on the wire that publishes a service
// window — and the arms mate for real: 9 of the 10 DCFC stalls hold a car at
// once, and the gate refuses hundreds of launches.
//
// WHAT IT COSTS, MEASURED IN THIS TREE, BOTH SIDES, same harness, gate ON vs
// armReleases() stubbed to a constant true:
//
//                        gate OFF     gate ON
//   overlapPairSamples         80          90      +10
//   distinctOverlapPairs       39          41       +2
//   stuckSamples                5          10       +5
//
// Holding a car ~11.5 sim-seconds for its demate re-phases when it reaches
// staging, and this harness makes every arm step in LOCKSTEP — the replay jumps
// the sim clock 30 s per frame and the reducer takes at most one phase per call,
// so nine arms clear together and nine cars launch together in a way a continuous
// clock would not produce. That is the cost, stated rather than explained away.
//
// THE EARLIER READING OF THIS TABLE WAS WRONG AND IS CORRECTED HERE. Before the
// turning work landed in the same branch, the same comparison measured 120 -> 137
// overlap and 4 -> 0 stuck, and the note claimed the gate REMOVED wedged cars.
// It does not; that 4 -> 0 belonged to the motion changes, not to the gate. With
// the turning work in, the gate's own effect on wedging is +5, not −4. A number
// that flips sign when something else changes was never the gate's number.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import fixture from "./__fixtures__/twinRun.busyday.json";
import { bodiesOverlap } from "./__fixtures__/replay";
import { twinMotionDriver } from "./TwinMotionDriver";
import { poseStore } from "./motion/poseStore";
import { useDepotStore } from "@/store/depotStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";

const F = fixture as unknown as {
  runId: string;
  stalls: { id: string; code: string; type: string }[];
  roster: { id: string; av_id: string; make: string; platform: string; soc: number }[];
  frames: { t: string; changes: { id: string; state: string; stall_id: string | null }[] }[];
};

type Internals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number };
    tracker: { stationaryFor: number } | null;
    dwellStartMs: number | null;
  }>;
};

interface Report {
  samples: number;
  overlapPairSamples: number;
  distinctOverlapPairs: number;
  stuckSamples: number;
  maxSimultaneousArmHolds: number;
  refusals: number;
}

function replayWithLiveArms(): Report {
  twinMotionDriver.clear();
  useDepotStore.setState({
    stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
  });
  twinMotionDriver.setTwinStallMap(F.stalls);

  const states = new Map<string, { id: string; state: string; stall_id: string | null }>();
  const pairs = new Set<string>();
  let samples = 0, overlapPairSamples = 0, stuckSamples = 0, maxHolds = 0;

  for (const f of F.frames) {
    for (const c of f.changes) states.set(c.id, c);

    // The commit-and-hold dwell floor is 12 REAL seconds, and a replay compresses
    // the whole run into about one real second — so without this every docked car
    // sits out the entire fixture, nothing ever leaves a charger, and the gate is
    // never asked a question. (Measured: 0 refusals with the floor intact.) Ageing
    // the dwell clocks is what makes the run flow, and it is the only way this
    // harness can exercise the thing it is here to exercise.
    for (const [, e] of (twinMotionDriver as unknown as Internals).entries) {
      if (e.dwellStartMs != null) e.dwellStartMs -= 13000;
    }

    const vehicles = F.roster.filter((r) => states.has(r.id)).map((r) => {
      const s = states.get(r.id)!;
      return {
        id: r.id, av_id: r.av_id, make: r.make, platform: r.platform,
        state: s.state, soc: r.soc, stall_id: s.stall_id,
      };
    });
    const clock = Date.parse(f.t);
    // A DWELL leg per charging car — the service window the arms need. Nothing
    // else about the capture is altered.
    const legs = vehicles
      .filter((v) => v.state === "charging_dcfc" || v.state === "charging_l2")
      .map((v, i) => ({
        leg_id: `L${i}`, vehicle_id: v.id, seq: 1,
        leg_type: "charge_dcfc", intent: null, kind: "charge_curve",
        from_stall: null, to_stall: null,
        from_x: null, from_y: null, to_x: null, to_y: null,
        start_sim: new Date(clock).toISOString(),
        end_sim: new Date(clock + 1_800_000).toISOString(),
        duration_s: 1800, status: "active", geometry: "measured",
      }));

    twinMotionDriver.reconcile({
      run: {
        sim_run_id: F.runId, scenario: "busy_day", status: "running",
        sim_clock: f.t, tick_count: 1, time_scale: 1, seed: 1, speed_x: 1,
      },
      legs,
      fleet: { counts: {}, total: vehicles.length, vehicles },
      stalls_status: [], energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot);

    // same cadence as the committed fixture replay: 30 s of motion per frame,
    // geometry sampled every 2 s so a transient pile-up cannot hide between them
    for (let k = 0; k < 15; k++) {
      for (let i = 0; i < 40; i++) twinMotionDriver.tickMotion(0.05);

      const entries = (twinMotionDriver as unknown as Internals).entries;
      const bodies: { id: string; x: number; y: number; h: number; moving: boolean }[] = [];
      for (const [id, e] of entries) {
        const p = poseStore.get(id) ?? { x: e.car.x, y: e.car.y, heading: e.car.heading };
        bodies.push({ id, x: p.x, y: p.y, h: p.heading, moving: !!e.tracker });
        if (e.tracker && e.tracker.stationaryFor > 10) stuckSamples++;
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          if (!bodiesOverlap(bodies[i], bodies[j])) continue;
          overlapPairSamples++;
          const [a, b] = [bodies[i].id, bodies[j].id].sort();
          pairs.add(`${a}|${b}`);
        }
      }
      maxHolds = Math.max(maxHolds, twinMotionDriver.armHolds.length);
      samples++;
    }
  }

  return {
    samples,
    overlapPairSamples,
    distinctOverlapPairs: pairs.size,
    stuckSamples,
    maxSimultaneousArmHolds: maxHolds,
    refusals: twinMotionDriver.armHoldRefusals,
  };
}

describe("depart gate — busy_day replay with the OTTO-CHARGE ARMS live", () => {
  // Replayed in beforeAll, not at module scope, so the work sits UNDER an
  // explicit timeout. It runs in ~0.7 s locally; CI is a shared ubuntu runner and
  // >12x slower on compute, so the ceiling below is ~150x the local cost rather
  // than a number close to it.
  let r: Report;
  beforeAll(() => { r = replayWithLiveArms(); }, 120_000);

  it("DIAGNOSTIC: dump the numbers", () => {
    console.log(
      `\nARM-GATE REPLAY  samples=${r.samples}` +
        `  overlapPairSamples=${r.overlapPairSamples}` +
        `  distinctOverlapPairs=${r.distinctOverlapPairs}` +
        `  stuckSamples=${r.stuckSamples}` +
        `  maxSimultaneousArmHolds=${r.maxSimultaneousArmHolds}` +
        `  gateRefusals=${r.refusals}\n`,
    );
    expect(r.samples).toBe(465);
  });

  it("THE GATE IS ACTUALLY ENGAGED — this run is not silently inert", () => {
    // Without this the ratchets below would still pass with the gate deleted.
    expect(r.maxSimultaneousArmHolds).toBeGreaterThanOrEqual(8);
    expect(r.refusals).toBeGreaterThan(100);
  });

  it("THE HOLD NEVER DEADLOCKS A CAR — wedging stays at queue scale", () => {
    // The assertion that matters most: a gate that can freeze a car is worse than
    // no gate. Measured 10 with the gate on, 5 with it off, out of 465 samples of
    // a 116-vehicle run — so the gate is worth 5 samples of extra queueing, and
    // nothing in the run wedges. It is NOT asserted at 0: that would be asserting
    // a property of the motion stack, not of this gate, and it was 5 without it.
    // The armGate's own HOLD_CAP_S is what makes an actual deadlock impossible.
    expect(r.stuckSamples).toBeLessThanOrEqual(15);
  });

  it("RATCHET: the hold's re-phasing cost stays where it was measured", () => {
    // 90 / 41 in this tree (80 / 39 with the gate stubbed off, same harness).
    // Pinned just above, to stop the number creeping — not as a target.
    expect(r.overlapPairSamples).toBeLessThanOrEqual(100);
    expect(r.distinctOverlapPairs).toBeLessThanOrEqual(48);
  });
});
