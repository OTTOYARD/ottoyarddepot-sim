// ============================================================================
// DOCKING REGRESSION — does a charge-bound car actually reach its stall?
//
// The existing fixture test measures overlap/wedging; nothing measured whether
// a car COMMANDED to a charger physically arrives there. Two layers here:
//
//  1. FIXTURE — replay the captured busy_day run and classify every charge-lane
//     vehicle as docked / enroute / adrift.
//  2. SATURATION — synthetic charger-COLUMN contention, which the fixture does
//     not reach. Cars are sent to stalls BEHIND already-parked column-mates,
//     the case where a docking car must pass its parked neighbours.
//
// Scenario B (interleaved fill, every target flanked by parked cars) is what
// caught the residue-repair back-out: a car docked exactly on its stall, was
// re-railed for 12.7 deg of residual nose rotation, reversed 11u out, and
// wedged 2.4u outside its own stall forever. See TwinMotionDriver's
// MOTION-RESIDUE REPAIR comment.
//
// NOTE ON HARNESS FIDELITY: the driver admits new cars per RECONCILE, capped
// (MAX_ACTIVE_ENTERING / MAX_ACTIVE_SERVICE_APPROACH), deferring the overflow
// to "the next snapshot". These tests therefore RE-POLL the snapshot on a
// cadence, the way the live bridge does. A single reconcile followed by pure
// ticking strands every car past the cap and reads as a false defect.
// ============================================================================
import { describe, it, expect } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { poseStore } from "./motion/poseStore";
import { useDepotStore } from "@/store/depotStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import fixture from "./__fixtures__/twinRun.busyday.json";

type Internals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number; speed: number };
    tracker: { s: number; total: number; stationaryFor: number } | null;
    lane: string | null;
    stallId: string | null;
    playback: string;
  }>;
};

interface V { id: string; state: string; stall_id: string }

function snap(vehicles: V[], t: string): TwinSnapshot {
  return {
    run: { sim_run_id: "stress", scenario: "busy_day", status: "running",
           sim_clock: t, tick_count: 1, time_scale: 1, seed: 1, speed_x: 1 },
    legs: [],
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v, i) => ({
        id: v.id, av_id: `AV-${i}`, make: "Zoox", platform: "robotaxi",
        state: v.state, soc: 20, stall_id: v.stall_id,
      })),
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

/** group charger stalls into physical columns by their shared axis coordinate */
function chargerColumns() {
  const stalls = useDepotStore.getState().stalls
    .filter((s) => s.type === "dcfc" || s.type === "l2");
  const byX = new Map<number, typeof stalls>();
  for (const s of stalls) {
    const k = Math.round(s.position.x / 6) * 6;
    byX.set(k, [...(byX.get(k) ?? []), s]);
  }
  return [...byX.entries()]
    .map(([x, ss]) => ({ x, stalls: ss.slice().sort((a, b) => a.position.y - b.position.y) }))
    .filter((c) => c.stalls.length >= 3)
    .sort((a, b) => b.stalls.length - a.stalls.length);
}

