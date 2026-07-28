// ============================================================================
// REGRESSION GUARDS FOR THE ADVERSARIAL AUDIT FINDINGS.
//
// Every defect below type-checked and passed a 176-test suite. Several were
// actively PINNED by tests written from the same wrong assumption. That is the
// lesson worth encoding: a green suite proves the code agrees with the tests,
// not that either agrees with reality.
//
// The recurring failure class here is a bug that LIES — reports success for
// work not done, or renders a number that is false. In an artifact whose whole
// purpose is "what did OTTO-Q decide, and did the world comply", those are
// worse than a crash. Each test below is named for the lie it prevents.
// ============================================================================
import { describe, it, expect } from "vitest";
import type { TwinEventsWindow, TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import { packChannels } from "./channels";
import { SiteEnergyController } from "./energyController";
import { applyShield } from "./shield";
import { auditCoverage, resolveObservable } from "./coverage";
import { runPipeline } from "./pipeline";
import { energyAdvisor } from "./advisors";
import { CommandBus, twinExecutor } from "./commandBus";
import { commandId, simPlus, type CommandRecord, type OttoQCommand } from "./commands";

const CLOCK = "2026-07-27T14:00:00.000Z";
const at = (s: number) => new Date(Date.parse(CLOCK) + s * 1000).toISOString();

const layout: TwinLayout = {
  depot: { id: "d1", name: "Nashville", origin_lat: 36.1, origin_lng: -86.7 },
  structures: [],
  stalls: [
    { id: "s0", code: "D-00", type: "dcfc", zone: "n", canopy: null, covered: null, x: 0, y: 0, heading: 0, connector_kw: 350 },
    { id: "s1", code: "L-00", type: "l2", zone: "s", canopy: null, covered: null, x: 1, y: 0, heading: 0, connector_kw: 19.2 },
  ],
};

function bundleWith(over: { dr?: boolean | undefined; dropGrid?: boolean; lmp?: number; solar?: number } = {}) {
  const snap = {
    run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
    fleet: {
      counts: {}, total: 1,
      vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "arrived_at_gate", soc: 15, stall_id: null }],
    },
    stalls_status: [],
    energy: { grid_import_kw: 100, grid_export_kw: 0, solar_kw: over.solar ?? 10, bess_output_kw: 0, ev_charging_kw: 80, building_kw: 30, peak_15min_kw: 600, tariff: "GSA-3", rate_per_kwh: 0.08, at: CLOCK },
    bess: { soc_pct: 60, power_kw: 0, state: "idle", temp_c: 25, soh_pct: 98 },
    weather: { temp_c: 30, cloud_pct: 10, conditions: "clear", precip: "none", ghi_wm2: 700, wind_kmh: 8, solar_elev_deg: 55, at: CLOCK },
    grid: over.dropGrid ? null : {
      lmp_usd_mwh: over.lmp ?? 40, tariff: "GSA-3", carbon_gco2_kwh: 370,
      voltage_status: "nominal", frequency_hz: 60, reserve_margin_pct: 15,
      dr_active: over.dr, dr_cap_kw: over.dr ? 400 : null, at: CLOCK,
    },
    counters: { dispatches_active: 1, dispatches_total: 5, telemetry_packets: 10, charge_sessions: 1, events_total: 5, open_incidents: 0 },
    recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
  return packChannels(snap, layout, new Date(CLOCK));
}

/** A bare frame with no events window — the "we did not look" case. */
const SNAP = {
  run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
  fleet: {
    counts: {}, total: 1,
    vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "arrived_at_gate", soc: 15, stall_id: null }],
  },
  stalls_status: [], energy: null, bess: null, weather: null, grid: null,
  counters: { dispatches_active: 1, dispatches_total: 5, telemetry_packets: 10, charge_sessions: 1, events_total: 5, open_incidents: 0 },
  recent_events: [], variability: {},
} as unknown as TwinSnapshot;

/**
 * Shape and values lifted verbatim from `ottoq_twin_events_window` on live run
 * 6256a99f (144 sessions, 2 faults, 21 delays over 1440 sim-minutes). Pinned to
 * REAL numbers on purpose: the last three defects in this file were all
 * assumptions about VALUES that passed every type check.
 */
