// ============================================================================
// THE ROBOTS ON CANOPIES B AND C WORK, END TO END, ON THE LAYOUT THE TWIN SERVES.
//
// TwinMotionDriver.cleanarm.test.ts plays one cabin clean on DCFC-01 (canopy A) in the
// as-built depot. This plays the same cycle on the posts 0759 and 0763 added, one per
// stall column of canopies B and C, with the driver mapped from the twin depot's layout
// as the twin served it on 2026-11-02 (__fixtures__/twinLayout.served1102.json: 30 fast
// chargers, no standard charger). Each post must run the cycle in Chase's order
// (2026-10-19), as canopy A's does:
//
//   the doors open -> the charge arm mates -> the cleaning arm cleans one side, then the
//   other, and comes out -> the doors close -> the charge completes -> the charge arm
//   retracts -> the car moves on.
//
// West-column posts (bearing 60) and east-column posts (300) put the charge port on
// opposite flanks of the car, so both columns are played on both canopies.
// ============================================================================
import { describe, it, expect, afterAll } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { doorStore } from "./motion/doorStore";
import { useDepotStore } from "@/store/depotStore";
import { chargerBuild, setChargerBuild } from "@/lib/chargerBuild";
import { CANOPIES } from "@/lib/sitePlan";
import { CLEAN_CHAIN } from "@/lib/ottoCleanArm/cleanArmSpec";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import served from "./__fixtures__/twinLayout.served1102.json";

type Internals = {
  entries: Map<string, {
    tracker: unknown | null;
    reverse: unknown | null;
    stallId: string | null;
    dwellStartMs: number | null;
  }>;
};

const VEHICLE = "veh-cabin-30";
const T0 = Date.parse("2026-11-02T20:00:00.000Z");   // 2:00 PM CT
const CYCLE_S = 348;                                  // 2 x 2.5 min + 0.8 min (0758's defaults)

afterAll(() => {
  twinMotionDriver.clear();
  setChargerBuild("as_built");
  useDepotStore.getState().regenerateStalls(10, 30, 3, 115, 2);
});

const entry = () => (twinMotionDriver as unknown as Internals).entries.get(VEHICLE);

/** The twin id of a served fast charger, by its number. */
const twinIdOf = (n: number) => {
  const s = served.stalls.find((x) => x.code === `NASH-DCFC-STALL-${String(n).padStart(2, "0")}`);
  if (!s) throw new Error(`no served stall ${n}`);
  return s.id;
};

