// ============================================================================
// twinAnalysis — turns the live backend snapshot into an audit-grade narrative.
//
// Two engines, both fed from the SAME context object:
//   • deterministicAnalysis()  — instant, free, no external call. OTTO-Q reasons
//     about its own state with real numbers. This is the always-on default and
//     the one that showcases the orchestrator's agentic decisioning.
//   • requestLlmAnalysis()     — OPT-IN. Posts the context to the existing
//     `analyze-simulation` edge fn (Lovable AI gateway / Gemini) for a richer
//     prose narrative. Gated behind an explicit button so there's no surprise
//     AI spend against the <$25/mo ceiling. Falls back to deterministic on any
//     failure (function not deployed, no key, rate-limit, timeout).
//
// No legacy-store imports — the snapshot is the single source of truth.
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import type { EnergyPoint } from "@/store/twinStore";
import { liveFleetMetrics } from "@/lib/liveFleetMetrics";

// ── small helpers ──
const n = (v: unknown, d = 0): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);
const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const clockHM = (iso?: string | null): string => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }); }
  catch { return "—"; }
};

export interface TwinContext {
  run: { scenario: string; status: string; clock: string; tick: number; timeScale: number; seed: string };
  fleet: {
    total: number; deployed: number; charging: number; chargingDcfc: number; chargingL2: number;
    inService: number; ready: number; enRoute: number; arrived: number;
    readinessPct: number | null; deployedPct: number; dcfcUtilPct: number | null; l2UtilPct: number | null;
    dcfcStalls: number; l2Stalls: number;
  };
  energy: {
    solarKw: number; evKw: number; buildingKw: number; netGridKw: number; bessKw: number;
    peak15Kw: number; tariff: string; rate: number; selfSupplyPct: number;
  };
  grid: {
    lmp: number; carbon: number; voltage: string; freq: number; reserveMarginPct: number;
    drActive: boolean; drCapKw: number;
  };
  weather: { tempC: number; conditions: string; cloudPct: number; ghi: number; windKmh: number; precip: string };
  bess: { socPct: number; sohPct: number; state: string; tempC: number };
  counters: { dispatchesActive: number; dispatchesTotal: number; telemetry: number; chargeSessions: number; events: number; openIncidents: number };
  events: { faults: number; dr: number; overflow: number; arrivals: number; recent: string[] };
  variability: { tunedKnobs: number; spreadMult: number; rateMult: number; notable: string[] };
  trends: { peakSolar: number; peakImport: number; peakExport: number; avgLmp: number; samples: number };
  targets: Record<string, string>;
}

// ── classify the meaningful recent events ──
function classifyEvents(snapshot: TwinSnapshot) {
  const ev = snapshot.recent_events ?? [];
  let faults = 0, dr = 0, overflow = 0, arrivals = 0;
  const recent: string[] = [];
  for (const e of ev) {
    const t = e.type || "";
    if (/fault|brownout|anomaly|incident|voltage|frequency/.test(t)) faults++;
    if (/dr_call|demand_response/.test(t)) dr++;
    if (/overflow|queue/.test(t)) overflow++;
    if (/arriv/.test(t)) arrivals++;
    if (recent.length < 6) recent.push(t.replace(/^twin\./, "").replace(/_/g, " "));
  }
  return { faults, dr, overflow, arrivals, recent };
}

