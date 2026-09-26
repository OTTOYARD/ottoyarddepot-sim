// ============================================================================
// OTTO-TWIN Control API — Supabase Edge Function
// ============================================================================
// Service-role-only control surface for the digital twin. Lets you start /
// stop scenarios, advance ticks manually, inject faults / DR calls, and
// inspect sim_run status. This is the seam the Lovable Command Center will
// call.
//
// Deploy: supabase functions deploy otto-twin-control
// Invoke: https://<project-ref>.supabase.co/functions/v1/otto-twin-control/<path>
// Auth:   demo controls are open on the private link; database writes use the
//         function's server-side service role and are never exposed to clients
// ============================================================================
//
// ENDPOINTS
// ---------
//   GET  /scenarios                       list seeded scenarios
//   POST /scenarios/start                 {scenario_code, seed?, run_by?}      → {sim_run_id}
//   POST /scenarios/stop                  {sim_run_id}                          → {ok}
//   GET  /sim_runs/:id/status             → full sim_run row + counters + last event
//   POST /sim_runs/:id/tick               → advance exactly one tick
//   POST /sim_runs/:id/pause              → freeze the WORLD (all tick paths skip paused runs)
//   POST /sim_runs/:id/resume             → un-freeze
//   PUT  /sim_runs/:id/playback           {mode, speed_x} → live playback speed
//   PUT  /sim_runs/:id/time_scale         {time_scale} → honest speed (sim-min per tick; 60 = 1×)
//   POST /sim_runs/:id/inject_fault       {kind, target_id?, payload?}
//        kind = charger_offline → ottoq_twin_inject_charger_fault (0451): a real charger fault
//        other kinds            → an event only; the response says engine_effect = "none"
//   GET  /sim_runs/:id/kpis               → ottoq_kpi_five: the five canonical KPIs for the run
//   POST /sim_runs/:id/inject_dr_call     {duration_min, cap_kw, reason?}       → {dr_call_id}
//   POST /advance_due                     → drives ottoq_sim_advance_due_runs() (cron entrypoint)
//
// RESPONSE ENVELOPE
//   { ok: true,  data: ... }
//   { ok: false, error: "...", details?: ... }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ---------------------------------------------------------------------------
// Response helpers — CORS headers MUST be on every response (not just the
// OPTIONS preflight), or the browser blocks the body cross-origin.
// ---------------------------------------------------------------------------
const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
};

const ok   = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, data }), { status, headers: CORS });

const err  = (message: string, status = 400, details?: unknown) =>
  new Response(JSON.stringify({ ok: false, error: message, details }), { status, headers: CORS });

// ---------------------------------------------------------------------------
// Auth: require service-role bearer
// ---------------------------------------------------------------------------
function authOk(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === SERVICE_KEY;
}

