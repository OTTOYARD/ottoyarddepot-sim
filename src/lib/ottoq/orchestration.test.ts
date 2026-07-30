import { describe, it, expect } from "vitest";
import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import { packChannels } from "./channels";
import type { ChannelBundle } from "./contracts";
import {
  commandId, findActuationFields, simPlus,
  type CommandAck, type CommandBatch, type CommandRecord, type OttoQCommand,
} from "./commands";
import { applyShield, DEFAULT_SHIELD_CONFIG } from "./shield";
import { arbitrate, runPipeline, type Advisor, type Proposal } from "./pipeline";
import { chargeAssignmentAdvisor, chargerHealthAdvisor, energyAdvisor } from "./advisors";
import { CommandBus, twinExecutor } from "./commandBus";

const CLOCK = "2026-07-27T14:00:00.000Z";

// ── fixtures ────────────────────────────────────────────────────────────────

function layout(): TwinLayout {
  return {
    depot: { id: "depot-1", name: "Nashville", origin_lat: 36.1, origin_lng: -86.7 },
    structures: [],
    stalls: [
      { id: "d0", code: "D-00", type: "dcfc", zone: "n", canopy: null, covered: null, x: 0, y: 0, heading: 0, connector_kw: 350 },
      { id: "d1", code: "D-01", type: "dcfc", zone: "n", canopy: null, covered: null, x: 1, y: 0, heading: 0, connector_kw: 350 },
      { id: "l0", code: "L-00", type: "l2", zone: "s", canopy: null, covered: null, x: 2, y: 0, heading: 0, connector_kw: 19.2 },
      { id: "l1", code: "L-01", type: "l2", zone: "s", canopy: null, covered: null, x: 3, y: 0, heading: 0, connector_kw: 19.2 },
      { id: "w0", code: "W-00", type: "wash", zone: "s", canopy: null, covered: null, x: 4, y: 0, heading: 0, connector_kw: null },
    ],
  };
}

interface WorldOpts {
  vehicles?: { id: string; state: string; soc: number | null; stall?: string | null }[];
  stallStatus?: { id: string; status: string; vehicle_id: string | null }[];
  lmp?: number | null;
  bessSoc?: number | null;
  drActive?: boolean;
  drCapKw?: number | null;
  evKw?: number;
  buildingKw?: number;
  peakKw?: number | null;
  solarKw?: number;
  /** drop the WHOLE energy channel (site + bess + grid) so it packs as missing */
  dropEnergy?: boolean;
}

function world(o: WorldOpts = {}): ChannelBundle {
  const vehicles = o.vehicles ?? [
    { id: "v1", state: "arrived_at_gate", soc: 12 },
    { id: "v2", state: "staged_awaiting_service", soc: 48 },
  ];
  const snap = {
    run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v) => ({
        id: v.id, av_id: `AV-${v.id}`, make: "waymo", platform: "jag",
        state: v.state, soc: v.soc, stall_id: v.stall ?? null,
      })),
    },
    stalls_status: o.stallStatus ?? [],
    energy: o.dropEnergy ? null : {
      grid_import_kw: 400, grid_export_kw: 0, solar_kw: o.solarKw ?? 100,
      bess_output_kw: 0, ev_charging_kw: o.evKw ?? 300, building_kw: o.buildingKw ?? 150,
      peak_15min_kw: o.peakKw === undefined ? 600 : o.peakKw,
      tariff: "GSA-3", rate_per_kwh: 0.0875, at: CLOCK,
    },
    bess: o.dropEnergy ? null : { soc_pct: o.bessSoc === undefined ? 60 : o.bessSoc, power_kw: 0, state: "idle", temp_c: 25, soh_pct: 97 },
    weather: { temp_c: 30, cloud_pct: 10, conditions: "clear", precip: "none", ghi_wm2: 700, wind_kmh: 8, solar_elev_deg: 55, at: CLOCK },
    grid: o.dropEnergy ? null : {
      lmp_usd_mwh: o.lmp === undefined ? 40 : o.lmp, tariff: "GSA-3", carbon_gco2_kwh: 370,
      voltage_status: "nominal", frequency_hz: 60, reserve_margin_pct: 15,
      dr_active: o.drActive ?? false, dr_cap_kw: o.drCapKw ?? null, at: CLOCK,
    },
    counters: { dispatches_active: 2, dispatches_total: 9, telemetry_packets: 40, charge_sessions: 3, events_total: 20, open_incidents: 0 },
    recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
  return packChannels(snap, layout(), new Date(CLOCK));
}