// ── pull the hand-tuned knobs out of the variability profile ──
function summarizeVariability(v: Record<string, unknown> | null | undefined) {
  if (!v) return { tunedKnobs: 0, spreadMult: 1, rateMult: 1, notable: [] as string[] };
  const g = (v._global ?? {}) as Record<string, number>;
  const rates = (v._rates ?? {}) as Record<string, number>;
  const spreadMult = n(g.spread_mult, 1);
  const rateMult = n(g.rate_mult, 1);
  const notable: string[] = [];
  let tuned = 0;
  for (const [k, val] of Object.entries(v)) {
    if (k.startsWith("_")) continue;
    tuned++;
    const kn = val as Record<string, number>;
    const bits: string[] = [];
    if (kn?.shift) bits.push(`shift ${kn.shift > 0 ? "+" : ""}${r1(kn.shift)}`);
    if (kn?.spread && kn.spread !== 1) bits.push(`spread ×${r1(kn.spread)}`);
    if (kn?.floor != null) bits.push(`floor ${r1(kn.floor)}`);
    if (kn?.ceiling != null) bits.push(`ceiling ${r1(kn.ceiling)}`);
    if (bits.length && notable.length < 6) notable.push(`${k.replace(/_/g, " ")}: ${bits.join(", ")}`);
  }
  for (const [k, mult] of Object.entries(rates)) {
    if (mult !== 1 && notable.length < 8) notable.push(`${k.replace(/_/g, " ")} rate ×${r1(mult)}`);
  }
  if (spreadMult !== 1) notable.unshift(`global spread ×${r1(spreadMult)}`);
  if (rateMult !== 1) notable.unshift(`global event-rate ×${r1(rateMult)}`);
  return { tunedKnobs: tuned, spreadMult, rateMult, notable };
}

// ── build the context the analyzers reason over ──
export function buildTwinContext(snapshot: TwinSnapshot, history: EnergyPoint[], layout: TwinLayout | null = null): TwinContext {
  const c = (snapshot.fleet?.counts ?? {}) as Record<string, number>;
  const total = n(snapshot.fleet?.total, 1) || 1;
  const e = (snapshot.energy ?? {}) as Record<string, number | string>;
  const g = (snapshot.grid ?? {}) as Record<string, number | string | boolean | null>;
  const w = (snapshot.weather ?? {}) as Record<string, number | string>;
  const b = (snapshot.bess ?? {}) as Record<string, number | string>;
  const ct = (snapshot.counters ?? {}) as Record<string, number>;

  const chargingDcfc = n(c.charging_dcfc);
  const chargingL2 = n(c.charging_l2);
  const deployed = n(c.deployed);
  const inService = n(c.in_wash_bay) + n(c.in_detail_bay) + n(c.in_service_bay);
  const fleetMetrics = liveFleetMetrics(snapshot, layout);
  const ready = fleetMetrics.ready;
  const solarKw = n(e.solar_kw);
  const evKw = n(e.ev_charging_kw);
  const buildingKw = n(e.building_kw);
  const bessKw = n(e.bess_output_kw);
  const netGridKw = n(e.grid_import_kw) - n(e.grid_export_kw);
  // self-supply = on-site generation ÷ total on-site demand. BESS counts as a
  // LOAD while charging (it's drawing) and a SUPPLY while discharging — so a
  // depot importing to charge BESS is correctly < 100% self-supplied.
  const bessState = String(b.state ?? "");
  const bessCharging = /charg/.test(bessState) && !/dischar/.test(bessState);
  const bessChargeLoad = bessCharging ? Math.abs(bessKw) : 0;
  const bessSupply = /dischar/.test(bessState) ? Math.abs(bessKw) : 0;
  const load = evKw + buildingKw + bessChargeLoad;
  const selfSupplyPct = load > 0 ? Math.min(100, ((solarKw + bessSupply) / load) * 100) : 0;

  const ev = classifyEvents(snapshot);
  const va = summarizeVariability(snapshot.variability as Record<string, unknown>);

  const peakSolar = history.reduce((m, p) => Math.max(m, p.solar), 0);
  const peakImport = history.reduce((m, p) => Math.max(m, p.grid), 0);
  const peakExport = history.reduce((m, p) => Math.max(m, -p.grid), 0);
  const avgLmp = history.length ? history.reduce((s, p) => s + p.lmp, 0) / history.length : n(g.lmp_usd_mwh);

  return {
    run: {
      scenario: snapshot.run?.scenario ?? "—", status: snapshot.run?.status ?? "—",
      clock: clockHM(snapshot.run?.sim_clock), tick: n(snapshot.run?.tick_count),
      timeScale: n(snapshot.run?.time_scale, 1), seed: snapshot.run?.seed != null ? String(snapshot.run.seed) : "—",
    },
    fleet: {
      total, deployed, charging: chargingDcfc + chargingL2, chargingDcfc, chargingL2,
      inService, ready, enRoute: n(c.en_route_to_depot), arrived: n(c.arrived_at_gate),
      readinessPct: fleetMetrics.readinessPct, deployedPct: (deployed / total) * 100,
      dcfcUtilPct: fleetMetrics.dcfcUtil === null ? null : fleetMetrics.dcfcUtil * 100,
      l2UtilPct: fleetMetrics.l2Util === null ? null : fleetMetrics.l2Util * 100,
      dcfcStalls: fleetMetrics.dcfcStalls, l2Stalls: fleetMetrics.l2Stalls,
    },
    energy: {
      solarKw, evKw, buildingKw, netGridKw, bessKw, peak15Kw: n(e.peak_15min_kw),
      tariff: String(e.tariff ?? "—"), rate: n(e.rate_per_kwh), selfSupplyPct,
    },
    grid: {
      lmp: n(g.lmp_usd_mwh), carbon: n(g.carbon_gco2_kwh), voltage: String(g.voltage_status ?? "—"),
      freq: n(g.frequency_hz), reserveMarginPct: n(g.reserve_margin_pct) * 100,
      drActive: Boolean(g.dr_active), drCapKw: n(g.dr_cap_kw),
    },
    weather: {
      tempC: n(w.temp_c), conditions: String(w.conditions ?? "—"), cloudPct: n(w.cloud_pct),
      ghi: n(w.ghi_wm2), windKmh: n(w.wind_kmh), precip: String(w.precip ?? "none"),
    },
    bess: { socPct: n(b.soc_pct), sohPct: n(b.soh_pct), state: String(b.state ?? "—"), tempC: n(b.temp_c) },
    counters: {
      dispatchesActive: n(ct.dispatches_active), dispatchesTotal: n(ct.dispatches_total),
      telemetry: n(ct.telemetry_packets), chargeSessions: n(ct.charge_sessions),
      events: n(ct.events_total), openIncidents: n(ct.open_incidents),
    },
    events: ev,
    variability: va,
    trends: { peakSolar, peakImport, peakExport, avgLmp, samples: history.length },
    targets: {
      fleetReadiness: "≥ 90% staged-ready by deploy window",
      dcfcUtilization: "60–85% during charge push",
      openIncidents: "0 unresolved at deploy",
      gridReserve: "≥ 8% reserve margin",
    },
  };
}

