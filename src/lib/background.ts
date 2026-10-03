// ============================================================================
// background — the Background tab's reads, shaped into what a newcomer can read. Pure: no React, no fetching.
//
// Every figure the tab shows comes through here from a source the engine publishes to this cockpit (otto-q-core,
// granted to anon): the calibration registry, the feed plans, the variability catalog, the intelligence ledger, the
// rule catalog, the shield's derived posture, the determinism canon, the depot tariff and the vehicle classes. Each
// shaped value keeps the name of the table or function it came from, so the tab can say where a number lives, and a
// source that has not answered stays null and reads "—", never 0.
// ============================================================================

import {
  DEFAULT_FAST_CHARGERS, chargersHeadline, comparable, guaranteeText, pairedSeeds, powerHeadline, revenueHeadline,
  viewFor, type ValueSummary,
} from "./valueSummary";

// ── raw rows, as PostgREST returns them ─────────────────────────────────────
export interface CalibrationDatasetRow {
  dataset_code: string;
  domain: string;
  status?: string | null;
  source_name?: string | null;
  source_org?: string | null;
  source_url?: string | null;
  description?: string | null;
  what_it_calibrates?: string | null;
  record_count?: number | null;
  date_range_start?: string | null;
  date_range_end?: string | null;
  ingestion_method?: string | null;
  ingestion_notes?: string | null;
  ingested_at?: string | null;
  license?: string | null;
}
export interface DistributionRow { dataset_code: string; variable_name: string; segment?: string | null; sample_count?: number | null }
export interface FeedPlanRow {
  var_key: string;
  version?: number | null;
  status?: string | null;
  method?: string | null;
  provenance?: Record<string, unknown> | null;
  authored_by?: string | null;
  created_at?: string | null;
}
export interface CatalogRow {
  var_key: string;
  domain: string;
  label: string;
  definition?: string | null;
  unit?: string | null;
  kind?: string | null;
  wired?: boolean | null;
  generator?: string | null;
  lifespan?: string | null;
  scope?: string | null;
  display_order?: number | null;
}
export interface LedgerRow {
  provider: string;
  role?: string | null;
  calls?: number | null;
  provider_status_2xx?: number | null;
  answered?: number | null;
  abstained?: number | null;
  fell_back?: number | null;
  refused?: number | null;
  errored?: number | null;
  outcomes?: Record<string, number> | null;
  proposals?: number | null;
  first_call?: string | null;
  last_call?: string | null;
  ledger_rows?: number | null;
  captured_decisions?: number | null;
  avg_latency_ms?: number | string | null;
  avg_decision_latency_ms?: number | string | null;
}
export interface RuleRow {
  rule_code: string;
  category?: string | null;
  severity?: string | null;
  enforcement?: string | null;
  applies_to_actions?: string[] | null;
  title?: string | null;
  status?: string | null;
}
export interface PostureRow { action_context: string | null; posture: string; callers?: string[] | null }
export interface CanonRow {
  depot_id?: string | null;
  scenario?: string | null;
  seed?: number | null;
  ticks?: number | null;
  enabled?: boolean | null;
  outcome?: string | null;
  equal?: boolean | null;
  status?: string | null;
  satisfies_floor?: boolean | null;
  certified_at?: string | null;
}
export interface TariffRow {
  depot_id?: string | null;
  active?: boolean | null;
  demand_basis?: string | null;
  effective_from?: string | null;
  provenance?: { source_url?: string; retrieved?: string; notes?: string; source_type?: string } | null;
}
export interface VehicleClassRow {
  vehicle_class_code: string;
  oem_name?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  battery_capacity_kwh?: number | string | null;
  max_charge_rate_kw?: number | string | null;
  status?: string | null;
}

// ── small helpers ────────────────────────────────────────────────────────────
const n = (v: unknown): number | null => {
  const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};
export const fmtInt = (v: number | null | undefined): string => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