function cmd(over: Partial<OttoQCommand> = {}): OttoQCommand {
  const target = over.target ?? { kind: "vehicle" as const, id: "v1", label: "AV-v1" };
  const intent = over.intent ?? "assign_stall";
  return {
    command_id: commandId("run-1", 12, target, intent),
    contract_version: "1.0.0",
    command_class: "vehicle.orchestration",
    intent, authority: "advisory",
    sim_run_id: "run-1", tick: 12, issued_sim: CLOCK, issued_at: CLOCK, sequence: 0,
    target,
    window: { not_before_sim: CLOCK, not_after_sim: simPlus(CLOCK, 900), expires_sim: simPlus(CLOCK, 1800)! },
    params: { stall_id: "d0", service: "dcfc_charge", target_soc_pct: 90 },
    priority: 500,
    correlation_id: "plan_run-1_t12",
    provenance: {
      advisor: "test", layers: ["L3:test", "L2:arbiter", "L1:shield"],
      input_tick: 12, input_contract_version: "1.0.0", input_bundle_status: "degraded",
      rationale: "test", confidence: 1,
    },
    ack_required: true,
    ...over,
  };
}

const noOpen = () => new Map<string, CommandRecord>();

// ── doctrine ────────────────────────────────────────────────────────────────

describe("actuation doctrine", () => {
  it("finds forbidden actuation fields at any depth", () => {
    expect(findActuationFields({ stall_id: "d0" })).toEqual([]);
    expect(findActuationFields({ waypoint: { x: 1, y: 2 } }))
      .toEqual(expect.arrayContaining(["params.waypoint", "params.waypoint.x", "params.waypoint.y"]));
    expect(findActuationFields({ plan: [{ heading: 1.2 }] })).toContain("params.plan[0].heading");
  });

  it("the shield removes any command that tries to actuate", () => {
    const r = applyShield(
      [cmd({ params: { stall_id: "d0", speed_kmh: 12 } as never })],
      { bundle: world(), openCommands: noOpen() },
    );
    expect(r.admitted).toHaveLength(0);
    expect(r.suppressed[0].rule).toBe("no_actuation");
    expect(r.suppressed[0].detail).toContain("does not actuate");
  });
});

// ── shield ──────────────────────────────────────────────────────────────────