const EVENTS: TwinEventsWindow = {
  window: { basis: "run_to_date", signal_events: 1206, first_at: CLOCK, last_at: CLOCK, sim_minutes_elapsed: 1440 },
  by_type: { "charge.session_started": 144, "fleet.arrival_delayed": 21 },
  by_severity: { info: 1143, debug: 33, warning: 30 },
  reliability: {
    charge_sessions: 144, charge_faults: 2, charge_fault_rate: 0.0139,
    fault_reasons: { "fault.thermal_emergency": 1, "fault.session_aborted_other": 1 },
    repair_minutes_total: 242, arrival_delays: 21, delay_min_p50: 17,
    delay_causes: { accident: 2, congestion: 14, heavy_traffic: 5 },
    stranded_recharges: 4, tow_events: 1, exceptions_by_severity: { major: 2 },
    faults_per_sim_hour: 0.083, delays_per_sim_hour: 0.875,
  },
  charging: {
    target_soc_p50: 80, soc_start_p50: 30, charge_curve_ratio_p50: 0.844,
    battery_temp_c_p50: 28.6, battery_soh_pct_p50: null,
    sessions_completed: 119, energy_kwh_total: 6209.28, avg_power_kw_p50: 16.56,
    session_duration_s_p50: 5400, auto_rerouted: 0,
  },
  demand_forecast: {
    at: CLOCK, horizon_min: 60, incoming_count: 25, charge_needed_count: 25,
    predicted_charge_kw: 2873, predicted_charge_kwh: 1024,
  },
  throughput: { valve_holds: 20, held_total: 111, released_total: 120, cap_last: 6 },
};

// ── L1: the worst one ───────────────────────────────────────────────────────

describe("L1 — a directive must not report 'completed' having delivered nothing", () => {
  // The twin advances on BIG ticks (time_scale to 480 sim-min). The old step()
  // sampled the window only at the end instant, so a one-hour directive was
  // already expired at the next step and closed as completed with 0 kWh moved.
  // The old tests missed it by advancing in 1-second slices — a resolution the
  // live loop never uses.
  const TICKS = [60, 300, 900, 3600, 7200];

  for (const tick of TICKS) {
    it(`delivers real energy at a ${tick}s tick`, () => {
      const c = new SiteEnergyController(80, { capacityKwh: 2000 }, CLOCK);
      expect(c.accept({
        command_id: "c1", intent: "discharge_bess",
        params: { power_kw: -400, soc_bound_pct: 20 },
        not_before_sim: null, not_after_sim: at(3600),
      })).toBe(true);

      const before = c.state.socPct;
      // step until we have covered the whole window — at a tick COARSER than
      // the window that is a single enormous step, which is exactly the case
      // the old code got wrong.
      for (let t = tick; t <= Math.max(3600, tick); t += tick) c.step(at(t));
      const moved = before - c.state.socPct;

      // 400 kW for an hour on a 2000 kWh pack is ~20% of state of charge.
      // Anything near zero means the directive expired without integrating.
      expect(moved).toBeGreaterThan(15);
      expect(moved).toBeLessThan(25);
    });
  }

  it("does not over-deliver a delayed directive at a coarse tick", () => {
    // "discharge in 20 minutes" for 45 minutes. A single 2-hour step must not
    // integrate the whole interval as if the directive had been active for it.
    const c = new SiteEnergyController(90, { capacityKwh: 2000 }, CLOCK);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: at(1200), not_after_sim: at(1200 + 45 * 60),
    });
    c.step(at(7200)); // one enormous tick spanning the entire window
    const moved = 90 - c.state.socPct;
    // 400 kW × 45 min = 300 kWh = 15% of a 2000 kWh pack. Not 2 hours' worth.
    expect(moved).toBeGreaterThan(10);
    expect(moved).toBeLessThan(18);
  });

  it("reports a genuinely untouched directive honestly, not as completed work", () => {
    const c = new SiteEnergyController(60, { capacityKwh: 2000 }, CLOCK);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    for (let t = 60; t <= 3600; t += 60) c.step(at(t));
    // it ran its window, so completed is correct here — and energy moved
    const done = c.drainOutcomes();
    expect(done.find((o) => o.command_id === "c1")?.status).toBe("completed");
    expect(c.state.socPct).toBeLessThan(60);
  });
});

// ── L4: bounds limit flow, they do not teleport state ───────────────────────

describe("L4 — a bound must never move state of charge against the flow", () => {
  it("does not raise SoC when a discharge is bounded below the current level", () => {
    // Accepted at 15% with a declared floor of 20%: the old clamp jumped SoC UP
    // to 20 while delivering 0 kW and reported "reached the bound / completed".
    // Energy fabricated, success claimed.
    const c = new SiteEnergyController(15, { capacityKwh: 500, hardFloorPct: 10 }, CLOCK);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -200, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(1800),
    });
    for (let t = 60; t <= 1800; t += 60) c.step(at(t));
    expect(c.state.socPct).toBeLessThanOrEqual(15);
  });

  it("does not lower SoC when a charge is bounded above the current level", () => {
    const c = new SiteEnergyController(90, { capacityKwh: 500 }, CLOCK);
    c.accept({
      command_id: "c1", intent: "charge_bess",
      params: { power_kw: 200, soc_bound_pct: 80 },
      not_before_sim: null, not_after_sim: at(1800),
    });
    for (let t = 60; t <= 1800; t += 60) c.step(at(t));
    expect(c.state.socPct).toBeGreaterThanOrEqual(90);
  });
});