// ============================================================================
// Deterministic OTTO-Q self-analysis → markdown
// ============================================================================
export function deterministicAnalysis(ctx: TwinContext): string {
  const f = ctx.fleet, e = ctx.energy, g = ctx.grid, ct = ctx.counters, ev = ctx.events;

  // ── verdict ──
  const stressed =
    ct.openIncidents > 0 || g.drActive || ev.faults > 0 ||
    (g.voltage !== "nominal" && g.voltage !== "—") || g.reserveMarginPct < 8;
  const importing = e.netGridKw >= 0;
  const verdict = stressed
    ? `Depot is operating **under managed stress** — ${[
        ct.openIncidents > 0 ? `${ct.openIncidents} open incident(s)` : null,
        g.drActive ? `an active DR call capping load to ${r0(g.drCapKw)} kW` : null,
        ev.faults > 0 ? `${ev.faults} fault event(s) in the window` : null,
        g.reserveMarginPct < 8 ? `grid reserve at ${r1(g.reserveMarginPct)}%` : null,
      ].filter(Boolean).join(", ")}. ${f.readinessPct === null ? 'Fleet readiness is unavailable.' : `${r0(f.readinessPct)}% of the fleet is staged to depart.`}`
    : `Depot is **nominal** — ${f.readinessPct === null ? 'fleet readiness unavailable' : `${r0(f.readinessPct)}% of the fleet staged to depart`}, ${ct.openIncidents} open incidents, ${importing ? `importing ${r0(Math.abs(e.netGridKw))} kW` : `net-exporting ${r0(Math.abs(e.netGridKw))} kW`} on ${e.tariff} pricing.`;

  // ── key metrics ──
  const metrics = [
    `**Staged to depart:** ${f.readinessPct === null ? '—' : `${r0(f.readinessPct)}%`} (${f.ready}/${f.total} vehicles); awaiting service is excluded.`,
    `**Deployed:** ${f.deployed} (${r0(f.deployedPct)}% of fleet) · **In service:** ${f.inService} · **En route:** ${f.enRoute}`,
    `**DCFC utilization:** ${f.dcfcUtilPct === null ? '—' : `${r0(f.dcfcUtilPct)}%`} (${f.chargingDcfc}/${f.dcfcStalls || '—'}) · **L2:** ${f.l2UtilPct === null ? '—' : `${r0(f.l2UtilPct)}%`} (${f.chargingL2}/${f.l2Stalls || '—'})`,
    `**Energy:** solar ${r0(e.solarKw)} kW · charging ${r0(e.evKw)} kW · ${importing ? "import" : "export"} ${r0(Math.abs(e.netGridKw))} kW · self-supply ${r0(e.selfSupplyPct)}%`,
    `**BESS:** ${r0(ctx.bess.socPct)}% SoC (${ctx.bess.state}), SoH ${r1(ctx.bess.sohPct)}%, ${r1(ctx.bess.tempC)}°C`,
    `**Grid:** LMP $${r0(g.lmp)}/MWh · ${e.tariff} · reserve ${r1(g.reserveMarginPct)}% · ${g.voltage} · ${r0(g.carbon)} gCO₂/kWh`,
  ];

  // ── OTTO-Q actions (what the orchestrator is doing) ──
  const actions: string[] = [];
  actions.push(`**Dispatch:** ${ct.dispatchesActive} active deploy order(s), ${ct.dispatchesTotal} total this run.`);
  actions.push(`**Charge orchestration:** ${ct.chargeSessions} session(s) managed; ${f.charging} vehicle(s) on charge now.`);
  const bessAction = ctx.bess.state.includes("discharg")
    ? `discharging ${r0(Math.abs(e.bessKw))} kW`
    : ctx.bess.state.includes("charg") ? `charging ${r0(Math.abs(e.bessKw))} kW` : "idle";
  actions.push(`**Energy arbitrage:** BESS ${bessAction} against $${r0(g.lmp)}/MWh on ${e.tariff}.`);
  if (g.drActive) actions.push(`**DR response:** active — capping site draw to ${r0(g.drCapKw)} kW and deferring non-critical charging.`);
  if (ev.faults > 0) actions.push(`**Fault handling:** reacting to ${ev.faults} fault/anomaly event(s); rerouting around impacted assets.`);
  actions.push(`**Telemetry:** ${ct.telemetry.toLocaleString()} packet(s) ingested across the fleet.`);

  // ── stressors & variability ──
  const stressors: string[] = [];
  if (g.drActive) stressors.push(`Demand-response event active (${r0(g.drCapKw)} kW cap).`);
  if (g.voltage !== "nominal" && g.voltage !== "—") stressors.push(`Grid voltage **${g.voltage}**.`);
  if (g.reserveMarginPct < 8) stressors.push(`Thin grid reserve margin (${r1(g.reserveMarginPct)}%).`);
  if (g.lmp > 80) stressors.push(`Elevated LMP ($${r0(g.lmp)}/MWh).`);
  if (ctx.weather.tempC >= 35) stressors.push(`Heat stress (${r1(ctx.weather.tempC)}°C) — derates charging + BESS.`);
  if (ctx.weather.precip !== "none" && ctx.weather.precip !== "—") stressors.push(`Precipitation: ${ctx.weather.precip} (${ctx.weather.conditions}).`);
  if (ev.overflow > 0) stressors.push(`Service-lane overflow detected ${ev.overflow}× — staffing-bound.`);
  if (ctx.variability.notable.length) {
    stressors.push(`**Active variability shaping:** ${ctx.variability.notable.slice(0, 5).join("; ")}.`);
  } else if (!stressors.length) {
    stressors.push("Baseline calibrated distributions — no manual shaping or external stressors active.");
  }

  // ── recommendations (conditional, prioritized) ──
  const recs: { p: number; t: string }[] = [];
  if (ct.openIncidents > 0)
    recs.push({ p: 1, t: `Resolve the ${ct.openIncidents} open incident(s) before the deploy window — unresolved incidents cascade into deploy-SLA misses.` });
  if (f.dcfcUtilPct !== null && f.dcfcUtilPct >= 85 && f.ready < f.total * 0.9)
    recs.push({ p: 2, t: `DCFC saturated at ${r0(f.dcfcUtilPct)}% — shift deploy-eligible vehicles to L2 or stagger arrivals to clear the charge queue.` });
  if (ctx.bess.socPct > 60 && g.lmp > 80 && /peak/.test(e.tariff))
    recs.push({ p: 2, t: `Discharge BESS (${r0(ctx.bess.socPct)}% SoC) to shave on-peak load — LMP is $${r0(g.lmp)}/MWh.` });
  if (ctx.bess.socPct < 40 && e.netGridKw < 0)
    recs.push({ p: 3, t: `Charge BESS from the ${r0(Math.abs(e.netGridKw))} kW solar surplus now (off-peak / export) to bank capacity for the evening peak.` });
  if (g.drActive)
    recs.push({ p: 1, t: `Hold site load ≤ ${r0(g.drCapKw)} kW for the DR duration; resume deferred charging post-event to protect deploy readiness.` });
  if (e.netGridKw < -100 && e.solarKw > 100)
    recs.push({ p: 3, t: `Exporting ${r0(Math.abs(e.netGridKw))} kW — pull charging forward to self-consume solar instead of exporting at low value.` });
  if (g.reserveMarginPct < 8 || (g.voltage !== "nominal" && g.voltage !== "—"))
    recs.push({ p: 2, t: `Grid stressed (reserve ${r1(g.reserveMarginPct)}%, ${g.voltage}) — throttle DCFC ramp rate to avoid compounding the constraint.` });
  if (ev.overflow > 0)
    recs.push({ p: 3, t: `Service lanes are staffing-bound (overflow ${ev.overflow}×) — add an attendant or expect longer staging dwell. OTTO-Q still clears the queue, just slower.` });
  if (!recs.length)
    recs.push({ p: 3, t: `Operations are within targets — maintain current charge cadence and keep BESS staged for the next peak window.` });
  const topRecs = recs.sort((a, b) => a.p - b.p).slice(0, 4).map((r) => r.t);

  // ── assemble markdown ──
  return [
    `## Performance Verdict`,
    verdict,
    ``,
    `## Key Metrics`,
    ...metrics.map((m) => `- ${m}`),
    ``,
    `## OTTO-Q Actions`,
    ...actions.map((a) => `- ${a}`),
    ``,
    `## Stressors & Variability`,
    ...stressors.map((s) => `- ${s}`),
    ``,
    `## Recommendations`,
    ...topRecs.map((t) => `- ${t}`),
    ``,
    `### Run`,
    `- Scenario **${ctx.run.scenario}** · ${ctx.run.status} · sim-clock ${ctx.run.clock} · tick ${ctx.run.tick} · ${ctx.run.timeScale}× · seed ${ctx.run.seed}`,
    `- _OTTO-Q rule engine · deterministic · ${ctx.trends.samples} energy samples._`,
  ].join("\n");
}

// ============================================================================
// Opt-in LLM narrative (Lovable AI gateway / Gemini) with deterministic fallback
// ============================================================================
export interface AnalysisResult { text: string; source: "OTTO-AI · Gemini" | "OTTO-Q engine"; }

export async function requestLlmAnalysis(ctx: TwinContext): Promise<AnalysisResult> {
  const fallback = (): AnalysisResult => ({ text: deterministicAnalysis(ctx), source: "OTTO-Q engine" });
  try {
    const invoke = supabase.functions.invoke("analyze-simulation", { body: { context: ctx } });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 14_000));
    const { data, error } = (await Promise.race([invoke, timeout])) as { data?: { analysis?: string; error?: string }; error?: unknown };
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const text = (data?.analysis ?? "").trim();
    if (!text) throw new Error("empty analysis");
    return { text, source: "OTTO-AI · Gemini" };
  } catch (e) {
    console.warn("[twinAnalysis] LLM unavailable, using deterministic engine:", e);
    return fallback();
  }
}