describe("L1 shield", () => {
  it("admits a well-formed command against a healthy world", () => {
    const r = applyShield([cmd()], { bundle: world(), openCommands: noOpen() });
    expect(r.admitted).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  it("vetoes the entire batch when the world is not_ready", () => {
    const r = applyShield([cmd()], { bundle: world({ dropEnergy: true }), openCommands: noOpen() });
    expect(r.vetoedAll).toBe(true);
    expect(r.admitted).toHaveLength(0);
    expect(r.suppressed[0].rule).toBe("stale_world");
  });

  it("refuses a stall already occupied by another vehicle", () => {
    const b = world({ stallStatus: [{ id: "d0", status: "charging", vehicle_id: "vX" }] });
    const r = applyShield([cmd()], { bundle: b, openCommands: noOpen() });
    expect(r.suppressed[0].rule).toBe("stall_exists_and_is_free");
    expect(r.suppressed[0].detail).toContain("occupied by vX");
  });

  it("gives a contested stall to the higher-priority command and reports the other", () => {
    const a = cmd({ target: { kind: "vehicle", id: "v1" }, priority: 900 });
    const b = cmd({ target: { kind: "vehicle", id: "v2" }, priority: 100 });
    const r = applyShield([b, a], { bundle: world(), openCommands: noOpen() });
    expect(r.admitted).toHaveLength(1);
    expect(r.admitted[0].target.id).toBe("v1");
    expect(r.suppressed[0].detail).toContain("already assigned to v1");
  });

  it("refuses a second open command for the same target", () => {
    const open = new Map<string, CommandRecord>([
      ["prior", { command: cmd({ command_id: "prior" }), status: "accepted", history: [], ack: null, outcome: null }],
    ]);
    const r = applyShield([cmd({ intent: "hold" })], { bundle: world(), openCommands: open });
    expect(r.suppressed[0].rule).toBe("target_not_saturated");
  });

  it("refuses to discharge a battery at the floor", () => {
    const c = cmd({
      intent: "discharge_bess", command_class: "energy.orchestration",
      target: { kind: "bess", id: "site_bess" }, params: { power_kw: -400 },
    });
    const r = applyShield([c], { bundle: world({ bessSoc: 10 }), openCommands: noOpen() });
    expect(r.suppressed[0].rule).toBe("bess_soc_bounds");
    expect(r.suppressed[0].detail).toContain("discharge floor");
  });

  it("refuses to charge the battery from the grid during a DR call", () => {
    const c = cmd({
      intent: "charge_bess", command_class: "energy.orchestration",
      target: { kind: "bess", id: "site_bess" }, params: { power_kw: 250 },
    });
    const b = world({ drActive: true, drCapKw: 400, solarKw: 50 });
    const r = applyShield([c], { bundle: b, openCommands: noOpen() });
    expect(r.suppressed[0].rule).toBe("respects_dr_cap");
  });

  it("allows charging from solar surplus even during a DR call", () => {
    const c = cmd({
      intent: "charge_bess", command_class: "energy.orchestration",
      target: { kind: "bess", id: "site_bess" }, params: { power_kw: 100 },
    });
    const b = world({ drActive: true, drCapKw: 400, solarKw: 300 });
    expect(applyShield([c], { bundle: b, openCommands: noOpen() }).admitted).toHaveLength(1);
  });

  it("refuses a curtailment cap of zero", () => {
    const c = cmd({
      intent: "curtail_site", command_class: "energy.orchestration",
      target: { kind: "site", id: "run-1" }, params: { site_cap_kw: 0 },
    });
    const r = applyShield([c], { bundle: world(), openCommands: noOpen() });
    expect(r.suppressed[0].detail).toContain("full site shutdown");
  });

  it("refuses a charger ceiling above the hardware rating", () => {
    const c = cmd({
      intent: "set_power_ceiling", command_class: "charger.orchestration",
      target: { kind: "charger", id: "l0" }, params: { power_ceiling_kw: 200 },
    });
    const r = applyShield([c], { bundle: world(), openCommands: noOpen() });
    expect(r.suppressed[0].rule).toBe("ceiling_within_rating");
  });

  it("refuses a window that ends before it begins", () => {
    const c = cmd({
      window: { not_before_sim: simPlus(CLOCK, 600), not_after_sim: CLOCK, expires_sim: simPlus(CLOCK, 1800)! },
    });
    const r = applyShield([c], { bundle: world(), openCommands: noOpen() });
    expect(r.suppressed[0].rule).toBe("window_sane");
  });

  it("refuses an implausibly large batch outright", () => {
    const many = Array.from({ length: DEFAULT_SHIELD_CONFIG.maxBatchSize + 1 }, (_, i) =>
      cmd({ target: { kind: "vehicle", id: `v${i}` } }));
    const r = applyShield(many, { bundle: world(), openCommands: noOpen() });
    expect(r.vetoedAll).toBe(true);
    expect(r.suppressed[0].rule).toBe("batch_too_large");
  });

  it("never invents a command", () => {
    const input = [cmd(), cmd({ target: { kind: "vehicle", id: "v2" }, params: { stall_id: "d1", service: "dcfc_charge" } })];
    const r = applyShield(input, { bundle: world(), openCommands: noOpen() });
    expect(r.admitted.length).toBeLessThanOrEqual(input.length);
    for (const a of r.admitted) expect(input).toContain(a); // identity, not a copy
  });
});

// ── advisors ────────────────────────────────────────────────────────────────

describe("energy advisor", () => {
  const run = (b: ChannelBundle) => energyAdvisor().propose(b, { openCommands: noOpen(), simClock: CLOCK }) as Proposal[];

  it("charges when power is cheap", () => {
    const p = run(world({ lmp: 15 }));
    expect(p[0].intent).toBe("charge_bess");
    expect((p[0].params as { signal_reason: string }).signal_reason).toBe("price_low");
    expect(p[0].rationale).toContain("start pulling");
  });

  it("discharges when power is expensive", () => {
    const p = run(world({ lmp: 90 }));
    expect(p[0].intent).toBe("discharge_bess");
    expect((p[0].params as { power_kw: number }).power_kw).toBeLessThan(0);
  });

  it("schedules a pre-emptive discharge 20 minutes out on high demand at an ordinary price", () => {
    const p = run(world({ lmp: 40, evKw: 400, buildingKw: 150, peakKw: 600 }));
    expect(p[0].intent).toBe("discharge_bess");
    expect(p[0].start_offset_s).toBe(20 * 60);
    expect(p[0].rationale).toContain("discharge in 20 minutes");
  });

  it("puts demand-response compliance above price", () => {
    const p = run(world({ lmp: 5, drActive: true, drCapKw: 400 }));
    expect(p.map((x) => x.intent)).toEqual(["discharge_bess", "curtail_site"]);
    expect(p.every((x) => x.score >= 990)).toBe(true);
  });

  it("rebuilds reserve below the floor regardless of price", () => {
    const p = run(world({ lmp: 95, bessSoc: 20 }));
    expect(p[0].intent).toBe("charge_bess");
    expect((p[0].params as { signal_reason: string }).signal_reason).toBe("reserve_build");
  });

  it("says nothing when the battery state of charge is unknown", () => {
    expect(run(world({ bessSoc: null }))).toHaveLength(0);
  });

  it("never emits an actuation field", () => {
    for (const b of [world({ lmp: 10 }), world({ lmp: 90 }), world({ drActive: true, drCapKw: 300 })]) {
      for (const p of run(b)) expect(findActuationFields(p.params)).toEqual([]);
    }
  });
});

describe("charge assignment advisor", () => {
  const run = (b: ChannelBundle) => chargeAssignmentAdvisor().propose(b, { openCommands: noOpen(), simClock: CLOCK }) as Proposal[];

  it("sends the most depleted vehicle to a fast charger", () => {
    const p = run(world());
    const urgent = p.find((x) => x.target.id === "v1")!;
    expect((urgent.params as { stall_id: string }).stall_id).toMatch(/^d/);
    expect(urgent.score).toBeGreaterThan(p.find((x) => x.target.id === "v2")!.score);
  });

  it("leaves fast chargers for who needs them", () => {
    const p = run(world());
    expect((p.find((x) => x.target.id === "v2")!.params as { stall_id: string }).stall_id).toMatch(/^l/);
  });

  it("never proposes the same stall twice", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, state: "staged_awaiting_service", soc: 10 + i }));
    const stalls = run(world({ vehicles: many })).map((x) => (x.params as { stall_id: string }).stall_id);
    expect(new Set(stalls).size).toBe(stalls.length);
  });

  it("stays silent rather than queueing noise when the depot is full", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, state: "staged_awaiting_service", soc: 20 }));
    expect(run(world({ vehicles: many })).length).toBeLessThanOrEqual(4); // 2 dcfc + 2 l2
  });

  it("ignores vehicles that are not waiting", () => {
    expect(run(world({ vehicles: [{ id: "v9", state: "charging_dcfc", soc: 10, stall: "d0" }] }))).toHaveLength(0);
  });
});