// ── L2/L3: curtailment must bind and release; the model must track the world ─

describe("L2 — a curtailment must constrain something and be releasable", () => {
  it("limits charging to the cap's headroom", () => {
    const c = new SiteEnergyController(50, { capacityKwh: 2000 }, CLOCK);
    c.syncFromWorld(50, 300);                       // 300 kW of other site load
    c.accept({ command_id: "cap", intent: "curtail_site", params: { site_cap_kw: 400 }, not_before_sim: null, not_after_sim: null });
    c.accept({ command_id: "ch", intent: "charge_bess", params: { power_kw: 250, soc_bound_pct: 95 }, not_before_sim: null, not_after_sim: at(3600) });
    for (let t = 60; t <= 600; t += 60) c.step(at(t));
    // headroom is 400 - 300 = 100 kW, not the 250 asked for
    expect(c.state.actualKw).toBeLessThanOrEqual(101);
    expect(c.state.derateReason).toContain("site cap");
  });

  it("releases the cap when the demand-response call clears", () => {
    const c = new SiteEnergyController(50);
    c.accept({ command_id: "cap", intent: "curtail_site", params: { site_cap_kw: 400 }, not_before_sim: null, not_after_sim: null });
    expect(c.state.siteCapKw).toBe(400);
    c.releaseCurtailmentIfClear(true);   // still live — keep it
    expect(c.state.siteCapKw).toBe(400);
    c.releaseCurtailmentIfClear(false);  // event over — must not latch
    expect(c.state.siteCapKw).toBeNull();
  });
});

describe("L3 — the model must resync to the twin, not drift", () => {
  it("adopts the world's state of charge", () => {
    const c = new SiteEnergyController(60);
    c.syncFromWorld(22, null);
    expect(c.state.socPct).toBe(22);
  });

  it("keeps its own value when the world reports nothing", () => {
    const c = new SiteEnergyController(60);
    c.syncFromWorld(null, null);
    expect(c.state.socPct).toBe(60);
  });
});

// ── L7: unknown is not false ────────────────────────────────────────────────

describe("L7 — unknown demand-response state must not read as 'no call'", () => {
  it("publishes null, not false, when the grid row is absent", () => {
    const b = bundleWith({ dropGrid: true });
    expect(b.channels.energy_grid.payload.demand_response.active).toBeNull();
    expect(b.channels.energy_grid.integrity.missing).toContain("demand_response.active");
  });

  it("still publishes a real false when the grid says so", () => {
    expect(bundleWith({ dr: false }).channels.energy_grid.payload.demand_response.active).toBe(false);
  });

  it("the shield refuses grid charging while DR state is unknown", () => {
    const b = bundleWith({ dropGrid: true, solar: 10 });
    const cmd = {
      command_id: "c1", contract_version: "1.0.0", command_class: "energy.orchestration",
      intent: "charge_bess", authority: "directive", sim_run_id: "run-1", tick: 12,
      issued_sim: CLOCK, issued_at: CLOCK, sequence: 0,
      target: { kind: "bess", id: "site_bess" },
      window: { not_before_sim: CLOCK, not_after_sim: at(3600), expires_sim: at(3600) },
      params: { power_kw: 250 }, priority: 300, correlation_id: "p",
      provenance: { advisor: "t", layers: [], input_tick: 12, input_contract_version: "1.0.0", input_bundle_status: b.status, rationale: "t", confidence: 1 },
      ack_required: true,
    } as unknown as OttoQCommand;
    const r = applyShield([cmd], { bundle: b, openCommands: new Map() });
    expect(r.admitted).toHaveLength(0);
    expect(r.suppressed[0].detail).toContain("unknown");
  });
});

// ── #2: priority must survive across ticks ──────────────────────────────────

