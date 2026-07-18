// ============================================================================
// OTTO-TWIN backend client — talks to the server-authoritative twin
// (Supabase edge function `otto-twin-control`). READS are public; CONTROL
// actions require an operator key stored in localStorage('otto_operator_key').
// ============================================================================

// The OTTO-Q / OTTO-TWIN backend (Supabase project gxdrcyphqjzjsuhxuqtg).
// The anon key is public by design (safe to ship in the client bundle) — it is
// the single source of truth for both the twin edge-function calls below and
// the supabase-js client in ottoQClient.ts (RPCs + the Black Box download).
export const OTTOQ_SUPABASE_URL = "https://gxdrcyphqjzjsuhxuqtg.supabase.co";
export const OTTOQ_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4ZHJjeXBocWp6anN1aHh1cXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjk3MDMsImV4cCI6MjA5MDkwNTcwM30.v7erbnrlciPknvx_EpUpewXrvR9-F3D-hH-jWmTW0zI";

const BASE = `${OTTOQ_SUPABASE_URL}/functions/v1/otto-twin-control`;
export const NASHVILLE_DEPOT = "11111111-1111-1111-1111-111111111111";

// ── Types (mirror ottoq_twin_snapshot / ottoq_twin_depot_layout) ──
export interface TwinStall {
  id: string; code: string; type: string; zone: string | null;
  canopy: string | null; covered: boolean | null;
  x: number; y: number; heading: number; connector_kw: number | null;
}
export interface TwinStructure {
  code: string; kind: string; title: string;
  x_ft: number; y_ft: number; width_ft: number; length_ft: number; rotation_deg: number;
}
export interface TwinLayout {
  depot: { id: string; name: string; origin_lat: number; origin_lng: number } | null;
  structures: TwinStructure[];
  stalls: TwinStall[];
}

export interface TwinVehicle {
  id: string; av_id: string; make: string; platform: string;
  state: string; soc: number; stall_id: string | null;
}
export interface TwinSnapshot {
  run: {
    sim_run_id: string; scenario: string; status: string;
    sim_clock: string; tick_count: number; time_scale: number; seed: number;
  };
  fleet: { counts: Record<string, number>; total: number; vehicles: TwinVehicle[] };
  stalls_status: { id: string; status: string; vehicle_id: string | null }[];
  energy: Record<string, number | string | null> | null;
  bess: Record<string, number | string | null> | null;
  weather: Record<string, number | string | null> | null;
  grid: Record<string, number | string | boolean | null> | null;
  counters: Record<string, number>;
  recent_events: { type: string; severity: string; at: string; entity: string; payload: unknown }[];
  variability: Record<string, unknown>;
  error?: string;
}

export interface Scenario {
  scenario_code: string; title: string; description: string;
  default_duration_hours: number; default_time_scale: number; status: string;
  fleet_overrides: Record<string, unknown>; weather_overrides: Record<string, unknown>;
  grid_overrides: Record<string, unknown>;
}

// ── Run-history ledger (mirrors ottoq_twin_run_list) ──
export interface TwinRunCounters {
  dispatches_total: number; dispatches_active: number; telemetry_packets: number;
  events_total: number; incidents_open: number; incidents_total: number;
  faults: number; charge_sessions: number;
}
export interface TwinRunSummary {
  sim_run_id: string; scenario: string; status: string;
  started_at: string | null; ended_at: string | null;
  sim_clock_start: string | null; sim_clock_current: string | null;
  tick_count: number; time_scale: number; seed: number; sim_minutes: number;
  counters: TwinRunCounters;
  variability: { spread_mult: number; rate_mult: number; tuned_knobs: number; notes: string | null } | null;
}

// ── Variability catalog (the registry the console renders from) ──
export type KnobType = "shift" | "spread" | "floor" | "ceiling" | "rate" | "select";
export interface CatalogVar {
  var_key: string; domain: string; label: string; definition: string;
  unit: string | null; kind: "continuous" | "rate" | "policy";
  knob_types: KnobType[];
  neutral_value: number | null; min_value: number | null; max_value: number | null; step: number | null;
  select_options: string[] | null; is_primary: boolean; wired: boolean; display_order: number;
}
export const DOMAIN_LABELS: Record<string, string> = {
  environment: "Environment & Weather",
  fleet_demand: "Fleet & Demand",
  energy_grid: "Energy & Grid",
  reliability: "Reliability & Faults",
  operations: "Operations & Service",
};

// ── Auth (demo: open on private link; key optional, not required) ──
export function getOperatorKey(): string | null {
  return localStorage.getItem("otto_operator_key");
}
export function setOperatorKey(key: string): void {
  if (key) localStorage.setItem("otto_operator_key", key);
  else localStorage.removeItem("otto_operator_key");
}

// ── Transport ──
async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" } });
  const j = await r.json();
  if (!j.ok) throw new Error([j.error, j.details].filter(Boolean).join(": ") || `GET ${path} failed`);
  return j.data as T;
}
async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = getOperatorKey();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!j.ok) throw new Error([j.error, j.details].filter(Boolean).join(": ") || `${method} ${path} failed`);
  return j.data as T;
}

// ── API ──
export const twin = {
  // reads (public)
  layout:    (depotId = NASHVILLE_DEPOT) => get<TwinLayout>(`/depot/${depotId}/layout`),
  snapshot:  (simRunId: string)          => get<TwinSnapshot>(`/sim_runs/${simRunId}/snapshot`),
  scenarios: ()                          => get<{ scenarios: Scenario[] }>(`/scenarios`),
  runs:      (limit = 25)                => get<{ runs: TwinRunSummary[] }>(`/sim_runs?limit=${limit}`),
  templates: ()                          => get<{ templates: { name: string; knobs: Record<string, unknown>; notes: string }[] }>(`/variability/templates`),
  catalog:   ()                          => get<{ catalog: CatalogVar[] }>(`/variability/catalog`),
  health:    ()                          => get<{ service: string; version: string; time: string }>(`/health`),

  // controls (operator key) — used in Phase 2+
  start:          (scenario_code: string, seed?: number) => send<{ sim_run_id: string; scenario_code: string }>("POST", `/scenarios/start`, { scenario_code, seed }),
  stop:           (sim_run_id: string)        => send("POST", `/scenarios/stop`, { sim_run_id }),
  tick:           (simRunId: string)          => send("POST", `/sim_runs/${simRunId}/tick`),
  pause:          (simRunId: string)          => send("POST", `/sim_runs/${simRunId}/pause`),
  resume:         (simRunId: string)          => send("POST", `/sim_runs/${simRunId}/resume`),
  /** honest speed: sim-minutes per tick (60 = 1×). The server metronome keeps
   *  the tick RATE steady; this changes how much sim-time each tick covers. */
  setTimeScale:   (simRunId: string, ts: number) => send("PUT", `/sim_runs/${simRunId}/time_scale`, { time_scale: ts }),
  status:         (simRunId: string)          => send("GET", `/sim_runs/${simRunId}/status`),
  getVariability: (simRunId: string)          => send("GET", `/sim_runs/${simRunId}/variability`),
  setVariability: (simRunId: string, body: object) => send("PUT", `/sim_runs/${simRunId}/variability`, body),
  injectFault:    (simRunId: string, body: object) => send("POST", `/sim_runs/${simRunId}/inject_fault`, body),
  injectDrCall:   (simRunId: string, body: object) => send("POST", `/sim_runs/${simRunId}/inject_dr_call`, body),
};
