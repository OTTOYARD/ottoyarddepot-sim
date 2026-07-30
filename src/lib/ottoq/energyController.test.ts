import { describe, it, expect } from "vitest";
import { SiteEnergyController } from "./energyController";

const T0 = "2026-07-27T14:00:00.000Z";
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();

/** Advance the controller in 1s slices so the ramp integrates realistically. */
function advance(c: SiteEnergyController, fromS: number, toS: number, tempC: number | null = null) {
  for (let t = fromS; t <= toS; t++) c.step(at(t), tempC);
}

describe("SiteEnergyController — accepting directives", () => {
  it("accepts a well-formed discharge", () => {
    const c = new SiteEnergyController(60);
    expect(c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    })).toBe(true);
  });

  it("refuses a charge that asks for negative power", () => {
    const c = new SiteEnergyController(60);
    const r = c.accept({
      command_id: "c1", intent: "charge_bess",
      params: { power_kw: -250 }, not_before_sim: null, not_after_sim: null,
    });
    expect(r).toContain("charging requires positive power");
  });

  it("refuses a discharge that asks for positive power", () => {
    const c = new SiteEnergyController(60);
    expect(c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: 400 }, not_before_sim: null, not_after_sim: null,
    })).toContain("discharging requires negative power");
  });

  it("refuses to discharge a battery at the hard floor, whatever the command says", () => {
    const c = new SiteEnergyController(10);
    expect(c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 5 },
      not_before_sim: null, not_after_sim: null,
    })).toContain("hard floor");
  });

  it("refuses to charge a full battery", () => {
    const c = new SiteEnergyController(98);
    expect(c.accept({
      command_id: "c1", intent: "charge_bess",
      params: { power_kw: 250 }, not_before_sim: null, not_after_sim: null,
    })).toContain("hard ceiling");
  });

  it("refuses a command with no power at all", () => {
    const c = new SiteEnergyController(60);
    expect(c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: {}, not_before_sim: null, not_after_sim: null,
    })).toContain("no power_kw");
  });
});

describe("SiteEnergyController — the controller owns the ramp", () => {
  it("does not jump to the commanded power instantly", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    advance(c, 0, 1);
    // one second at 30 kW/s, not the full 400
    expect(Math.abs(c.state.actualKw)).toBeLessThanOrEqual(31);
    expect(Math.abs(c.state.actualKw)).toBeGreaterThan(0);
  });

  it("reaches the commanded power after ramping", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    advance(c, 0, 20);
    expect(c.state.actualKw).toBeCloseTo(-400, 0);
  });

  it("honours a start delay — 'discharge in 20 minutes' waits 20 minutes", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400 },
      not_before_sim: at(1200), not_after_sim: at(3600),
    });
    advance(c, 0, 60);
    expect(c.state.actualKw).toBe(0);
    advance(c, 1200, 1230);
    expect(Math.abs(c.state.actualKw)).toBeGreaterThan(100);
  });
});