// ---------------------------------------------------------------------------
// Body parser with safety
// ---------------------------------------------------------------------------
async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    if (req.headers.get("content-length") === "0") return {} as T;
    return await req.json();
  } catch {
    return {} as T;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listScenarios() {
  const { data, error } = await supabase
    .from("ottoq_sim_scenarios")
    .select("scenario_code, title, description, default_duration_hours, default_time_scale, status, fleet_overrides, weather_overrides, grid_overrides")
    .eq("status", "available")
    .order("scenario_code");
  if (error) return err("scenario list failed", 500, error.message);
  return ok({ scenarios: data });
}

async function startScenario(req: Request) {
  const body = await readJson<{
    scenario_code?: string;
    seed?: number;
    speed_x?: number;
    days?: number;
  }>(req);
  if (!body.scenario_code) return err("scenario_code required");

  // Keep the edge request inside PostgREST's statement timeout. The heavier
  // ottoq_start_demo_run wrapper also purges archived run data and can exceed
  // that limit. The core scenario function already supersedes the live run and
  // is the authoritative door that arms the full agent/solver chain.
  const { data: simRunId, error } = await supabase.rpc("ottoq_sim_run_scenario", {
    p_scenario_code: body.scenario_code,
    p_seed:          body.seed ?? null,
    p_run_by:        "operator_demo",
  });
  if (error) return err("scenario start failed", 500, error.message);
  if (!simRunId) return err("scenario start returned no run", 500);

  const speed = body.speed_x ?? 1;
  const { error: playbackError } = await supabase.rpc("ottoq_set_playback", {
    p_sim_run_id: simRunId,
    p_mode: "live",
    p_speed_x: speed,
  });
  if (playbackError) return err("scenario started but playback setup failed", 500, playbackError.message);

  // Feed-agent fleet: fire-and-forget the genetic variable layer for this run.
  // Each registered variable's agent (Nemotron 3 Ultra) reviews its corpus +
  // realized outcomes and activates its sampling plan. Never blocks run start.
  fetch(`${SUPABASE_URL}/functions/v1/ottoq-feed-agents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sim_run_id: simRunId }),
  }).catch(() => {});

  return ok({
    ok: true,
    sim_run_id: simRunId,
    scenario: body.scenario_code,
    scenario_code: body.scenario_code,
    demo_speed_x: speed,
    real_seconds_per_tick: Math.round((6 / speed) * 100) / 100,
    runs_for_sim_days: body.days ?? 1,
  });
}

async function stopScenario(req: Request) {
  const body = await readJson<{ sim_run_id?: string; reason?: string }>(req);
  if (!body.sim_run_id) return err("sim_run_id required");

  const { data, error } = await supabase.rpc("ottoq_sim_stop_and_reset", {
    p_sim_run_id: body.sim_run_id,
    p_reason: body.reason ?? "operator_stop",
  });
  if (error) return err("scenario stop failed", 500, error.message);
  return ok(data);
}

async function setPlayback(simRunId: string, req: Request) {
  const body = await readJson<{ mode?: "live" | "fixed"; speed_x?: number }>(req);
  const speed = Number(body.speed_x);
  if (!Number.isFinite(speed)) return err("speed_x must be a number", 400);

  const { data, error } = await supabase.rpc("ottoq_set_playback", {
    p_sim_run_id: simRunId,
    p_mode: body.mode ?? "live",
    p_speed_x: speed,
  });
  if (error) return err("playback update failed", 500, error.message);
  return ok(data);
}

// True world-pause: every advance path (client /tick, /advance_due, and the
// pg_cron decide/wave loops) filters on status='running', so flipping the row
// freezes the run for ALL clients — not just the tab that clicked Pause.
async function pauseRun(simRunId: string) {
  const { data, error } = await supabase
    .from("ottoq_sim_runs")
    .update({ status: "paused" })
    .eq("sim_run_id", simRunId)
    .eq("status", "running")
    .select("sim_run_id");
  if (error) return err("pause failed", 500, error.message);
  if (!data?.length) return err("run is not running (already paused or ended)", 409);
  return ok({ paused: simRunId });
}

// HONEST SPEED CONTROL: time_scale = sim-minutes compressed into each tick
// (advance computes tick_interval_seconds × time_scale / 60). The server-side
// metronome keeps the TICK RATE steady; this dial changes how much sim-time
// each tick covers — the real "1×/2×/4×" the viewer slider promises. 60 = 1×.
async function setTimeScale(simRunId: string, req: Request) {
  let body: { time_scale?: number } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const ts = Number(body.time_scale);
  if (!Number.isFinite(ts) || ts < 15 || ts > 480) {
    return err("time_scale must be a number in [15, 480] (60 = 1×)", 400);
  }
  const { data, error } = await supabase.from("ottoq_sim_runs")
    .update({ time_scale: ts })
    .eq("sim_run_id", simRunId)
    .in("status", ["running", "paused"])
    .select("sim_run_id");
  if (error) return err("time_scale update failed", 500, error.message);
  if (!data?.length) return err("run is not live", 409);
  return ok({ sim_run_id: simRunId, time_scale: ts });
}

async function resumeRun(simRunId: string) {
  // next_tick_due_at moves to now so a long pause never looks "overdue"
  const { data, error } = await supabase
    .from("ottoq_sim_runs")
    .update({ status: "running", next_tick_due_at: new Date().toISOString() })
    .eq("sim_run_id", simRunId)
    .eq("status", "paused")
    .select("sim_run_id");
  if (error) return err("resume failed", 500, error.message);
  if (!data?.length) return err("run is not paused", 409);
  return ok({ resumed: simRunId });
}

async function simRunStatus(simRunId: string) {
  const { data: run, error: runErr } = await supabase
    .from("ottoq_sim_runs")
    .select("*")
    .eq("sim_run_id", simRunId)
    .single();
  if (runErr || !run) return err("sim_run not found", 404, runErr?.message);

  const { data: lastEvents } = await supabase
    .from("ottoq_events")
    .select("event_id, event_type, severity, occurred_at, payload")
    .eq("sim_run_id", simRunId)
    .order("occurred_at", { ascending: false })
    .limit(10);

  // Aggregate generator output counts
  const [{ count: weather }, { count: solar }, { count: grid }, { count: telemetry },
         { count: dispatches }, { count: webhooks }, { data: proposals },
         { count: agentDecisions }, { count: vehicleCommands }] = await Promise.all([
    supabase.from("ottoq_weather_snapshots").select("*", { count: "exact", head: true }).eq("sim_run_id", simRunId),
    supabase.from("ottoq_solar_output").select("*", { count: "exact", head: true }).eq("sim_run_id", simRunId),
    supabase.from("ottoq_grid_snapshots").select("*", { count: "exact", head: true }).eq("sim_run_id", simRunId),
    supabase.from("ottoq_telemetry_packets").select("*", { count: "exact", head: true }).eq("sim_run_id", simRunId),
    supabase.from("ottoq_vehicle_dispatches").select("*", { count: "exact", head: true }).eq("sim_run_id", simRunId),
    supabase.from("ottoq_oem_webhook_log").select("*", { count: "exact", head: true }).eq("sim_run_id", simRunId),
    supabase.from("ottoq_external_proposals")
      .select("status, disposition_reason, source, proposal")
      .eq("sim_run_id", simRunId)
      .limit(5000),
    supabase.from("ottoq_decisions").select("*", { count: "exact", head: true })
      .eq("sim_run_id", simRunId).eq("resolved_action_context", "orchestrator_agent"),
    supabase.from("ottoq_vehicle_commands").select("*", { count: "exact", head: true }).eq("sim_run_id", simRunId),
  ]);

  const byStatus: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let chained = 0;
  for (const row of proposals ?? []) {
    const status = String(row.status ?? "unknown");
    const source = String(row.source ?? "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    bySource[source] = (bySource[source] ?? 0) + 1;
    if (row.disposition_reason) {
      const reason = String(row.disposition_reason);
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
    if (row.proposal && typeof row.proposal === "object" && "agent_handoff" in row.proposal) chained++;
  }

  return ok({
    sim_run: run,
    counters: { weather, solar, grid, telemetry, dispatches, webhooks },
    ottoq_pipeline: {
      agent_decisions: agentDecisions ?? 0,
      vehicle_commands: vehicleCommands ?? 0,
      solver_proposals: proposals?.length ?? 0,
      chained_solver_proposals: chained,
      pending_solver_proposals: byStatus.pending ?? 0,
      proposal_statuses: byStatus,
      proposal_reasons: byReason,
      proposal_sources: bySource,
    },
    last_events: lastEvents ?? []
  });
}

async function advanceTick(simRunId: string) {
  const { data, error } = await supabase.rpc("ottoq_sim_advance_tick", { p_sim_run_id: simRunId });
  if (error) return err("tick failed", 500, error.message);
  return ok({ result: Array.isArray(data) ? data[0] : data });
}

async function advanceDue() {
  const { data, error } = await supabase.rpc("ottoq_sim_advance_due_runs", { p_max_runs: 25 });
  if (error) return err("advance_due failed", 500, error.message);
  return ok({ advanced_count: data });
}

async function injectDrCall(simRunId: string, req: Request) {
  const body = await readJson<{ duration_min?: number; cap_kw?: number; reason?: string }>(req);
  const duration = body.duration_min ?? 120;
  const cap_kw   = body.cap_kw       ?? 500;
  const reason   = body.reason       ?? "manual_injection";

  const { data: run, error: runErr } = await supabase
    .from("ottoq_sim_runs")
    .select("sim_run_id, depot_id, sim_clock_current")
    .eq("sim_run_id", simRunId).single();
  if (runErr || !run) return err("sim_run not found", 404);

  const issuedAt   = run.sim_clock_current;
  const expiresAt  = new Date(new Date(issuedAt).getTime() + duration * 60_000).toISOString();

  const { data, error } = await supabase
    .from("ottoq_dr_calls")
    .insert({
      depot_id:             run.depot_id,
      sim_run_id:           simRunId,
      issued_at:            issuedAt,
      expires_at:           expiresAt,
      duration_minutes:     duration,
      required_load_cap_kw: cap_kw,
      reason,
      program:              "MANUAL_OVERRIDE",
      call_status:          "active",
      data_source:          "twin"
    })
    .select("dr_call_id").single();
  if (error) return err("dr_call insert failed", 500, error.message);

  await supabase.rpc("ottoq_record_event", {
    p_actor_type: "command_center_operator",
    p_actor_id:   "twin_control_api",
    p_event_type: "twin.dr_call_issued",
    p_entity_type:"depot",
    p_entity_id:  run.depot_id,
    p_payload:    { dr_call_id: data?.dr_call_id, duration_min: duration, cap_kw, reason, source: "manual" },
    p_severity:   "warning",
    p_ingest_source: "twin",
    p_data_source:   "twin",
    p_sim_run_id:    simRunId
  });

  return ok({ dr_call_id: data?.dr_call_id, expires_at: expiresAt });
}

async function injectFault(simRunId: string, req: Request) {
  const body = await readJson<{ kind?: string; target_id?: string; payload?: Record<string, unknown> }>(req);
  if (!body.kind) return err("kind required (e.g. charger_offline)");

  // 0451: THE ONE KIND WITH AN ENGINE DOOR. This used to map to the event type
  // "twin.solar_inverter_blip" -- a solar-inverter event for a charger button -- and no engine
  // function reads that event, so the cockpit toasted "Injected" over a depot that changed nothing.
  // The door takes a DC fast charger at the RUN'S depot offline through
  // twin.ottoq_report_charger_fault (vehicles on it are replanned) and stamps the repair on the sim
  // clock so twin.ottoq_sim_recover_chargers returns it to service.
  if (body.kind === "charger_offline") {
    const repair = Number((body.payload as Record<string, unknown> | undefined)?.repair_minutes ?? 60);
    const { data, error } = await supabase.rpc("ottoq_twin_inject_charger_fault", {
      p_sim_run_id: simRunId,
      p_charger_id: body.target_id ?? null,
      p_repair_minutes: Number.isFinite(repair) ? repair : 60,
      p_actor: "cockpit_operator",
    });
    if (error) return err("charger fault injection failed", 500, error.message);
    const res = data as { ok?: boolean; reason?: string } | null;
    if (!res?.ok) return err(`charger fault not injected: ${res?.reason ?? "unknown"}`, 409, res);
    return ok({ ...res, kind: body.kind, engine_effect: "charger_faulted" });
  }

  const { data: run, error: runErr } = await supabase
    .from("ottoq_sim_runs")
    .select("depot_id, sim_clock_current")
    .eq("sim_run_id", simRunId).single();
  if (runErr || !run) return err("sim_run not found", 404);

  // Every other kind is recorded as an event and NOTHING ELSE: no engine function reads these event
  // types (measured 0451), so they change no state. The response says so rather than implying an
  // effect. The cockpit no longer offers them.
  const eventTypeMap: Record<string, string> = {
    grid_brownout:       "twin.grid_brownout",
    grid_voltage_sag:    "twin.grid_voltage_sag",
    grid_frequency:      "twin.grid_frequency_excursion",
    weather_storm:       "twin.weather_anomaly",
    bess_thermal_derate: "twin.bess_thermal_derate",
    bess_soc_limit:      "twin.bess_soc_limit",
  };
  const eventType = eventTypeMap[body.kind] ?? "anomaly.detected";

  const actorTypeMap: Record<string, string> = {
    grid_brownout:    "external_sensor",
    grid_voltage_sag: "external_sensor",
    grid_frequency:   "external_sensor",
    weather_storm:    "external_sensor",
    bess_thermal_derate: "bess_controller",
    bess_soc_limit:      "bess_controller",
  };
  const actorType = actorTypeMap[body.kind] ?? "command_center_operator";

  const { data, error } = await supabase.rpc("ottoq_record_event", {
    p_actor_type: actorType,
    p_actor_id:   "twin_control_api",
    p_event_type: eventType,
    p_entity_type:"depot",
    p_entity_id:  run.depot_id,
    p_payload:    { ...(body.payload ?? {}), injected_via: "control_api", kind: body.kind, target_id: body.target_id },
    p_severity:   "warning",
    p_ingest_source: "twin",
    p_data_source:   "twin",
    p_sim_run_id:    simRunId
  });
  if (error) return err("fault injection failed", 500, error.message);
  return ok({ event_id: data, kind: body.kind, event_type: eventType, engine_effect: "none" });
}

// 0451: the five canonical KPIs (CLAUDE.md 2.9) for one run. ottoq_kpi_five(p_run) is service-role only,
// so the cockpit reads it through this door.
async function runKpis(simRunId: string) {
  const { data, error } = await supabase.rpc("ottoq_kpi_five", { p_run: simRunId });
  if (error) return err("kpi read failed", 500, error.message);
  return ok(data);
}

// ---------------------------------------------------------------------------
// A.8 — Variability profile (live distribution-shaping knobs)
// ---------------------------------------------------------------------------
async function getVariability(simRunId: string) {
  const { data, error } = await supabase
    .from("ottoq_variability_profiles")
    .select("profile_id, knobs, notes, updated_at")
    .eq("sim_run_id", simRunId)
    .maybeSingle();
  if (error) return err("variability fetch failed", 500, error.message);
  if (!data) {
    // No profile yet → report neutral
    return ok({ sim_run_id: simRunId, knobs: {}, neutral: true });
  }
  return ok({ sim_run_id: simRunId, ...data });
}

// PUT body shapes (either):
//   { knobs: {...} }                         → replace the whole knob set
//   { merge: { ambient_temp_c: {shift:8} } } → shallow-merge into existing knobs
//   { template: "heat_wave" }                → re-instantiate from a named template
async function putVariability(simRunId: string, req: Request) {
  const body = await readJson<{ knobs?: Record<string, unknown>; merge?: Record<string, unknown>; template?: string }>(req);

  if (body.template) {
    const { data, error } = await supabase.rpc("ottoq_variability_instantiate", {
      p_sim_run_id: simRunId, p_template_name: body.template
    });
    if (error) return err("template instantiate failed", 500, error.message);
    return getVariability(simRunId);
  }

  // Load existing (for merge / upsert)
  const { data: existing } = await supabase
    .from("ottoq_variability_profiles")
    .select("profile_id, knobs")
    .eq("sim_run_id", simRunId)
    .maybeSingle();

  let nextKnobs: Record<string, unknown>;
  if (body.knobs) {
    nextKnobs = body.knobs;
  } else if (body.merge) {
    nextKnobs = { ...((existing?.knobs as Record<string, unknown>) ?? {}), ...body.merge };
  } else {
    return err("provide knobs, merge, or template");
  }

  if (existing) {
    const { error } = await supabase
      .from("ottoq_variability_profiles")
      .update({ knobs: nextKnobs, updated_at: new Date().toISOString() })
      .eq("sim_run_id", simRunId);
    if (error) return err("variability update failed", 500, error.message);
  } else {
    const { error } = await supabase
      .from("ottoq_variability_profiles")
      .insert({ sim_run_id: simRunId, knobs: nextKnobs, notes: "set via control_api" });
    if (error) return err("variability insert failed", 500, error.message);
  }
  return getVariability(simRunId);
}

async function listTemplates() {
  const { data, error } = await supabase
    .from("ottoq_variability_profiles")
    .select("name, knobs, notes")
    .not("name", "is", null)
    .order("name");
  if (error) return err("template list failed", 500, error.message);
  return ok({ templates: data });
}

// A.10 — full registry of shapeable variables (the UI renders its panel from this)
async function listCatalog() {
  const { data, error } = await supabase
    .from("ottoq_variability_catalog")
    .select("var_key, domain, label, definition, unit, kind, knob_types, neutral_value, min_value, max_value, step, select_options, is_primary, wired, display_order")
    .order("display_order");
  if (error) return err("catalog list failed", 500, error.message);
  return ok({ catalog: data });
}

// ---------------------------------------------------------------------------
// A.9 — State-streaming feed (cockpit reads these)
// ---------------------------------------------------------------------------
async function depotLayout(depotId: string) {
  const { data, error } = await supabase.rpc("ottoq_twin_depot_layout", { p_depot_id: depotId });
  if (error) return err("layout fetch failed", 500, error.message);
  return ok(data);
}

async function simSnapshot(simRunId: string) {
  const { data, error } = await supabase.rpc("ottoq_twin_snapshot", { p_sim_run_id: simRunId });
  if (error) return err("snapshot fetch failed", 500, error.message);
  return ok(data);
}

// A.9.2 — run-history ledger (cockpit History / Compare-Runs tab)
async function listRuns(url: URL) {
  const raw = Number(url.searchParams.get("limit") ?? "25");
  const limit = isFinite(raw) ? Math.max(1, Math.min(100, raw)) : 25;
  const { data, error } = await supabase.rpc("ottoq_twin_run_list", { p_limit: limit });
  if (error) return err("run list failed", 500, error.message);
  return ok({ runs: data ?? [] });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin":  "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, PUT, OPTIONS"
      }
    });
  }

  const url    = new URL(req.url);
  // path under the /otto-twin-control prefix
  const parts  = url.pathname.replace(/^\/otto-twin-control\/?/, "").replace(/^\/+|\/+$/g, "").split("/");
  const method = req.method.toUpperCase();

  // Auth posture: DEMO MODE — open on a private link (Chase's call). Reads AND
  // control are open; the operator controls who has the URL. authOk() is kept
  // for the future but NOT enforced.
  // ⚠️ HARDENING TODO (before any public/self-serve exposure): re-enable the
  // mutation gate below and move reads behind Supabase Auth with an operator role.
  //   const isMutation = method === "POST" || method === "PUT" || ...;
  //   if (isMutation && !authOk(req)) return err("unauthorized", 401);
  void authOk;  // referenced so the helper isn't flagged unused

  // GET /scenarios
  if (method === "GET" && parts[0] === "scenarios" && parts.length === 1) return listScenarios();

  // POST /scenarios/start
  if (method === "POST" && parts[0] === "scenarios" && parts[1] === "start") return startScenario(req);

  // POST /scenarios/stop
  if (method === "POST" && parts[0] === "scenarios" && parts[1] === "stop") return stopScenario(req);

  // GET /sim_runs            (A.9.2 run-history ledger — must precede the :id routes)
  if (method === "GET" && parts[0] === "sim_runs" && parts.length === 1) return listRuns(url);

  // GET /sim_runs/:id/status
  if (method === "GET" && parts[0] === "sim_runs" && parts[2] === "status") return simRunStatus(parts[1]);

  // POST /sim_runs/:id/tick
  if (method === "POST" && parts[0] === "sim_runs" && parts[2] === "tick") return advanceTick(parts[1]);

  // POST /sim_runs/:id/pause | /resume  (world-level freeze, honored by every tick path)
  if (method === "POST" && parts[0] === "sim_runs" && parts[2] === "pause") return pauseRun(parts[1]);
  if (method === "POST" && parts[0] === "sim_runs" && parts[2] === "resume") return resumeRun(parts[1]);

  // PUT /sim_runs/:id/playback
  if (method === "PUT" && parts[0] === "sim_runs" && parts[2] === "playback") return setPlayback(parts[1], req);

  // PUT /sim_runs/:id/time_scale  (honest speed: sim-minutes per tick; 60 = 1×)
  if (method === "PUT" && parts[0] === "sim_runs" && parts[2] === "time_scale") return setTimeScale(parts[1], req);

  // POST /sim_runs/:id/inject_dr_call
  if (method === "POST" && parts[0] === "sim_runs" && parts[2] === "inject_dr_call") return injectDrCall(parts[1], req);

  // POST /sim_runs/:id/inject_fault
  if (method === "POST" && parts[0] === "sim_runs" && parts[2] === "inject_fault") return injectFault(parts[1], req);

  // GET /sim_runs/:id/kpis  (0451: the five canonical KPIs for this run)
  if (method === "GET" && parts[0] === "sim_runs" && parts[2] === "kpis") return runKpis(parts[1]);

  // GET/PUT /sim_runs/:id/variability  (A.8 live distribution-shaping knobs)
  if (method === "GET" && parts[0] === "sim_runs" && parts[2] === "variability") return getVariability(parts[1]);
  if (method === "PUT" && parts[0] === "sim_runs" && parts[2] === "variability") return putVariability(parts[1], req);

  // GET /variability/templates  (named presets: __default__, __chaos__, scenarios)
  if (method === "GET" && parts[0] === "variability" && parts[1] === "templates") return listTemplates();

  // GET /variability/catalog  (A.10 — the full registry of shapeable variables; UI renders from this)
  if (method === "GET" && parts[0] === "variability" && parts[1] === "catalog") return listCatalog();

  // GET /depot/:id/layout  (A.9 static geometry — cockpit loads once)
  if (method === "GET" && parts[0] === "depot" && parts[2] === "layout") return depotLayout(parts[1]);

  // GET /sim_runs/:id/snapshot  (A.9 dynamic frame — cockpit polls)
  if (method === "GET" && parts[0] === "sim_runs" && parts[2] === "snapshot") return simSnapshot(parts[1]);

  // POST /advance_due  (cron entrypoint)
  if (method === "POST" && parts[0] === "advance_due") return advanceDue();

  // Health probe
  if (method === "GET" && (parts[0] === "" || parts[0] === "health")) {
    return ok({ service: "otto-twin-control", version: "1.9.1-kpis-fault-door", time: new Date().toISOString() });
  }

  return err(`route not found: ${method} /${parts.join("/")}`, 404);
});