describe("PROBE: charger-column saturation (PR #55's alleged failure mode)", () => {
  it("every car sent into a contended charger column reaches its exact stall", () => {
    twinMotionDriver.clear();
    useDepotStore.setState({
      stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
    });
    // identity stall map: twin uuid == renderer stall id for this synthetic run
    const all = useDepotStore.getState().stalls;
    twinMotionDriver.setTwinStallMap(
      all.map((s) => ({ id: s.id, code: s.id, type: s.type })),
    );

    const cols = chargerColumns();
    // eslint-disable-next-line no-console
    console.log(`\ncharger columns found: ${cols.map((c) => `x≈${c.x}:${c.stalls.length}`).join("  ")}`);

    const dt = 0.05;
    const rows: string[] = [];
    let totalSent = 0, totalDocked = 0;
    const failures: string[] = [];

    for (const col of cols) {
      // FILL FRONT-TO-BACK IN TWO WAVES so wave 2 must drive PAST wave 1's
      // parked bodies to reach the stalls deeper in the column.
      const half = Math.ceil(col.stalls.length / 2);
      const wave1 = col.stalls.slice(0, half);
      const wave2 = col.stalls.slice(half);
      if (!wave2.length) continue;

      twinMotionDriver.clear();
      useDepotStore.setState({
        stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
      });
      // clear() deliberately DROPS the twin→renderer stall map (the bridge
      // re-fetches it per run) — so it must be re-applied after every clear,
      // or every vehicle falls back to zone assignment with no rail.
      twinMotionDriver.setTwinStallMap(
        useDepotStore.getState().stalls.map((s) => ({ id: s.id, code: s.id, type: s.type })),
      );

      const chargeState = (t: string) => (t === "dcfc" ? "charging_dcfc" : "charging_l2");
      const vehicles: V[] = wave1.map((s, i) => ({
        id: `w1-${col.x}-${i}`, state: chargeState(s.type), stall_id: s.id,
      }));
      twinMotionDriver.reconcile(snap(vehicles, "2026-08-08T00:00:00Z"));
      for (let i = 0; i < 120 / dt; i++) twinMotionDriver.tickMotion(dt); // let wave 1 settle

      // wave 2: the stalls BEHIND the now-parked wave-1 bodies
      wave2.forEach((s, i) => vehicles.push({
        id: `w2-${col.x}-${i}`, state: chargeState(s.type), stall_id: s.id,
      }));
      twinMotionDriver.reconcile(snap(vehicles, "2026-08-08T00:05:00Z"));
      for (let i = 0; i < 300 / dt; i++) twinMotionDriver.tickMotion(dt); // 300s to dock

      const entries = (twinMotionDriver as unknown as Internals).entries;
      const stalls = useDepotStore.getState().stalls;
      let docked = 0, stuck = 0;
      for (const v of vehicles) {
        const e = entries.get(v.id);
        if (!e) { failures.push(`${v.id} MISSING`); continue; }
        const p = poseStore.get(v.id) ?? e.car;
        const st = stalls.find((s) => s.id === v.stall_id)!;
        const d = Math.hypot(p.x - st.position.x, p.y - st.position.y);
        if (!e.tracker && d <= 2) docked++;
        else {
          stuck++;
          failures.push(`${v.id} d=${d.toFixed(1)} rail=${e.tracker
            ? `s=${e.tracker.s.toFixed(0)}/${e.tracker.total.toFixed(0)} stationaryFor=${e.tracker.stationaryFor.toFixed(0)}`
            : "none"}`);
        }
      }
      totalSent += vehicles.length; totalDocked += docked;
      rows.push(`  column x≈${String(col.x).padStart(3)}  stalls=${String(col.stalls.length).padStart(2)}` +
        `  sent=${String(vehicles.length).padStart(2)}  docked=${String(docked).padStart(2)}  NOT=${stuck}`);
    }

    // eslint-disable-next-line no-console
    console.log("\n" + rows.join("\n") +
      `\n\nTOTAL  sent=${totalSent}  docked=${totalDocked}  notDocked=${totalSent - totalDocked}` +
      (failures.length ? `\n\nFAILURES:\n  ${failures.join("\n  ")}` : "\n\nFAILURES: none"));

    expect(totalSent).toBeGreaterThan(0);
    expect(totalDocked).toBe(totalSent);
  });
});