describe("cross-tick preemption — compliance must outrank a stale open command", () => {
  function energyCmd(id: string, intent: string, priority: number, params: object): OttoQCommand {
    return {
      command_id: id, contract_version: "1.0.0", command_class: "energy.orchestration",
      intent, authority: "directive", sim_run_id: "run-1", tick: 12,
      issued_sim: CLOCK, issued_at: CLOCK, sequence: 0,
      target: { kind: "bess", id: "site_bess" },
      window: { not_before_sim: CLOCK, not_after_sim: at(3600), expires_sim: at(3600) },
      params, priority, correlation_id: "p",
      provenance: { advisor: "t", layers: [], input_tick: 12, input_contract_version: "1.0.0", input_bundle_status: "degraded", rationale: "t", confidence: 1 },
      ack_required: true,
    } as unknown as OttoQCommand;
  }

  it("admits the higher-priority command and reports the displaced one", () => {
    const open = new Map<string, CommandRecord>([
      ["old", { command: energyCmd("old", "charge_bess", 268, { power_kw: 250 }), status: "accepted", history: [], ack: null, outcome: null }],
    ]);
    const r = applyShield(
      [energyCmd("new", "discharge_bess", 1000, { power_kw: -400, soc_bound_pct: 15 })],
      { bundle: bundleWith({ dr: true }), openCommands: open },
    );
    expect(r.admitted).toHaveLength(1);
    expect(r.preempted).toHaveLength(1);
    expect(r.preempted[0].command_id).toBe("old");
  });

  it("still blocks an equal or lower priority command", () => {
    const open = new Map<string, CommandRecord>([
      ["old", { command: energyCmd("old", "discharge_bess", 1000, { power_kw: -400 }), status: "accepted", history: [], ack: null, outcome: null }],
    ]);
    const r = applyShield(
      [energyCmd("new", "charge_bess", 300, { power_kw: 250 })],
      { bundle: bundleWith({ dr: false }), openCommands: open },
    );
    expect(r.admitted).toHaveLength(0);
    expect(r.suppressed[0].rule).toBe("target_not_saturated");
    expect(r.preempted).toHaveLength(0);
  });
});

// ── #4: the actuation scan must cover the whole command ─────────────────────

describe("no_actuation — the scan must not stop at params", () => {
  it("catches actuation smuggled through the target object", () => {
    const cmd = {
      command_id: "c1", contract_version: "1.0.0", command_class: "energy.orchestration",
      intent: "hold_bess", authority: "directive", sim_run_id: "run-1", tick: 12,
      issued_sim: CLOCK, issued_at: CLOCK, sequence: 0,
      // materialize copies the advisor's target by reference — this used to sail through
      target: { kind: "bess", id: "site_bess", heading: 1.2, speed_kmh: 40 },
      window: { not_before_sim: CLOCK, not_after_sim: at(600), expires_sim: at(1200) },
      params: {}, priority: 100, correlation_id: "p",
      provenance: { advisor: "t", layers: [], input_tick: 12, input_contract_version: "1.0.0", input_bundle_status: "degraded", rationale: "t", confidence: 1 },
      ack_required: true,
    } as unknown as OttoQCommand;
    const r = applyShield([cmd], { bundle: bundleWith({ dr: false }), openCommands: new Map() });
    expect(r.admitted).toHaveLength(0);
    expect(r.suppressed[0].rule).toBe("no_actuation");
    expect(r.suppressed[0].detail).toContain("target.heading");
  });
});

// ── L5: suppressions must not manufacture phantom lost commands ─────────────

describe("L5 — a suppressed command must not burn a sequence number", () => {
  it("reports no sequence gaps after a batch with suppressions", async () => {
    const bus = new CommandBus(twinExecutor({ energy: () => true, vehicle: () => true }));
    const bundle = bundleWith({ lmp: 10 });

    // two passes, so any pre-shield numbering shows up as a hole
    for (let i = 0; i < 2; i++) {
      const r = await runPipeline({
        advisors: [energyAdvisor()],
        bundle,
        openCommands: bus.openCommands,
        sequenceStart: bus.sequenceStart,
      });
      await bus.transmit(r.batch);
    }
    expect(bus.stats().sequenceGaps).toEqual([]);
  });

  it("numbers admitted commands contiguously from the requested start", async () => {
    const r = await runPipeline({
      advisors: [energyAdvisor()],
      bundle: bundleWith({ lmp: 10 }),
      openCommands: new Map(),
      sequenceStart: 7,
    });
    const seqs = r.batch.commands.map((c) => c.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => 7 + i));
  });
});

// keep the imports honest
void commandId; void simPlus;

// ── second batch: honesty of the coverage number and the shield's own floors ─