describe("charger health advisor", () => {
  it("quarantines a faulted charger but not one with a live session", () => {
    const b = world({
      stallStatus: [
        { id: "d0", status: "faulted", vehicle_id: null },
        { id: "d1", status: "faulted", vehicle_id: "v5" },
      ],
    });
    const p = chargerHealthAdvisor().propose(b, { openCommands: noOpen(), simClock: CLOCK }) as Proposal[];
    expect(p).toHaveLength(1);
    expect(p[0].target.id).toBe("d0");
  });
});

// ── arbiter ─────────────────────────────────────────────────────────────────

describe("L2 arbiter", () => {
  const proposal = (over: Partial<Proposal> & { advisor?: string } = {}): Proposal => ({
    intent: "assign_stall",
    target: { kind: "vehicle", id: "v1" },
    params: { stall_id: "d0" },
    score: 100, rationale: "test", ...over,
  });

  it("gives a contested stall to the higher-scoring proposal", () => {
    const r = arbitrate(
      [
        { advisor: "a", proposal: proposal({ score: 50 }) },
        { advisor: "b", proposal: proposal({ target: { kind: "vehicle", id: "v2" }, score: 400 }) },
      ],
      world(), 0,
    );
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].target.id).toBe("v2");
    expect(r.dropped[0].rule).toBe("arbiter:stall_contention");
  });

  it("discounts a high score that carries low confidence", () => {
    const r = arbitrate(
      [
        { advisor: "a", proposal: proposal({ score: 1000, confidence: 0.1 }) },
        { advisor: "b", proposal: proposal({ target: { kind: "vehicle", id: "v2" }, score: 200, confidence: 1 }) },
      ],
      world(), 0,
    );
    expect(r.candidates[0].target.id).toBe("v2");
  });

  it("is deterministic regardless of proposal arrival order", () => {
    const items = [
      { advisor: "z", proposal: proposal({ target: { kind: "vehicle" as const, id: "v2" }, params: { stall_id: "d1" }, score: 100 }) },
      { advisor: "a", proposal: proposal({ score: 100 }) },
    ];
    const forward = arbitrate(items, world(), 0).candidates.map((c) => c.command_id);
    const reverse = arbitrate([...items].reverse(), world(), 0).candidates.map((c) => c.command_id);
    expect(forward).toEqual(reverse);
  });

  it("stamps the full chain of custody on every command", () => {
    const r = arbitrate([{ advisor: "cuopt", proposal: proposal() }], world(), 7);
    const c = r.candidates[0];
    expect(c.provenance.layers).toEqual(["L3:cuopt", "L2:arbiter", "L1:shield"]);
    expect(c.provenance.input_tick).toBe(12);
    expect(c.provenance.input_bundle_status).toBe("degraded");
    expect(c.sequence).toBe(7);
  });

  it("gives an expiry that outlasts the requested window", () => {
    const r = arbitrate([{ advisor: "a", proposal: proposal({ duration_s: 3 * 3600 }) }], world(), 0);
    const w = r.candidates[0].window;
    expect(Date.parse(w.expires_sim)).toBeGreaterThanOrEqual(Date.parse(w.not_after_sim!));
  });
});