// ── HARDER VARIANTS ────────────────────────────────────────────────────────
describe("PROBE: maximal charger contention", () => {
  const dt = 0.05;
  const setup = () => {
    twinMotionDriver.clear();
    useDepotStore.setState({
      stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
    });
    twinMotionDriver.setTwinStallMap(
      useDepotStore.getState().stalls.map((s) => ({ id: s.id, code: s.id, type: s.type })),
    );
  };
  const cs = (t: string) => (t === "dcfc" ? "charging_dcfc" : "charging_l2");
  /** Drive the driver the way the live bridge does: RE-POLL the snapshot every
   *  2 sim-seconds while ticking. Admission is capped per reconcile
   *  (MAX_ACTIVE_ENTERING / MAX_ACTIVE_SERVICE_APPROACH) and the overflow is
   *  explicitly deferred "to the next snapshot" — a single reconcile followed
   *  by pure ticking therefore strands every car past the cap. */
  const run = (vehicles: V[], seconds: number, t = "2026-08-08T00:00:00Z") => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
      twinMotionDriver.reconcile(snap(vehicles, t));
      for (let i = 0; i < 2 / dt; i++) twinMotionDriver.tickMotion(dt);
    }
  };
  const report = (label: string, vehicles: V[]) => {
    const entries = (twinMotionDriver as unknown as Internals).entries;
    const stalls = useDepotStore.getState().stalls;
    let docked = 0; const bad: string[] = [];
    for (const v of vehicles) {
      const e = entries.get(v.id);
      const p = e ? (poseStore.get(v.id) ?? e.car) : null;
      const st = stalls.find((s) => s.id === v.stall_id)!;
      const d = p ? Math.hypot(p.x - st.position.x, p.y - st.position.y) : Infinity;
      if (e && !e.tracker && d <= 2) docked++;
      else bad.push(`${v.id}->${v.stall_id} d=${d.toFixed(1)} ${e?.tracker
        ? `rail s=${e.tracker.s.toFixed(0)}/${e.tracker.total.toFixed(0)} stationaryFor=${e.tracker.stationaryFor.toFixed(0)}` : "no-rail"}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n${label}\n  sent=${vehicles.length} docked=${docked} NOT=${vehicles.length - docked}` +
      (bad.length ? `\n  ${bad.join("\n  ")}` : ""));
    return docked;
  };

  it("A: ALL 40 chargers filled in one cold shot (max mouth-lock contention)", () => {
    setup();
    const ch = useDepotStore.getState().stalls.filter((s) => s.type === "dcfc" || s.type === "l2");
    const vehicles: V[] = ch.map((s, i) => ({ id: `all-${i}`, state: cs(s.type), stall_id: s.id }));
    run(vehicles, 600);
    expect(report("A: cold fill of every charger", vehicles)).toBe(vehicles.length);
  });

  it("B: ODD stalls parked first, then EVEN — every target has parked neighbours on BOTH sides", () => {
    setup();
    const cols = chargerColumns();
    const ch = cols.flatMap((c) => c.stalls);
    const odd = ch.filter((_, i) => i % 2 === 1);
    const even = ch.filter((_, i) => i % 2 === 0);
    const vehicles: V[] = odd.map((s, i) => ({ id: `odd-${i}`, state: cs(s.type), stall_id: s.id }));
    run(vehicles, 240);
    even.forEach((s, i) => vehicles.push({ id: `even-${i}`, state: cs(s.type), stall_id: s.id }));
    run(vehicles, 900, "2026-08-08T00:10:00Z");
    expect(report("B: interleaved fill (parked neighbours both sides)", vehicles)).toBe(vehicles.length);
  });

  it("C: DEEPEST stall last — the car must drive past a FULL column to its stall", () => {
    setup();
    const cols = chargerColumns();
    const vehicles: V[] = [];
    const last: V[] = [];
    for (const c of cols) {
      c.stalls.slice(0, -1).forEach((s, i) =>
        vehicles.push({ id: `pre-${c.x}-${i}`, state: cs(s.type), stall_id: s.id }));
      const deep = c.stalls[c.stalls.length - 1];
      last.push({ id: `deep-${c.x}`, state: cs(deep.type), stall_id: deep.id });
    }
    run(vehicles, 300);
    vehicles.push(...last);
    run(vehicles, 900, "2026-08-08T00:15:00Z");
    expect(report("C: deepest stall behind a full column", vehicles)).toBe(vehicles.length);
  });
});


interface FixChange { id: string; state: string; stall_id: string | null }
const F = fixture as unknown as {
  runId: string;
  stalls: { id: string; code: string; type: string }[];
  roster: { id: string; av_id: string; make: string; platform: string; soc: number }[];
  frames: { t: string; changes: FixChange[] }[];
};

const CHARGE_STATES = new Set(["charging_dcfc", "charging_l2"]);


