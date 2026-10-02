// background.test.ts — the Background tab's shaping, over the engine's own rows as read on 2026-10-02 21:11 UTC
// (src/components/tabs/__fixtures__/background.2026-10-02.json: the calibration registry, feed plans, variability
// catalog, intelligence ledger, rule catalog, shield posture, determinism canon, twin-depot tariff and vehicle classes).
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/background.2026-10-02.json";
import valueFx from "@/components/tabs/__fixtures__/valueSummary.example.json";
import {
  canonSummary, dataSources, dayCT, feedRecipes, fleetModels, fmtInt, humanVar, measuredLines, monthYear,
  provenanceKind, providerFacts, shieldSummary, variableGroups,
  type CalibrationDatasetRow, type CanonRow, type CatalogRow, type DistributionRow, type FeedPlanRow, type LedgerRow,
  type PostureRow, type RuleRow, type VehicleClassRow,
} from "./background";
import { readValueSummary } from "./valueSummary";

const datasets = fx.datasets as unknown as CalibrationDatasetRow[];
const dists = fx.distributions as unknown as DistributionRow[];

describe("data sources", () => {
  it("labels how each source reached the twin from what its own row says, not from the method alone", () => {
    const kinds = Object.fromEntries(datasets.map((d) => [d.dataset_code, provenanceKind(d)]));
    expect(kinds).toEqual({
      nyc_tlc: "raw_records",              // 3.5M trips ingested
      acn_data: "raw_records",             // 4,000 real sessions
      nrel_fleet: "published_statistics",  // filed as file_download, but "Encoded from ... published aggregate statistics"
      eia_grid: "live_api",
      ca_dmv_av: "published_statistics",   // filed as file_download, but encoded from published report aggregates
      charger_reliability: "published_statistics",
      ghcn_daily_bna: "computed",          // computed directly from 10,956 QC-filtered observations
      noaa_normals_1991_2020: "published_statistics",
      noaa_nws: "live_api",
    });
  });

  it("lists every ingested source in domain order, with its link, period and what was fitted from it", () => {
    const s = dataSources(datasets, dists);
    expect(s.map((x) => x.code)).toEqual([
      "nyc_tlc", "acn_data", "nrel_fleet", "eia_grid", "ca_dmv_av", "charger_reliability",
      "ghcn_daily_bna", "noaa_normals_1991_2020", "noaa_nws",
    ]);
    const acn = s.find((x) => x.code === "acn_data")!;
    expect(acn.url).toBe("https://ev.caltech.edu/dataset");
    expect(acn.period).toBe("Apr 2018 to Jul 2018");
    expect(acn.records).toBe(4000);
    expect(acn.fitted).toEqual(["charge duration (minutes)", "dwell time (minutes)", "energy delivered (kWh)"]);
    expect(s.find((x) => x.code === "noaa_nws")!.fitted).toEqual(["ambient temperature (°C)", "precip (mm)", "wind speed (km/h)"]);
    for (const x of s) expect(x.url === null || x.url.startsWith("https://")).toBe(true);
  });

  it("keeps a recipe's own sources and flags the one that calls itself an assumption", () => {
    const r = feedRecipes(fx.feed_plans as unknown as FeedPlanRow[]);
    expect(r.map((x) => x.varKey).sort()).toEqual([
      "ambient_temp_c", "charger_fault_repair", "lmp_usd_mwh", "precip_unified", "service_manifest", "tariff_demand_charge",
    ]);
    // the service recipe is an assumption as a whole; the others each declare their assumptions by name
    expect(r.filter((x) => x.wholeAssumption).map((x) => x.varKey)).toEqual(["service_manifest"]);
    const rain = r.find((x) => x.varKey === "precip_unified")!;
    expect(rain.assumptions.map((a) => a.name)).toContain("hourly disaggregation");
    expect(Object.fromEntries(r.map((x) => [x.varKey, x.assumptions.length]))).toEqual({
      ambient_temp_c: 0, charger_fault_repair: 2, lmp_usd_mwh: 4, precip_unified: 2, service_manifest: 0, tariff_demand_charge: 0,
    });
    expect(r.find((x) => x.varKey === "lmp_usd_mwh")!.sourceType).toBe("computed from primary market data");
    const tariff = r.find((x) => x.varKey === "tariff_demand_charge")!;
    expect(tariff.sources[0]).toMatch(/^https:\/\/www\.nespower\.com\//);
    expect(r.find((x) => x.varKey === "lmp_usd_mwh")!.corpus).toMatch(/MISO DA ex-post LMP/);
    for (const x of r) for (const u of x.sources) expect(u.startsWith("https://")).toBe(true);
  });

  it("names the production AV models and leaves out the catch-alls and the conformance packs' classes", () => {
    const m = fleetModels(fx.classes as unknown as VehicleClassRow[]);
    expect(m.map((x) => x.name)).toEqual([
      "Tesla · Model Y (Robotaxi config)", "Waymo · Jaguar I-Pace (Waymo-modified)", "Zoox · Robotaxi (purpose-built)",
    ]);
    expect(m[1]).toMatchObject({ batteryKwh: 84.7, peakKw: 104 });
  });
});

describe("variables", () => {
  it("groups the catalog by domain, in the order a newcomer reads it, and says when each is drawn", () => {
    const g = variableGroups(fx.catalog as unknown as CatalogRow[]);
    expect(g.map((x) => x.domain)).toEqual(["environment", "fleet_demand", "energy_grid", "reliability", "operations", "vehicle"]);
    expect(g.reduce((s, x) => s + x.vars.length, 0)).toBe(fx.catalog.length);
    const fleet = g.find((x) => x.domain === "fleet_demand")!;
    expect(fleet.vars.find((v) => v.key === "arrival")!.wired).toBe(false); // the catalog says so; the tab says so
    expect(fleet.wired).toBe(fleet.vars.length - 1);
    const veh = g.find((x) => x.domain === "vehicle")!;
    expect(veh.vars.every((v) => v.when === "once per run")).toBe(true);
  });
});

describe("the intelligence ledger", () => {
  it("gives each provider the sentence its own columns support, and sums nothing across them", () => {
    const p = providerFacts(fx.ledger as unknown as LedgerRow[]);
    expect(p.map((x) => x.provider)).toEqual(["nvidia_nemotron", "cpsat_service", "nvidia_cuopt"]);
    expect(p[0].line).toBe("12,627 agent decisions recorded · 12,185 applied · 440 fell back to the deterministic objective");
    expect(p[1].line).toBe("8,941 solver calls · 1,077 offers made · 145 enacted by the decide path · 59 refused");
    expect(p[2].line).toBe("1,165 calls answered by NVIDIA's endpoint · 5,093 proposals returned");
    expect(p[2].last).toBe("2026-09-27T12:03:06.08538+00:00");
  });

  it("reads — for a column that is missing, never 0", () => {
    const [x] = providerFacts([{ provider: "nvidia_cuopt" } as LedgerRow]);
    expect(x.line).toBe("— calls answered by NVIDIA's endpoint · — proposals returned");
  });
});

describe("the shield and the certification", () => {
  it("counts rule codes once (versions are not rules) and reads each decision point's posture from the derivation", () => {
    const s = shieldSummary(fx.rules as unknown as RuleRow[], fx.posture as unknown as PostureRow[]);
    expect(s.codes).toBe(30);
    expect(s.versions).toBe(54);
    expect(s.enforced.sort()).toEqual(["bess_dispatch", "charge_session_start", "redeployment", "stall_assignment", "task_start"]);
    expect(s.advisory.sort()).toEqual(["bess_state_change", "policy_write", "stall_state_change", "task_completion", "vehicle_state_change"]);
    expect(s.unresolved).toBe(1);
    expect(s.categories.reduce((n, c) => n + c.codes, 0)).toBe(30);
    expect(s.categories[0].category).toBe("energy_safety");
  });

  it("reports the canon as passing only where the outcome passed and the arms were equal", () => {
    const c = canonSummary(fx.canon as unknown as CanonRow[]);
    expect(c).toEqual({ columns: 9, passing: 9, current: 9, lastCertified: "2026-10-02T20:26:45.225229+00:00" });
    const broken = (fx.canon as unknown as CanonRow[]).map((r, i) => (i === 0 ? { ...r, equal: false } : r));
    expect(canonSummary(broken).passing).toBe(8);
  });
});

describe("what the twin has measured", () => {
  it("words the Value tab's three headlines and its guarantee, with the sweep they came from", () => {
    const m = measuredLines(readValueSummary(valueFx));
    expect(m).not.toBeNull();
    expect(m!.lines.length).toBeGreaterThanOrEqual(3);
    expect(m!.lines[0]).toMatch(/^Power bill: /);
    expect(m!.lines[1]).toMatch(/^Chargers: .* cars per charger a day/);
    expect(m!.lines[2]).toMatch(/^Revenue time: /);
  });

  it("says nothing when nothing has been measured", () => {
    expect(measuredLines(null)).toBeNull();
    expect(measuredLines(readValueSummary({ status: "none" }))).toBeNull();
  });
});

describe("formatting", () => {
  it("humanizes variable names with their units", () => {
    expect(humanVar("trip_duration_minutes")).toBe("trip duration (minutes)");
    expect(humanVar("ambient_temp_c")).toBe("ambient temperature (°C)");
    expect(humanVar("grid_demand_mw")).toBe("grid demand (MW)");
    expect(humanVar("charger_uptime_fraction")).toBe("charger uptime (share)");
  });

  it("dates in Central time and months in words", () => {
    expect(dayCT("2026-10-02T20:26:45Z")).toBe("Oct 2, 3:26 PM CT");
    expect(monthYear("2024-06-28")).toBe("Jun 2024");
    expect(dayCT(null)).toBeNull();
    expect(fmtInt(null)).toBe("—");
    expect(fmtInt(12627)).toBe("12,627");
  });
});