// ── the full funnel ─────────────────────────────────────────────────────────

describe("pipeline", () => {
  const advisors = [energyAdvisor(), chargerHealthAdvisor(), chargeAssignmentAdvisor()];

  it("runs L3 to L0 and emits one batch", async () => {
    const r = await runPipeline({ advisors, bundle: world({ lmp: 10 }), openCommands: noOpen(), sequenceStart: 0 });
    expect(r.batch.commands.length).toBeGreaterThan(0);
    expect(r.trace).toHaveLength(4);
    expect(r.trace[0]).toContain("L3 advisors");
    expect(r.trace[3]).toContain("L0 batch");
  });

  it("survives an advisor that throws", async () => {
    const broken: Advisor = { id: "broken", description: "x", propose: () => { throw new Error("solver down"); } };
    const r = await runPipeline({
      advisors: [broken, ...advisors], bundle: world({ lmp: 10 }), openCommands: noOpen(), sequenceStart: 0,
    });
    expect(r.advisorRuns.find((a) => a.advisor === "broken")?.status).toBe("failed");
    expect(r.batch.commands.length).toBeGreaterThan(0);
  });

  it("records an advisor that blows its time budget as a timeout", async () => {
    const slow: Advisor = {
      id: "slow", description: "x",
      propose: () => new Promise((res) => setTimeout(() => res([]), 50)),
    };
    const r = await runPipeline({
      advisors: [slow], bundle: world(), openCommands: noOpen(), sequenceStart: 0, advisorTimeoutMs: 5,
    });
    expect(r.advisorRuns[0].status).toBe("timeout");
  });

  it("emits nothing but explains itself when the world is not_ready", async () => {
    const r = await runPipeline({
      advisors, bundle: world({ dropEnergy: true }), openCommands: noOpen(), sequenceStart: 0,
    });
    expect(r.batch.commands).toHaveLength(0);
    expect(r.shield.vetoedAll).toBe(true);
    expect(r.batch.suppressed.length).toBeGreaterThan(0);
  });

  it("carries suppressions from both the arbiter and the shield", async () => {
    const greedy: Advisor = {
      id: "greedy", description: "wants everything",
      propose: () => [
        { intent: "assign_stall", target: { kind: "vehicle", id: "v1" }, params: { stall_id: "d0" }, score: 10, rationale: "low" },
        { intent: "assign_stall", target: { kind: "vehicle", id: "vGHOST" }, params: { stall_id: "d1" }, score: 900, rationale: "ghost" },
      ],
    };
    const r = await runPipeline({ advisors: [greedy], bundle: world(), openCommands: noOpen(), sequenceStart: 0 });
    expect(r.batch.suppressed.some((s) => s.rule === "vehicle_exists")).toBe(true);
  });

  it("produces identical output for identical input", async () => {
    const a = await runPipeline({ advisors, bundle: world({ lmp: 10 }), openCommands: noOpen(), sequenceStart: 0 });
    const b = await runPipeline({ advisors, bundle: world({ lmp: 10 }), openCommands: noOpen(), sequenceStart: 0 });
    expect(a.batch.commands.map((c) => c.command_id)).toEqual(b.batch.commands.map((c) => c.command_id));
  });
});

// ── the wire ────────────────────────────────────────────────────────────────

