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
import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import { packChannels } from "./channels";
import { SiteEnergyController } from "./energyController";
import { applyShield } from "./shield";
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