describe("coverage must not over-report on a world that published nothing", () => {
  it("grades variables dark when their channel resolved nothing", () => {
    // queue.waiting and soc.missing are array-length counters — 0, not absent,
    // on an empty world. They used to grade "observed" while the channel's own
    // integrity record listed the field as missing, in the very number built
    // to replace an inflated "47/47 live".
    const empty = {
      run: { sim_run_id: "r", scenario: "s", status: "running", sim_clock: CLOCK, tick_count: 1, time_scale: 60, seed: 1 },
      fleet: { counts: {}, total: 0, vehicles: [] },
      stalls_status: [], energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;
    const b = packChannels(empty, null, new Date(CLOCK));
    const r = auditCoverage(b);
    expect(b.channels.fleet_telemetry.integrity.status).toBe("missing");
    expect(r.variables.find((v) => v.var_key === "telemetry_dropout")?.verdict).toBe("dark");
    expect(r.variables.find((v) => v.var_key === "queue_patience")?.verdict).toBe("dark");
    expect(r.observed).toBe(0);
  });

  it("keeps the charger fault RATE separate from per-charger health", () => {
    // charger_fault used to be structurally unobservable: nothing on any frame
    // carried it. The events window changed that — but only for the POPULATION
    // rate. Per-charger station_state is still unpublished, so counts.faulted
    // must stay null no matter how healthy the rate looks. A frame that says
    // "fault rate 1.4%" and "0 chargers faulted" would let the orchestrator
    // keep assigning vehicles to dead hardware, which is the failure the null
    // exists to prevent.
    const b = bundleWith({ dr: false });
    expect(b.channels.charger_systems.payload.counts.faulted).toBeNull();
    expect(b.channels.charger_systems.payload.ocpp).toEqual([]);
    // No events window was fetched for this bundle, so the rate is dark —
    // absent, not zero. The two blocks disagree about nothing.
    expect(b.channels.charger_systems.payload.reliability).toBeNull();
    expect(b.channels.charger_systems.payload.observed_charging).toBeNull();
    const r = auditCoverage(b);
    expect(r.variables.find((v) => v.var_key === "charger_fault")?.verdict).toBe("dark");
  });

  it("never reports a quiet depot on an events window that was never fetched", () => {
    // THE ZERO-AS-ABSENT TRAP, one level up. Every count in these blocks is a
    // natural 0 on a calm run, so a zeroed record is indistinguishable from no
    // record — and a zeroed record asserts "we looked and the depot is fine".
    // The blocks are therefore NULL until the window is actually fetched.
    const b = packChannels(SNAP, null, new Date(CLOCK));   // no events argument
    expect(b.channels.depot_ops.payload.reliability).toBeNull();
    expect(b.channels.depot_ops.payload.throughput).toBeNull();
    expect(b.channels.depot_ops.payload.demand_forecast).toBeNull();
    expect(b.channels.depot_ops.integrity.missing).toContain("events.window");

    const r = auditCoverage(b);
    for (const key of ["breakdown_rate", "incident_severity", "charger_fault", "target_soc"]) {
      expect(r.variables.find((v) => v.var_key === key)?.verdict).toBe("dark");
    }
  });

  it("counts a measured zero as evidence but an empty histogram as none", () => {
    // `tow_events: 0` means we counted and found none — a measurement.
    // `delay_causes: {}` is an empty bag: it cannot demonstrate that the knob
    // driving delay causes moved anything, so it must not score as coverage.
    expect(resolveObservable({ tow_events: 0 }, "tow_events")).toBe(true);
    expect(resolveObservable({ causes: {} }, "causes")).toBe(false);
    expect(resolveObservable({ causes: { congestion: 3 } }, "causes")).toBe(true);
    expect(resolveObservable({ list: [] }, "list")).toBe(false);
    // false is still an observation
    expect(resolveObservable({ active: false }, "active")).toBe(true);
  });

  it("publishes the charge curve the fleet actually pulled, not its nameplate", () => {
    // initial_rate_kw / max_rate_kw. If this ever reads exactly 1.0 across a
    // whole run, the twin has stopped modelling ramp and is echoing nameplate.
    const b = packChannels(SNAP, null, new Date(CLOCK), EVENTS);
    const oc = b.channels.charger_systems.payload.observed_charging;
    expect(oc?.charge_curve_ratio_p50).toBeCloseTo(0.844, 3);
    expect(b.channels.charger_systems.payload.reliability?.fault_rate).toBeCloseTo(0.0139, 4);
    // SoH is absent from every charge SESSION and must not become a number
    // there. It is not absent from the world — it lives on the fleet-condition
    // feed — so the variable grades dark (a feed we did not fetch), not
    // unobservable (nothing anywhere carries it).
    expect(oc?.battery_soh_pct_p50).toBeNull();
    expect(auditCoverage(b).variables.find((v) => v.var_key === "veh_battery_soh_pct")?.verdict)
      .toBe("dark");
  });

  it("refuses to describe a depot the run does not belong to", () => {
    // THE WORST ONE FOUND SO FAR, and it was live.
    //
    // The cockpit fetches the layout for a HARDCODED depot while a run may
    // belong to a different one. The backend has two seeded depots with 150
    // stalls each and ZERO id overlap ("OTTOYARD Nashville Flagship" and
    // "OTTOYARD Benchmark (CRN A/B)"), and the majority of runs are on the
    // second. On the reference run, 25 of 25 occupied stalls and 25 of 25
    // vehicle stall-bindings resolved to NOTHING.
    //
    // Nothing threw. Every stall fell back to `assumed_available`, so the
    // frame reported a pristine 150-stall depot with nobody in it, zero
    // chargers delivering, and integrity "ok" — a completely coherent
    // description of a building that was not being simulated.
    const mismatched = {
      run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
      fleet: {
        counts: {}, total: 1,
        vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "charging_dcfc", soc: 40, stall_id: "OTHER-DEPOT-STALL" }],
      },
      // occupied stalls from a depot whose ids the layout has never heard of
      stalls_status: [
        { id: "OTHER-DEPOT-STALL", status: "occupied", vehicle_id: "v1" },
        { id: "OTHER-DEPOT-STALL-2", status: "occupied", vehicle_id: "v2" },
      ],
      energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;

    const b = packChannels(mismatched, layout, new Date(CLOCK));
    const dep = b.channels.depot_ops;

    // The lie the old code told: a perfectly healthy, perfectly empty depot.
    expect(dep.payload.capacity.occupied).toBe(0);   // still structurally true...
    // ...but it must NEVER be presentable as fact.
    expect(dep.payload.layout_matches_run).toBe(false);
    expect(dep.integrity.status).not.toBe("ok");
    expect(dep.integrity.missing).toContain("layout.matches_run");
    expect(dep.integrity.notes.join(" ")).toContain("LAYOUT DOES NOT BELONG TO THIS RUN");

    // The charger channel performs the same join and must fail the same way,
    // rather than reporting every charger free.
    const cs = b.channels.charger_systems;
    expect(cs.integrity.missing).toContain("layout.matches_run");
    expect(cs.integrity.notes.join(" ")).toContain("LAYOUT DOES NOT BELONG TO THIS RUN");
  });

  it("does not cry mismatch when the layout genuinely matches", () => {
    // The guard must stay silent on a healthy frame, and stay NULL rather than
    // false when there is simply nothing occupied yet to cross-check.
    const b = bundleWith({ dr: false });   // stalls_status: [] — nothing to check
    expect(b.channels.depot_ops.payload.layout_matches_run).toBeNull();
    expect(b.channels.depot_ops.integrity.notes.join(" "))
      .not.toContain("LAYOUT DOES NOT BELONG");

    const matched = {
      run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
      fleet: { counts: {}, total: 1, vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "charging_dcfc", soc: 40, stall_id: "s0" }] },
      stalls_status: [{ id: "s0", status: "occupied", vehicle_id: "v1" }],
      energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;
    const ok = packChannels(matched, layout, new Date(CLOCK));
    expect(ok.channels.depot_ops.payload.layout_matches_run).toBe(true);
    expect(ok.channels.depot_ops.payload.capacity.occupied).toBe(1);
    // and the vehicle in it is seen to be charging
    expect(ok.channels.charger_systems.payload.counts.charging).toBe(1);
  });

  it("does not let stall availability speak for real throughput", () => {
    // Staffing is a HARD concurrency limit, not a slowdown: ottoq_sim_lane_capacity
    // gates how many wash/service/deploy lanes can be open at all. A depot with 3
    // free wash stalls and 1 staffed wash lane will accept one vehicle and park
    // the rest. OTTO-Q saw only the stalls.
    const snap = {
      run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
      fleet: { counts: {}, total: 1, vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "staged_awaiting_service", soc: 55, stall_id: null }] },
      stalls_status: [], energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;

    const labor = {
      window: { basis: "run_to_date", sim_minutes_elapsed: 1440 },
      staffing: { general_tech: 10, service_tech: 3, wash_supervisor: 2 },
      knobs: { staffing_level: null, charging_staff: null, cleaning_staff: null,
               service_staff: null, deploy_staff: null, any_set: false },
      // real values lifted from twin.staging_overflow on run 89439eb8
      lanes: { wash_cap: 3, service_cap: 2, deploy_cap: 20, patience_min: 10, observed_at: CLOCK },
      overflow: { events: 8, vehicles_total: 31, vehicles_max: 7, escalated: 0, per_sim_hour: 0.333 },
      backlog: { started: 20, completed: 20, open: 0,
                 by_service: { exterior_wash: { started: 12, est_min_p50: 9.5, requires_bay: "wash_bay" } },
                 bay_bound: 17, digital: 3, blocks_dispatch: 0 },
    };

    const b = packChannels(snap, layout, new Date(CLOCK), null, null, labor as never);
    const dep = b.channels.depot_ops;
    expect(dep.payload.labor?.lanes.wash_cap).toBe(3);
    expect(dep.payload.labor?.lanes.service_cap).toBe(2);
    // the pressure must be stated, not left for the reader to infer
    expect(dep.integrity.notes.join(" ")).toContain("labor bound 8x");
    expect(dep.integrity.notes.join(" ")).toContain("overstates real throughput");

    const r = auditCoverage(b);
    for (const k of ["staffing_level", "cleaning_staff", "service_staff", "deploy_staff"])
      expect(r.variables.find((v) => v.var_key === k)?.verdict).toBe("observed");
  });

  it("will not dress an inert knob up as an observable one", () => {
    // `charging_staff` is registered, operator-adjustable, and marked wired in
    // the catalog — and NO function in the database reads it (verified across
    // every pg_proc body). Moving that slider changes nothing in the world.
    //
    // The tempting fix is to publish the knob's own value so the domain scores
    // 5/5. That would report a SETTING as though it were an OUTCOME, which is
    // the exact failure this whole audit exists to prevent. It stays
    // unobservable until the sim actually reads it.
    const r = auditCoverage(bundleWith({}));
    const v = r.variables.find((x) => x.var_key === "charging_staff");
    expect(v?.verdict).toBe("unobservable");
    expect(v?.channel).toBeNull();
    expect(v?.note).toContain("no sim function reads this knob");
  });

  it("does not read an unstamped lane cap as unlimited capacity", () => {
    // The sim stamps effective caps only when a lane is CONTENDED. A run with
    // no contention yet has null caps — which means "not yet observed", not
    // "unbounded". Defaulting that to a large number would invite OTTO-Q to
    // flood a lane it has never seen fill.
    const quiet = {
      window: { basis: "run_to_date", sim_minutes_elapsed: 60 },
      staffing: { general_tech: 10 },
      knobs: { staffing_level: null, charging_staff: null, cleaning_staff: null,
               service_staff: null, deploy_staff: null, any_set: false },
      lanes: { wash_cap: null, service_cap: null, deploy_cap: null, patience_min: null, observed_at: null },
      overflow: { events: 0, vehicles_total: 0, vehicles_max: null, escalated: 0, per_sim_hour: 0 },
      backlog: { started: 0, completed: 0, open: 0, by_service: {}, bay_bound: 0, digital: 0, blocks_dispatch: 0 },
    };
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, quiet as never);
    expect(b.channels.depot_ops.payload.labor?.lanes.wash_cap).toBeNull();
    expect(b.channels.depot_ops.integrity.missing).toContain("labor.lane_caps");
    expect(b.channels.depot_ops.integrity.notes.join(" "))
      .toContain("Absence means no contention, NOT unlimited capacity");
  });

  it("does not let a plan stand in for what the fleet actually did", () => {
    // Values lifted verbatim from ottoq_twin_offsite_window on run a044dab4.
    // The finding they encode: trips run 3.6x their planned duration, and the
    // dominant return reason is the BATTERY, not the schedule. An orchestrator
    // that pre-stages for planned_duration_min staffs for a fleet that is not
    // coming — so the frame has to say the plan is not usable.
    const offsite = {
      dispatches: { total: 270, completed: 239, active: 0 },
      off_site_now: { count: 0, elapsed_min_p50: null, return_eta_min_p50: null, soc_at_dispatch_p50: null },
      duration: { planned_min_p50: 66.4, actual_min_p50: 270, actual_min_p90: 480,
                  drift_min_p50: 206.1, overran_plan: 195, ratio_p50: 3.638 },
      activity: { miles_p50: 3.17, miles_per_trip_min_p50: 0.0112,
                  soc_drop_pct_per_hour_p50: 9.23, energy_basis: "soc_delta_proxy" },
      soc: { at_dispatch_p50: 90, at_return_p50: 41.8, at_return_p10: 33.6, returned_below_20: 0 },
      arrival_jitter_min_p50: 0,
      by_return_trigger: {
        low_soc_reserve: { n: 122, planned_min_p50: 58.4, actual_min_p50: 355.7, drift_min_p50: 279.9, soc_at_return_p50: 37.1 },
        sensor_soil:     { n: 70,  planned_min_p50: 71.3, actual_min_p50: 75,    drift_min_p50: 28.6,  soc_at_return_p50: 76.8 },
      },
    };

    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, offsite as never);
    const ft = b.channels.fleet_telemetry;
    expect(ft.payload.offsite?.duration.ratio_p50).toBe(3.638);
    expect(ft.integrity.notes.join(" ")).toContain("3.638x their planned duration");
    expect(ft.integrity.notes.join(" ")).toContain("not a usable predictor");

    // The per-trigger breakdown must survive: a fleet-wide average would hide
    // that low_soc trips run 356 min while soil trips run 75.
    expect(ft.payload.offsite?.by_return_trigger.low_soc_reserve.actual_min_p50).toBe(355.7);

    const r = auditCoverage(b);
    expect(r.variables.find((v) => v.var_key === "trip_duration")?.verdict).toBe("observed");
    expect(r.variables.find((v) => v.var_key === "idle_fraction")?.verdict).toBe("observed");
    // soc_on_arrival now reads the RETURNING trip, not the whole yard
    expect(r.variables.find((v) => v.var_key === "soc_on_arrival")?.verdict).toBe("observed");
    expect(ft.payload.offsite?.soc.at_return_p50).toBe(41.8);
    expect(resolveObservable(ft.payload, "offsite.soc.at_return_p50")).toBe(true);
  });

  it("never sources trip energy from a column the sim does not write", () => {
    // ottoq_vehicle_dispatches.energy_consumed_kwh is NULL in all 17,619 rows.
    // Publishing it would report a fleet that drove 17,000 trips on no energy —
    // and unlike a missing field, a plausible 0 invites arithmetic. The payload
    // carries a SoC-delta proxy and says so in the data itself.
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, {
      dispatches: { total: 1, completed: 1, active: 0 },
      off_site_now: { count: 0, elapsed_min_p50: null, return_eta_min_p50: null, soc_at_dispatch_p50: null },
      duration: { planned_min_p50: 60, actual_min_p50: 62, actual_min_p90: 70, drift_min_p50: 2, overran_plan: 1, ratio_p50: 1.03 },
      activity: { miles_p50: 3, miles_per_trip_min_p50: 0.05, soc_drop_pct_per_hour_p50: 9, energy_basis: "soc_delta_proxy" },
      soc: { at_dispatch_p50: 90, at_return_p50: 80, at_return_p10: 75, returned_below_20: 0 },
      arrival_jitter_min_p50: 0, by_return_trigger: {},
    } as never);
    const act = b.channels.fleet_telemetry.payload.offsite?.activity as Record<string, unknown>;
    expect(act.energy_basis).toBe("soc_delta_proxy");
    expect(act).not.toHaveProperty("energy_kwh_p50");
    // and the plan is close enough here that no warning should fire
    expect(b.channels.fleet_telemetry.integrity.notes.join(" ")).not.toContain("not a usable predictor");
  });

  it("reports drift as UNKNOWN when the catalog could not be read", () => {
    const r = auditCoverage(bundleWith({ dr: false }));       // no catalog passed
    expect(r.unbound_catalog_keys).toBeNull();
    expect(r.stale_bindings).toBeNull();
    const empty = auditCoverage(bundleWith({ dr: false }), []); // failed fetch
    expect(empty.stale_bindings).toBeNull();
  });
});