describe("SiteEnergyController — physics outrank policy", () => {
  it("stops at the state-of-charge bound the command declared", () => {
    const c = new SiteEnergyController(21, { capacityKwh: 50 }); // tiny pack, drains fast
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    advance(c, 0, 120);
    expect(c.state.socPct).toBeGreaterThanOrEqual(20);
    const done = c.drainOutcomes();
    expect(done.some((o) => o.reason?.includes("discharge bound"))).toBe(true);
  });

  it("never sails past a declared bound, not even while ramping down", () => {
    // Regression: power cannot stop instantly, so a discharge that ended exactly
    // AT the floor kept draining all the way down the ramp. A command saying
    // "not below 20%" got 19%. The controller now anticipates its own stopping
    // distance and holds the bound until power is actually back at zero.
    const c = new SiteEnergyController(24, { capacityKwh: 60 });
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -450, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    let worst = 100;
    for (let t = 0; t <= 400; t++) {
      c.step(at(t));
      worst = Math.min(worst, c.state.socPct);
    }
    expect(worst).toBeGreaterThanOrEqual(20);
    expect(c.state.actualKw).toBeCloseTo(0, 1);
  });

  it("releases the bound guard so it cannot constrain the next directive", () => {
    const c = new SiteEnergyController(25, { capacityKwh: 60 });
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    advance(c, 0, 300);
    c.drainOutcomes();
    // now charge back up well past where the old floor sat
    c.accept({
      command_id: "c2", intent: "charge_bess",
      params: { power_kw: 400, soc_bound_pct: 60 },
      not_before_sim: null, not_after_sim: at(7200),
    });
    advance(c, 301, 800);
    expect(c.state.socPct).toBeGreaterThan(30);
  });

  it("derates on a hot pack and says so instead of silently under-delivering", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    advance(c, 0, 30, 50); // 10°C over the derate threshold
    expect(Math.abs(c.state.actualKw)).toBeLessThan(400);
    expect(c.state.derateReason).toContain("derated");
  });

  it("actually drains the battery, so the next world frame reflects the decision", () => {
    const c = new SiteEnergyController(80, { capacityKwh: 500 });
    const before = c.state.socPct;
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -400, soc_bound_pct: 20 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    advance(c, 0, 300);
    expect(c.state.socPct).toBeLessThan(before);
  });

  it("charging stores less than it draws (round-trip efficiency)", () => {
    const c = new SiteEnergyController(50, { capacityKwh: 100, chargeEfficiency: 0.9 });
    c.accept({
      command_id: "c1", intent: "charge_bess",
      params: { power_kw: 360, soc_bound_pct: 95 },
      not_before_sim: null, not_after_sim: at(3600),
    });
    advance(c, 0, 100);
    // 360kW for ~100s ≈ 10 kWh drawn; at 90% that is 9 kWh stored = 9% of 100kWh.
    // Ramp-up costs a little, so assert the band rather than a point.
    const gained = c.state.socPct - 50;
    expect(gained).toBeGreaterThan(5);
    expect(gained).toBeLessThan(9.5);
  });
});

describe("SiteEnergyController — arbitration and curtailment", () => {
  it("one battery directive at a time; the old one is closed, never left dangling", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "old", intent: "discharge_bess",
      params: { power_kw: -400 }, not_before_sim: null, not_after_sim: at(3600),
    });
    c.accept({
      command_id: "new", intent: "charge_bess",
      params: { power_kw: 250 }, not_before_sim: null, not_after_sim: at(3600),
    });
    const outcomes = c.drainOutcomes();
    expect(outcomes.find((o) => o.command_id === "old")?.reason).toContain("superseded by new");
    expect(c.state.activeCommandId).toBe("new");
  });

  it("curtailment is a ceiling, not a battery action — it does not displace a directive", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "batt", intent: "discharge_bess",
      params: { power_kw: -400 }, not_before_sim: null, not_after_sim: at(3600),
    });
    expect(c.accept({
      command_id: "cap", intent: "curtail_site",
      params: { site_cap_kw: 500 }, not_before_sim: null, not_after_sim: null,
    })).toBe(true);
    expect(c.state.siteCapKw).toBe(500);
    expect(c.state.activeCommandId).toBe("batt");
  });

  it("refuses a curtailment that would be a shutdown", () => {
    const c = new SiteEnergyController(60);
    expect(c.accept({
      command_id: "cap", intent: "curtail_site",
      params: { site_cap_kw: 0 }, not_before_sim: null, not_after_sim: null,
    })).toContain("shutdown");
  });

  it("refuses to release a curtailment that was never in force", () => {
    const c = new SiteEnergyController(60);
    expect(c.accept({
      command_id: "rel", intent: "release_curtailment",
      params: {}, not_before_sim: null, not_after_sim: null,
    })).toContain("no curtailment is in force");
  });

  it("closes a directive that runs its full window", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -100 }, not_before_sim: null, not_after_sim: at(30),
    });
    advance(c, 0, 40);
    const done = c.drainOutcomes();
    expect(done.find((o) => o.command_id === "c1")?.status).toBe("completed");
    expect(c.state.activeCommandId).toBeNull();
  });

  it("ramps back to zero once nothing is commanded", () => {
    const c = new SiteEnergyController(60);
    c.accept({
      command_id: "c1", intent: "discharge_bess",
      params: { power_kw: -300 }, not_before_sim: null, not_after_sim: at(30),
    });
    advance(c, 0, 30);
    advance(c, 31, 80);
    expect(c.state.actualKw).toBeCloseTo(0, 1);
  });
});