function snapshotAt(states: Map<string, FixChange>, t: string): TwinSnapshot {
  const vehicles = F.roster.filter((r) => states.has(r.id)).map((r) => {
    const s = states.get(r.id)!;
    return { id: r.id, av_id: r.av_id, make: r.make, platform: r.platform,
             state: s.state, soc: r.soc, stall_id: s.stall_id };
  });
  return {
    run: { sim_run_id: F.runId, scenario: "busy_day", status: "running",
           sim_clock: t, tick_count: 1, time_scale: 1, seed: 1, speed_x: 1 },
    legs: [], fleet: { counts: {}, total: vehicles.length, vehicles },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

describe("PROBE: charge-bound cars reach their charger stall", () => {
  it("classifies every charge-lane car over the whole replay", () => {
    twinMotionDriver.clear();
    useDepotStore.setState({
      stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
    });
    twinMotionDriver.setTwinStallMap(F.stalls);

    const dt = 0.05, sampleEvery = 2, settle = 30;
    const states = new Map<string, FixChange>();
    // per-vehicle: first sample-index seen charging, first sample-index docked
    const firstSeen = new Map<string, number>();
    const firstDock = new Map<string, number>();
    const everAdrift = new Map<string, number>();
    const neverDockedAt = new Map<string, { x: number; y: number; stall: string | null }>();
    const drove = new Set<string>();
    let sampleIdx = 0;
    let chargeSamples = 0, dockedSamples = 0, enrouteSamples = 0, adriftSamples = 0;

    for (const f of F.frames) {
      for (const c of f.changes) states.set(c.id, c);
      twinMotionDriver.reconcile(snapshotAt(states, f.t));
      for (let k = 0; k < settle / sampleEvery; k++) {
        for (let i = 0; i < sampleEvery / dt; i++) twinMotionDriver.tickMotion(dt);
        sampleIdx++;
        const entries = (twinMotionDriver as unknown as Internals).entries;
        const stalls = useDepotStore.getState().stalls;
        for (const [id, e] of entries) {
          if (!CHARGE_STATES.has(states.get(id)?.state ?? "")) continue;
          chargeSamples++;
          if (!firstSeen.has(id)) firstSeen.set(id, sampleIdx);
          const p = poseStore.get(id) ?? e.car;
          const st = e.stallId ? stalls.find((s) => s.id === e.stallId) : undefined;
          const atStall = st ? Math.hypot(p.x - st.position.x, p.y - st.position.y) <= 2 : false;
          if (e.tracker) { enrouteSamples++; drove.add(id); continue; }
          if (atStall) {
            dockedSamples++;
            if (!firstDock.has(id)) firstDock.set(id, sampleIdx);
          } else {
            adriftSamples++;
            everAdrift.set(id, (everAdrift.get(id) ?? 0) + 1);
            neverDockedAt.set(id, { x: Math.round(p.x), y: Math.round(p.y), stall: e.stallId });
          }
        }
      }
    }

    const seen = [...firstSeen.keys()];
    const docked = seen.filter((id) => firstDock.has(id));
    const never = seen.filter((id) => !firstDock.has(id));
    const latency = docked.map((id) => (firstDock.get(id)! - firstSeen.get(id)!) * sampleEvery);

    // eslint-disable-next-line no-console
    console.log([
      "",
      `charge-bound vehicles seen : ${seen.length}`,
      `  reached their stall      : ${docked.length}`,
      `  NEVER reached it         : ${never.length}`,
      `dock latency (s of motion) : min=${Math.min(...latency)} med=${
        latency.slice().sort((a, b) => a - b)[Math.floor(latency.length / 2)]
      } max=${Math.max(...latency)}`,
      `sample tally  charge=${chargeSamples}  docked=${dockedSamples}` +
        `  enroute=${enrouteSamples}  adrift=${adriftSamples}`,
      never.length ? `NEVER-DOCKED: ${never.map((id) => `${id.slice(0, 8)}@${
        JSON.stringify(neverDockedAt.get(id))}`).join(", ")}` : "NEVER-DOCKED: none",
      "",
      `--- of those, ones that ACTUALLY TAXIED (held a rail at some point) ---`,
      `  taxied to a charger      : ${drove.size}`,
      `  of which docked          : ${[...drove].filter((id) => firstDock.has(id)).length}`,
      `  of which never docked    : ${[...drove].filter((id) => !firstDock.has(id)).length}`,
      `  their dock latency (s)   : ${[...drove].filter((id) => firstDock.has(id))
        .map((id) => (firstDock.get(id)! - firstSeen.get(id)!) * sampleEvery)
        .sort((a, b) => a - b).join(", ")}`,
    ].join("\n"));

    expect(seen.length).toBeGreaterThan(0);
    expect(never.length).toBe(0);
  });
});