describe("the shield must not delegate its own floors", () => {
  function bess(intent: string, params: object): OttoQCommand {
    return {
      command_id: "c1", contract_version: "1.0.0", command_class: "energy.orchestration",
      intent, authority: "directive", sim_run_id: "run-1", tick: 12,
      issued_sim: CLOCK, issued_at: CLOCK, sequence: 0,
      target: { kind: "bess", id: "site_bess" },
      window: { not_before_sim: CLOCK, not_after_sim: at(3600), expires_sim: at(3600) },
      params, priority: 500, correlation_id: "p",
      provenance: { advisor: "t", layers: [], input_tick: 12, input_contract_version: "1.0.0", input_bundle_status: "degraded", rationale: "t", confidence: 1 },
      ack_required: true,
    } as unknown as OttoQCommand;
  }

  it("refuses a discharge declaring a floor below the shield's own", () => {
    const r = applyShield([bess("discharge_bess", { power_kw: -400, soc_bound_pct: 5 })],
      { bundle: bundleWith({ dr: false }), openCommands: new Map() });
    expect(r.admitted).toHaveLength(0);
    expect(r.suppressed[0].detail).toContain("below the shield's");
  });

  it("refuses an unbounded discharge outright", () => {
    const r = applyShield([bess("discharge_bess", { power_kw: -400 })],
      { bundle: bundleWith({ dr: false }), openCommands: new Map() });
    expect(r.admitted).toHaveLength(0);
    expect(r.suppressed[0].detail).toContain("unbounded discharge");
  });

  it("still admits a discharge that respects the floor", () => {
    const r = applyShield([bess("discharge_bess", { power_kw: -400, soc_bound_pct: 20 })],
      { bundle: bundleWith({ dr: false }), openCommands: new Map() });
    expect(r.admitted).toHaveLength(1);
  });
});
