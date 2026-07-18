// ============================================================================
// blackbox — the OTTO-Q flight-recorder lifecycle (backend-authoritative).
//
// This is THE single start/stop control path for a demo run. Both the
// Black Box panel and the Operator Console route through these functions so
// there is exactly one mechanism driving the run:
//   · start  → ottoq_start_demo_run       (purges the prior run, seeds a fresh one)
//   · stop   → ottoq_sim_stop_and_reset   (freezes the run, empties the depot)
//   · download → GET /functions/v1/ottoq-run-blackbox?run=<id>  (forensic .json)
//   · discover → ottoq_sim_runs (latest operator_demo row) on mount / refresh
//
// All calls target the gxdrc backend via ottoQClient / OTTOQ_* constants.
// ============================================================================
import { ottoQ } from "@/lib/ottoQClient";
import { OTTOQ_SUPABASE_URL, OTTOQ_ANON_KEY } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

// ── The 8 scenario decks the operator can record (scenario picker) ──
export interface Deck { code: string; label: string }
export const DECKS: Deck[] = [
  { code: "normal_day", label: "Normal Day" },
  { code: "aggressive_fleet_turnover", label: "Aggressive Fleet Turnover" },
  { code: "charger_outage_morning_rush", label: "Charger Outage — Morning Rush" },
  { code: "dr_event_cascade", label: "Demand-Response Cascade" },
  { code: "grid_brownout_at_peak", label: "Grid Brownout at Peak" },
  { code: "heat_wave", label: "Heat Wave" },
  { code: "winter_storm", label: "Winter Storm" },
  { code: "solar_underperformance_partly_cloudy", label: "Solar Underperformance" },
];
export const deckLabel = (code: string): string =>
  DECKS.find((d) => d.code === code)?.label ?? code;

// ── Run row shape (mirrors the ottoq_sim_runs discovery select) ──
export interface BlackboxRun {
  sim_run_id: string;
  scenario_code: string;
  status: string;
  tick_count: number;
  demo_speed_x: number;
}

// Lifecycle phase derived from the run's backend status.
export type BlackboxPhase = "idle" | "recording" | "stopped";

const RECORDING = new Set(["running", "active", "paused"]);
export function phaseFor(run: BlackboxRun | null): BlackboxPhase {
  if (!run) return "idle";
  const s = String(run.status).toLowerCase();
  if (RECORDING.has(s)) return "recording";
  if (s === "completed") return "stopped";
  return "idle";
}

// ── Start / Play: purge the prior run and seed a fresh recording ──
export interface StartResult {
  ok: boolean;
  sim_run_id: string;
  scenario: string;
  demo_speed_x: number;
  real_seconds_per_tick: number;
  runs_for_sim_days: number;
}
export async function startDemoRun(scenario: string, speedX: number): Promise<StartResult> {
  const { data, error } = await ottoQ.rpc("ottoq_start_demo_run", {
    p_scenario: scenario,
    p_speed: speedX,
    p_days: 1,
    p_seed: null,
  });
  if (error) throw new Error(error.message);
  const res = data as StartResult | null;
  if (!res?.ok || !res.sim_run_id) throw new Error("start_demo_run returned no run");
  // Adopt the fresh run so the twin feed (useTwinFeed) starts rendering it.
  useTwinStore.getState().setActiveSimRunId(res.sim_run_id);
  return res;
}

// ── Stop: freeze the run, reset the depot to empty, arm the Black Box ──
export interface StopResult {
  ok: boolean;
  depot_reset_to_empty: boolean;
  vehicles_unplaced: number;
  sessions_ended: number;
  blackbox_ready: boolean;
}
export async function stopAndReset(
  simRunId: string,
  reason = "operator_stop",
): Promise<StopResult> {
  const { data, error } = await ottoQ.rpc("ottoq_sim_stop_and_reset", {
    p_sim_run_id: simRunId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  // Depot is empty now — drop the active run so the canvas resets + the twin
  // feed stops polling. The run stays in ottoq_sim_runs (status completed) for
  // the Black Box download.
  useTwinStore.getState().setActiveSimRunId(null);
  return (data as StopResult) ?? {
    ok: true, depot_reset_to_empty: true, vehicles_unplaced: 0, sessions_ended: 0, blackbox_ready: true,
  };
}

// ── Discover the active / last operator run (mount + refresh) ──
// Uses a narrow SECURITY DEFINER RPC, not a direct table select: RLS blocks
// anon SELECT on ottoq_sim_runs (it returns [] with a 200), which left the
// panel permanently on "idle" and hid the Stop/Download states after a remount
// or when the run was started from the Operator Console instead.
export async function fetchLatestRun(): Promise<BlackboxRun | null> {
  const { data, error } = await ottoQ.rpc("ottoq_blackbox_latest_run");
  if (error) throw new Error(error.message);
  return (data as BlackboxRun | null) ?? null;
}

// ── Download the forensic bundle ──
// A plain window.open won't send the apikey, so we fetch the blob with the
// anon headers and click a temporary <a download>. The response is ~20MB and
// takes ~12s, so callers should show a spinner around this.
function filenameFromDisposition(header: string | null, simRunId: string): string {
  const fallback = `ottoq-blackbox-${simRunId.slice(0, 8)}.json`;
  if (!header) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, "")); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

export async function downloadBlackbox(simRunId: string): Promise<void> {
  const url = `${OTTOQ_SUPABASE_URL}/functions/v1/ottoq-run-blackbox?run=${encodeURIComponent(simRunId)}`;
  const res = await fetch(url, {
    headers: { apikey: OTTOQ_ANON_KEY, Authorization: `Bearer ${OTTOQ_ANON_KEY}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Black Box download failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get("content-disposition"), simRunId);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