function snap(twinStall: string, atMs: number, state = "charging_dcfc"): TwinSnapshot {
  return {
    run: {
      sim_run_id: "cabin-arm-30", scenario: "busy_day", status: "running",
      sim_clock: new Date(atMs).toISOString(), tick_count: 1, time_scale: 1, seed: 1, speed_x: 1,
    },
    legs: [{
      leg_id: "L1", vehicle_id: VEHICLE, seq: 1, leg_type: "charge_dcfc", intent: null, kind: "charge_curve",
      from_stall: null, to_stall: twinStall, from_x: null, from_y: null, to_x: null, to_y: null,
      start_sim: new Date(T0).toISOString(), end_sim: new Date(T0 + 1_800_000).toISOString(),
      duration_s: 1800, status: "active", geometry: "measured",
    }],
    fleet: {
      counts: {}, total: 1,
      vehicles: [{
        // a car the twin does not name: the generic program (see TwinMotionDriver.cleanarm.test.ts)
        id: VEHICLE, av_id: "AV-30", make: "Acme", platform: "robotaxi",
        state, soc: 42, stall_id: twinStall,
        visit: {
          visit_id: "visit-30", visit_status: "in_progress", archetype: null, urgency: null,
          arrived_at: new Date(T0).toISOString(), target_soc: 100, soc_at_arrival: 38, est_charge_min: 24,
          atoms: [
            { svc: "charge", status: "in_progress", must_do: true, est_min: 24 },
            {
              svc: "interior_tidy", status: "in_progress", must_do: true, est_min: 5,
              started_at: new Date(T0).toISOString(), ends_at: new Date(T0 + CYCLE_S * 1000).toISOString(),
              done_at: null, robot_stall_id: twinStall,
            },
          ],
        },
      }],
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

interface Sample { t: number; clean: string; arm: string | null; doors: number; moving: boolean }

/** Poll on a sim clock advancing 250 ms a poll, as the live bridge does. */
function play(twinStall: string, renderStall: string, seconds: number, stateAt: (t: number) => string): Sample[] {
  const trace: Sample[] = [];
  for (let t = T0 + 250; t <= T0 + seconds * 1000; t += 250) {
    const e = entry();
    // the commit-and-hold dwell floor is 12 REAL seconds; this test runs in milliseconds
    if (e && e.dwellStartMs != null) e.dwellStartMs -= 13_000;
    twinMotionDriver.reconcile(snap(twinStall, t, stateAt((t - T0) / 1000)));
    for (let k = 0; k < 2; k++) twinMotionDriver.tickMotion(0.05);
    const s = twinMotionDriver.cleanSessionAt(renderStall);
    const d = doorStore.get(VEHICLE);
    const now = entry();
    trace.push({
      t: (t - T0) / 1000,
      clean: s?.phase ?? "none",
      arm: twinMotionDriver.armPhaseAt(renderStall),
      // how far the widest-open flank stands: the doors are per flank since 2026-11-13 (the worked flank's are open)
      doors: d ? Math.max(d.right, d.left) : 0,
      moving: !!now && (now.tracker !== null || now.reverse !== null),
    });
  }
  return trace;
}

const firstAt = (trace: Sample[], pred: (s: Sample) => boolean) => trace.find(pred)?.t ?? Infinity;
const cleanPhases = (trace: Sample[]) => {
  const out: string[] = [];
  for (const s of trace) if (out[out.length - 1] !== s.clean) out.push(s.clean);
  return out;
};

/** The car parked on the post, on the served layout, before the clock runs. */
function park(n: number) {
  twinMotionDriver.clear();
  twinMotionDriver.setTwinStallMap(served.stalls);
  useDepotStore.setState({
    stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
  });
  const twinStall = twinIdOf(n);
  const renderStall = twinMotionDriver.rendererStallFor(twinStall)!;
  twinMotionDriver.reconcile(snap(twinStall, T0));
  for (let k = 0; k < 2; k++) twinMotionDriver.tickMotion(0.05);
  return { twinStall, renderStall };
}

// one post per stall column of the two canopies 0759 and 0763 re-striped
const POSTS = [
  { n: 11, canopy: "B", column: "west" }, { n: 16, canopy: "B", column: "east" },
  { n: 21, canopy: "C", column: "west" }, { n: 26, canopy: "C", column: "east" },
] as const;

describe("the charge arm and the cleaning arm on canopies B and C, on the served layout", () => {
  for (const p of POSTS) {
    const name = `DCFC-${p.n}`;

    it(`${name} (canopy ${p.canopy}, ${p.column} column): the car is parked on its post and the twin's clean is read`, () => {
      const { renderStall } = park(p.n);
      expect(chargerBuild()).toBe("dcfc30");
      expect(renderStall).toBe(name);
      const st = useDepotStore.getState().stalls.find((s) => s.id === renderStall)!;
      const under = CANOPIES.reduce((b, c) => (Math.abs(c.cx - st.position.x) < Math.abs(b.cx - st.position.x) ? c : b));
      expect(under.id).toBe(p.canopy);
      expect(st.position.x < under.cx ? "west" : "east").toBe(p.column);
      expect(entry()?.stallId).toBe(renderStall);
      expect(twinMotionDriver.cabinCleanFor(VEHICLE)).toEqual({
        stall: renderStall, placedHere: true, startMs: T0, endsMs: T0 + CYCLE_S * 1000,
      });
    });

    it(`${name}: opens the doors as the charge arm mates, cleans both sides once it is latched, and is home with the doors shut by the twin's end`, () => {
      const { twinStall, renderStall } = park(p.n);
      const trace = play(twinStall, renderStall, CYCLE_S + 20, () => "charging_dcfc");
      expect(cleanPhases(trace)).toEqual([...CLEAN_CHAIN, "home"]);
      const doorsOpen = firstAt(trace, (s) => s.doors === 1);
      const latched = firstAt(trace, (s) => s.arm === "charging");
      const leftHome = firstAt(trace, (s) => s.clean === "swing_a");
      const home = firstAt(trace, (s) => s.clean === "home" && s.t > 10);
      expect(Number.isFinite(latched)).toBe(true);
      expect(doorsOpen).toBeLessThan(latched);
      expect(leftHome).toBeGreaterThanOrEqual(latched);
      expect(home).toBeLessThanOrEqual(CYCLE_S + 1);
      expect(home).toBeGreaterThan(CYCLE_S - 6);
      for (const s of trace) if (s.clean !== "home" && s.clean !== "doors_open" && s.clean !== "doors_close" && !s.clean.startsWith("swing_")) expect(s.doors).toBe(1);
      expect(trace[trace.length - 1].doors).toBe(0);
      expect(trace.some((s) => s.moving)).toBe(false);
    });

    it(`${name}: keeps the connector in while the arm cleans, though the charge is done, and lets the car go only after both robots are home`, () => {
      const { twinStall, renderStall } = park(p.n);
      // the charge completes 60 s in; the twin keeps the car on its charger (0758's hold)
      const trace = play(twinStall, renderStall, CYCLE_S + 60, (t) => (t < 60 ? "charging_dcfc" : "charge_complete_holding"));
      const home = firstAt(trace, (s) => s.clean === "home" && s.t > 10);
      expect(home).toBeLessThanOrEqual(CYCLE_S + 1);
      for (const s of trace) if (s.t > 61 && s.t < home) expect(s.arm).toBe("charging");
      const armLetGo = firstAt(trace, (s) => s.t >= home && s.arm !== "charging");
      const carMoved = firstAt(trace, (s) => s.moving);
      expect(armLetGo).toBeLessThan(home + 2);
      expect(carMoved).toBeGreaterThan(armLetGo);
      expect(Number.isFinite(carMoved)).toBe(true);
    });
  }
});