describe("command bus", () => {
  const accepting = twinExecutor({
    vehicle: () => true, energy: () => true, charger: () => true, depot: () => true,
  });

  async function batchOf(bundle = world({ lmp: 10 })): Promise<CommandBatch> {
    const r = await runPipeline({
      advisors: [energyAdvisor(), chargeAssignmentAdvisor()],
      bundle, openCommands: noOpen(), sequenceStart: 0,
    });
    return r.batch;
  }

  it("records every command it sends and every ack it gets", async () => {
    const bus = new CommandBus(accepting);
    const res = await bus.transmit(await batchOf());
    expect(res.sent).toBeGreaterThan(0);
    expect(res.accepted).toBe(res.sent);
    expect(res.unacknowledged).toBe(0);
    expect(bus.stats().byStatus.accepted).toBe(res.sent);
  });

  it("is idempotent — redelivering the same batch sends nothing twice", async () => {
    const bus = new CommandBus(accepting);
    const batch = await batchOf();
    await bus.transmit(batch);
    const second = await bus.transmit(batch);
    expect(second.sent).toBe(0);
    expect(bus.stats().total).toBe(batch.commands.length);
  });

  it("keeps commands pending when the transport fails", async () => {
    const bus = new CommandBus({ id: "flaky", deliver: async () => { throw new Error("network down"); } });
    const res = await bus.transmit(await batchOf());
    expect(res.transportError).toContain("network down");
    expect(res.unacknowledged).toBe(res.sent);
    expect(bus.openCommands.size).toBe(res.sent);
  });

  it("counts commands the executor never answered", async () => {
    const silent = twinExecutor({});
    const partial: typeof silent = { id: "partial", deliver: async () => [] };
    const bus = new CommandBus(partial);
    const res = await bus.transmit(await batchOf());
    expect(res.unacknowledged).toBe(res.sent);
  });

  it("rejects with a reason when no subscriber exists for a class", async () => {
    const bus = new CommandBus(twinExecutor({ vehicle: () => true })); // no energy subscriber
    const res = await bus.transmit(await batchOf());
    expect(res.rejected).toBeGreaterThan(0);
    const energyRec = bus.ledger.find((r) => r.command.command_class === "energy.orchestration");
    expect(energyRec?.status).toBe("rejected");
    expect(energyRec?.ack?.reason).toContain("energy controller");
  });

  it("treats terminal states as final — a late ack cannot resurrect a command", async () => {
    const bus = new CommandBus(accepting);
    const batch = await batchOf();
    await bus.transmit(batch);
    const id = batch.commands[0].command_id;
    bus.complete({ command_id: id, status: "completed", executor: "twin", at_sim: CLOCK });
    bus.markExecuting(id, CLOCK);
    expect(bus.ledger.find((r) => r.command.command_id === id)?.status).toBe("completed");
  });

  it("expires commands whose window has closed", async () => {
    const bus = new CommandBus(accepting);
    const batch = await batchOf();
    await bus.transmit(batch);
    const expired = bus.expireStale(simPlus(CLOCK, 24 * 3600));
    expect(expired).toBe(batch.commands.length);
    expect(bus.openCommands.size).toBe(0);
  });

  it("detects a gap in the sequence — a lost command is not a quiet tick", async () => {
    const bus = new CommandBus(accepting);
    const batch = await batchOf();
    // simulate the first command never reaching the bus
    await bus.transmit({ ...batch, commands: batch.commands.slice(1) });
    if (batch.commands.length > 1) expect(bus.stats().sequenceGaps).toContain(0);
  });

  it("ignores an ack for a command it never sent", async () => {
    const liar: typeof accepting = {
      id: "liar",
      deliver: async () => [{ command_id: "not_ours", status: "accepted", executor: "liar", at_sim: CLOCK } as CommandAck],
    };
    const bus = new CommandBus(liar);
    const res = await bus.transmit(await batchOf());
    expect(res.accepted).toBe(0);
    expect(bus.ledger.every((r) => r.command.command_id !== "not_ours")).toBe(true);
  });

  it("hands the shield its open commands so the next tick does not pile on", async () => {
    const bus = new CommandBus(accepting);
    const bundle = world({ lmp: 10 });
    await bus.transmit(await batchOf(bundle));
    const second = await runPipeline({
      advisors: [energyAdvisor(), chargeAssignmentAdvisor()],
      bundle, openCommands: bus.openCommands, sequenceStart: bus.sequenceStart,
    });
    expect(second.shield.suppressed.some((s) => s.rule === "target_not_saturated")).toBe(true);
  });
});