/** "trip_duration_minutes" -> "trip duration (minutes)"; "ambient_temp_c" -> "ambient temperature (°C)". */
export function humanVar(name: string): string {
  const units: [RegExp, string][] = [
    [/_minutes$/, " (minutes)"], [/_kwh$/, " (kWh)"], [/_mw$/, " (MW)"], [/_mm$/, " (mm)"], [/_kmh$/, " (km/h)"],
    [/_c$/, " (°C)"], [/_pct$/, " (%)"], [/_days$/, " (days)"], [/_fraction$/, " (share)"], [/_rate$/, " (rate)"],
  ];
  let unit = "";
  let base = name;
  for (const [re, u] of units) {
    if (re.test(base)) { unit = u; base = base.replace(re, ""); break; }
  }
  const words = base.replace(/_/g, " ").replace(/\btemp\b/, "temperature").replace(/\bsoc\b/i, "SoC");
  return `${words}${unit}`;
}

/** "2018-04-25" -> "Apr 2018". Null in, null out. */
export function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** A timestamp as a day and Central time, e.g. "Oct 2, 2:28 PM CT". */
export function dayCT(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} CT`;
}

// ── data sources ─────────────────────────────────────────────────────────────
export type ProvenanceKind = "raw_records" | "published_statistics" | "live_api" | "computed";

export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  raw_records: "raw records ingested",
  published_statistics: "fitted to published statistics",
  live_api: "live public API, refit weekly",
  computed: "computed by us from raw observations",
};

/**
 * How a dataset reached the twin, read from what its own row says. The ingestion method alone misleads: two sources
 * filed as `file_download` say in their notes that they were encoded from published aggregates, and that is the
 * honest label for them.
 */
export function provenanceKind(d: Pick<CalibrationDatasetRow, "ingestion_method" | "ingestion_notes" | "description">): ProvenanceKind {
  const text = `${d.ingestion_notes ?? ""} ${d.description ?? ""}`;
  const method = d.ingestion_method ?? "";
  if (/encoded from|published (aggregate|research|statistic)|composite of published/i.test(text) || method === "published_statistics") {
    return "published_statistics";
  }
  if (method === "api_live") return "live_api";
  if (/computed directly from|local_computation/i.test(`${text} ${method}`)) return "computed";
  if (/normals/i.test(text) && /research/i.test(method)) return "published_statistics";
  return "raw_records";
}

export const DOMAIN_TITLE: Record<string, string> = {
  arrivals: "Trips and arrivals",
  charging: "Charging behaviour",
  fleet: "Fleet duty cycles",
  grid: "The grid",
  incidents: "Autonomous-vehicle incidents",
  reliability: "Charger reliability",
  weather: "Weather",
};

export interface DataSource {
  code: string;
  domain: string;
  domainTitle: string;
  name: string;
  org: string | null;
  url: string | null;
  period: string | null;
  records: number | null;
  kind: ProvenanceKind;
  /** The distributions actually fitted from it (calibration registry), in words. */
  fitted: string[];
  /** What its row says it calibrates, in words. */
  calibrates: string[];
  description: string | null;
  ingestedAt: string | null;
  license: string | null;
}

export function dataSources(rows: readonly CalibrationDatasetRow[], dists: readonly DistributionRow[]): DataSource[] {
  const fitted = new Map<string, Set<string>>();
  for (const d of dists) {
    if (!fitted.has(d.dataset_code)) fitted.set(d.dataset_code, new Set());
    fitted.get(d.dataset_code)!.add(d.variable_name);
  }
  const order = Object.keys(DOMAIN_TITLE);
  return [...rows]
    .filter((r) => (r.status ?? "ingested") === "ingested")
    .sort((a, b) => (order.indexOf(a.domain) - order.indexOf(b.domain)) || a.dataset_code.localeCompare(b.dataset_code))
    .map((r) => {
      const from = monthYear(r.date_range_start);
      const to = monthYear(r.date_range_end);
      return {
        code: r.dataset_code,
        domain: r.domain,
        domainTitle: DOMAIN_TITLE[r.domain] ?? r.domain,
        name: r.source_name ?? r.dataset_code,
        org: r.source_org ?? null,
        url: r.source_url && /^https:\/\//.test(r.source_url) ? r.source_url : null,
        period: from && to ? (from === to ? from : `${from} to ${to}`) : from ?? to ?? null,
        records: n(r.record_count),
        kind: provenanceKind(r),
        fitted: [...(fitted.get(r.dataset_code) ?? [])].sort().map(humanVar),
        calibrates: (r.what_it_calibrates ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(humanVar),
        description: r.description ?? null,
        ingestedAt: r.ingested_at ?? null,
        license: r.license ?? null,
      };
    });
}

/** A feed plan: the recipe one twin variable is drawn from, with its own sources. */
export interface FeedRecipe {
  varKey: string;
  title: string;
  method: string;
  sources: string[];
  corpus: string | null;
  retrieved: string | null;
  /** The assumptions the recipe declares by name, each with its reason (provenance.declared_assumptions). */
  assumptions: { name: string; why: string | null }[];
  /** The whole recipe is a declared assumption awaiting real data (provenance.source_type = declared_assumptions). */
  wholeAssumption: boolean;
  /** What kind of source the recipe rests on, in words (provenance.source_type). */
  sourceType: string | null;
  authoredBy: string | null;
}

const RECIPE_TITLE: Record<string, string> = {
  ambient_temp_c: "Air temperature",
  charger_fault_repair: "Charger faults and repairs",
  lmp_usd_mwh: "Wholesale power price",
  precip_unified: "Rain and snow",
  service_manifest: "Which services a returning car needs",
  tariff_demand_charge: "The depot's electricity bill",
};
const METHOD_WORDS: Record<string, string> = {
  quantile_grid: "quantile grid",
  parametric: "fitted distribution",
  policy: "declared policy",
};

export function feedRecipes(rows: readonly FeedPlanRow[]): FeedRecipe[] {
  return rows
    .filter((r) => (r.status ?? "active") === "active")
    .map((r) => {
      const p = (r.provenance ?? {}) as Record<string, unknown>;
      const sources = (Array.isArray(p.sources) ? p.sources : [])
        .filter((s): s is string => typeof s === "string" && /^https:\/\//.test(s));
      const corpus = typeof p.corpus === "string" ? p.corpus : typeof p.basis === "string" ? p.basis : null;
      const declared = Array.isArray(p.declared_assumptions) ? p.declared_assumptions : [];
      const assumptions = declared
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as Record<string, unknown>).name === "string")
        .map((a) => ({ name: String(a.name).replace(/_/g, " "), why: typeof a.why === "string" ? a.why : null }));
      return {
        varKey: r.var_key,
        title: RECIPE_TITLE[r.var_key] ?? humanVar(r.var_key),
        method: METHOD_WORDS[r.method ?? ""] ?? (r.method ?? "—"),
        sources,
        corpus,
        retrieved: typeof p.retrieved === "string" ? p.retrieved : null,
        assumptions,
        wholeAssumption: p.source_type === "declared_assumptions",
        sourceType: typeof p.source_type === "string" ? p.source_type.replace(/_/g, " ").replace(/\bnoaa\b/i, "NOAA").replace(/\bpdf\b/i, "PDF") : null,
        authoredBy: r.authored_by ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// ── the variables the twin draws ─────────────────────────────────────────────
export const CATALOG_DOMAIN_TITLE: Record<string, string> = {
  environment: "Environment and weather",
  fleet_demand: "Fleet and demand",
  energy_grid: "Energy and the grid",
  reliability: "Reliability and faults",
  operations: "Operations and service",
  vehicle: "Each vehicle's own condition",
};

/** How often a variable is drawn, from its catalog lifespan. */
export const LIFESPAN_WORDS: Record<string, string> = {
  run: "once per run",
  day: "each sim day",
  block: "each block of the day",
  trip: "each trip",
  session: "each charging session",
  visit: "each depot visit",
  event: "as events occur",
  arrival: "each arrival",
};

export interface VariableGroup {
  domain: string;
  title: string;
  vars: { key: string; label: string; definition: string | null; unit: string | null; when: string; wired: boolean }[];
  wired: number;
}

export function variableGroups(rows: readonly CatalogRow[]): VariableGroup[] {
  const order = Object.keys(CATALOG_DOMAIN_TITLE);
  const by = new Map<string, CatalogRow[]>();
  for (const r of rows) {
    if (!by.has(r.domain)) by.set(r.domain, []);
    by.get(r.domain)!.push(r);
  }
  return [...by.entries()]
    .sort(([a], [b]) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99) || a.localeCompare(b))
    .map(([domain, list]) => {
      const vars = [...list]
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.var_key.localeCompare(b.var_key))
        .map((r) => ({
          key: r.var_key,
          label: r.label,
          definition: r.definition ?? null,
          unit: r.unit ?? null,
          when: LIFESPAN_WORDS[r.lifespan ?? ""] ?? (r.lifespan ? r.lifespan.replace(/_/g, " ") : "—"),
          wired: r.wired !== false,
        }));
      return { domain, title: CATALOG_DOMAIN_TITLE[domain] ?? domain.replace(/_/g, " "), vars, wired: vars.filter((v) => v.wired).length };
    });
}

// ── the intelligence ledger, per provider ─────────────────────────────────────
export interface ProviderFact {
  provider: string;
  name: string;
  role: string;
  /** The provider's headline count and what it counts, from its own row. */
  count: number | null;
  counts: string;
  /** The rest of the row, in words. */
  rest: string;
  /** The whole sentence: count, what it counts, and the rest. */
  line: string;
  last: string | null;
  first: string | null;
}

/**
 * otto-q-core 0340/0341's view, one sentence per provider. The columns mean different things per provider (an agent's
 * work is captured decisions; a solver's is calls and proposals), so each provider gets the sentence its columns
 * support, and nothing is summed across them.
 */
export function providerFacts(rows: readonly LedgerRow[]): ProviderFact[] {
  const order = ["nvidia_nemotron", "cpsat_service", "nvidia_cuopt"];
  const fact = (r: LedgerRow, name: string, role: string, count: number | null, counts: string, rest: string): ProviderFact => ({
    provider: r.provider, name, role, count, counts, rest,
    line: `${fmtInt(count)} ${counts}${rest ? ` · ${rest}` : ""}`,
    last: r.last_call ?? null, first: r.first_call ?? null,
  });
  return [...rows]
    .sort((a, b) => ((order.indexOf(a.provider) + 99) % 99) - ((order.indexOf(b.provider) + 99) % 99))
    .map((r) => {
      const o = r.outcomes ?? {};
      if (r.provider === "nvidia_nemotron") {
        return fact(r, "Agent (NVIDIA Nemotron)", "agent", n(r.captured_decisions) ?? n(r.ledger_rows), "agent decisions recorded",
          `${fmtInt(n(o.enacted) ?? n(r.answered))} applied · ${fmtInt(n(o.fallback) ?? n(r.fell_back))} fell back to the deterministic objective`);
      }
      if (r.provider === "cpsat_service") {
        return fact(r, "CP-SAT (Google OR-Tools)", "planner", n(r.calls), "solver calls",
          `${fmtInt(n(r.proposals))} offers made · ${fmtInt(n(o.enacted))} enacted by the decide path · ${fmtInt(n(o.refused) ?? n(r.refused))} refused`);
      }
      if (r.provider === "nvidia_cuopt") {
        return fact(r, "NVIDIA cuOpt", "planner", n(r.provider_status_2xx) ?? n(r.calls), "calls answered by NVIDIA's endpoint",
          `${fmtInt(n(r.proposals))} proposals returned`);
      }
      return fact(r, r.provider.replace(/_/g, " "), r.role ?? "—", n(r.calls), "calls", `${fmtInt(n(r.proposals))} proposals`);
    });
}

// ── the safety shield ────────────────────────────────────────────────────────
export const RULE_CATEGORY_TITLE: Record<string, string> = {
  energy_safety: "Energy safety (grid, stall power, battery, demand response)",
  hardware_safety: "Hardware safety (connector fit, charger state, presence)",
  sensor_liveness: "Sensor liveness",
  concurrency: "Concurrency (one car per stall, one task per car)",
  sla_contract: "Fleet-owner contract terms (charge at release, services complete, visit length)",
  time_window: "Time windows (hours, quiet hours, tariff, shift change)",
  state_machine: "State-machine validity (vehicle, stall, task, battery)",
  role_authorization: "Who may do what (people and AI actors)",
  audit_integrity: "Audit integrity",
};

export const CONTEXT_WORDS: Record<string, string> = {
  task_start: "a service starts",
  stall_assignment: "a car is given a stall",
  charge_session_start: "a charge starts",
  redeployment: "a car is released to work",
  bess_dispatch: "the site battery is dispatched",
  policy_write: "a run setting is changed",
  task_completion: "a service completes",
  vehicle_state_change: "a car changes state",
  stall_state_change: "a stall changes state",
  bess_state_change: "the battery changes state",
};

export interface ShieldSummary {
  codes: number;
  versions: number;
  categories: { category: string; title: string; codes: number; blocking: number }[];
  enforced: string[];
  advisory: string[];
  unresolved: number;
}

export function shieldSummary(rules: readonly RuleRow[], posture: readonly PostureRow[] | null): ShieldSummary {
  const active = rules.filter((r) => (r.status ?? "active") === "active");
  const codes = new Map<string, RuleRow>();
  for (const r of active) codes.set(r.rule_code, r);
  const cats = new Map<string, { codes: number; blocking: number }>();
  for (const r of codes.values()) {
    const c = r.category ?? "other";
    const e = cats.get(c) ?? { codes: 0, blocking: 0 };
    e.codes++;
    if (r.enforcement === "block") e.blocking++;
    cats.set(c, e);
  }
  const order = Object.keys(RULE_CATEGORY_TITLE);
  const p = posture ?? [];
  return {
    codes: codes.size,
    versions: rules.length,
    categories: [...cats.entries()]
      .sort(([a], [b]) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99))
      .map(([category, v]) => ({ category, title: RULE_CATEGORY_TITLE[category] ?? category.replace(/_/g, " "), ...v })),
    enforced: p.filter((x) => x.posture === "enforced" && x.action_context).map((x) => x.action_context!),
    advisory: p.filter((x) => x.posture === "advisory" && x.action_context).map((x) => x.action_context!),
    unresolved: p.filter((x) => !x.action_context).length,
  };
}

// ── certification ────────────────────────────────────────────────────────────
export interface CanonSummary {
  columns: number;
  passing: number;
  current: number;
  lastCertified: string | null;
}

export function canonSummary(rows: readonly CanonRow[]): CanonSummary {
  const on = rows.filter((r) => r.enabled !== false);
  const last = on.map((r) => r.certified_at).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return {
    columns: on.length,
    passing: on.filter((r) => r.outcome === "passed" && r.equal === true).length,
    current: on.filter((r) => r.status === "current" && r.satisfies_floor === true).length,
    lastCertified: last,
  };
}

// ── vehicles ─────────────────────────────────────────────────────────────────
/** The production AV models in the class table (the generic catch-alls and the conformance packs' classes left out). */
export function fleetModels(rows: readonly VehicleClassRow[]): { name: string; batteryKwh: number | null; peakKw: number | null }[] {
  return rows
    .filter((r) => (r.status ?? "active") === "active" && r.oem_name && !/^(generic|amrco|yardco)$/i.test(r.oem_name))
    .map((r) => ({
      name: `${r.oem_name}${r.model ? ` · ${r.manufacturer && r.manufacturer !== r.oem_name ? `${r.manufacturer} ` : ""}${r.model}` : ""}`,
      batteryKwh: n(r.battery_capacity_kwh),
      peakKw: n(r.max_charge_rate_kw),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── what the twin has measured (the Value tab's own words) ──────────────────

/**
 * The Value tab's three headlines and its departure guarantee, at the depot as built, as one line each. Built from
 * the Value tab's own functions, so the two tabs can never word the same result differently; null until a test day
 * has paired OTTO-Q with a plain depot.
 */
export function measuredLines(s: ValueSummary | null): { lines: string[]; sweep: string | null; seeds: number | null } | null {
  if (!s || s.status === "none") return null;
  const view = viewFor(s, DEFAULT_FAST_CHARGERS);
  const g = guaranteeText(s.guarantee);
  if (!comparable(view)) return g ? { lines: [g.text], sweep: s.sweep?.code ?? null, seeds: null } : null;
  const n = pairedSeeds(view, s.runs);
  const said = (label: string, h: { big: string; words: string; range: string | null }) =>
    `${label}: ${h.big} ${h.words}${h.range ? ` (${h.range})` : ""}.`;
  const lines = [
    said("Power bill", powerHeadline(view!, n)),
    said("Chargers", chargersHeadline(view!, n)),
    said("Revenue time", revenueHeadline(view!, n)),
  ];
  if (g) lines.push(g.text);
  return { lines, sweep: s.sweep?.code ?? null, seeds: n };
}
