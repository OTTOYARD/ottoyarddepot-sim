// ============================================================================
// blackbox — the OTTO-Q flight-recorder lifecycle (backend-authoritative).
//
// This is THE single start/stop control path for a demo run. The Control tab
// (OperatorConsole) starts and stops through it, and the Runs tab downloads a
// run's forensic bundle through it, so there is exactly one mechanism:
//   · start    → control edge → ottoq_start_demo_run
//   · stop     → control edge → ottoq_sim_stop_and_reset
//   · download → GET /functions/v1/ottoq-run-blackbox?run=<id>  (forensic .json,
//     one file per 20 MB page; needs the operator export token)
// (2026-09-23: the Black Box tab and its scenario-deck / latest-run discovery
// helpers were removed; the Control tab owns start/stop and the run status.)
//
// All calls target the gxdrc backend. Lifecycle writes go through the control
// edge's service role; read-only discovery stays on the public PostgREST client.
// ============================================================================
import { OTTOQ_SUPABASE_URL, twin } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";

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
  const res = await twin.start(scenario, undefined, speedX, 1) as StartResult | null;
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
  const data = await twin.stop(simRunId, reason);
  // Depot is empty now — drop the active run so the canvas resets + the twin
  // feed stops polling. The run stays in ottoq_sim_runs (status completed) for
  // the Black Box download.
  useTwinStore.getState().setActiveSimRunId(null);
  // …and drop the last frame with it. Polling stops here, so a retained snapshot
  // freezes forever: the top bar kept reporting "Deployed 17 · Charging 24" over
  // a depot the backend had already emptied to 0/10 and 0/30. Every consumer of
  // `snapshot` reads the same stale frame, so clear it at the source.
  useTwinStore.getState().setSnapshot(null);
  // Clearing the scene must NOT depend on one more snapshot arriving: polling has
  // just stopped, so the driver may never see the run go terminal. Tear the scene
  // down here — empty roster, released stall paint, driver loop stopped.
  twinMotionDriver.clear();
  return (data as StopResult) ?? {
    ok: true, depot_reset_to_empty: true, vehicles_unplaced: 0, sessions_ended: 0, blackbox_ready: true,
  };
}

// ── Download the forensic bundle ──
// The edge function answers only the operator export token (sent in the
// x-ottoq-export-token header, never in the URL and never with the public
// key), and it pages: each response is at most 20 MB, and the
// X-OTTOQ-Next-Cursor header names the next page ("none" on the last). So we
// walk the pages and save each as its own file (the function names them
// -p1, -p2, ...). A big run is dozens of files, so callers show progress.
// The token is pasted once and kept in this browser only; a 401 clears it.
const TOKEN_KEY = "otto_blackbox_token";
const MAX_FILES = 200; // the largest twin run measured (816bd28c) is ~66 pages

export function getBlackboxToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setBlackboxToken(token: string | null): void {
  try {
    const t = token?.trim();
    if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: the operator is asked again next time */ }
}

function filenameFromDisposition(header: string | null, simRunId: string, page = 0): string {
  const fallback = `ottoq-blackbox-${simRunId.slice(0, 8)}${page > 0 ? `-p${page}` : ""}.json`;
  if (!header) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, "")); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

// The cursor a page's body names, when the X-OTTOQ-Next-Cursor header is missing: a cursor string to follow, "none" when
// export_paging says this is the last page (next_cursor null), or null when the body cannot say. A body with no
// export_paging (an unexpected shape, or the unpaged v7 function) is unknown, never complete: treating it as the last
// page would report a partial bundle as whole.
function cursorFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const paging = (body as { export_paging?: unknown }).export_paging;
  if (typeof paging !== "object" || paging === null || !("next_cursor" in paging)) return null;
  const next = (paging as { next_cursor: unknown }).next_cursor;
  if (next === null) return "none";
  return typeof next === "string" && next !== "" ? next : null;
}

function saveBlob(blob: Blob, name: string): void {
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

export async function downloadBlackbox(
  simRunId: string,
  onFile?: (saved: number) => void,
): Promise<{ files: number }> {
  const token = getBlackboxToken() ?? window.prompt("Paste the Black Box export token")?.trim() ?? "";
  if (!token) throw new Error("Black Box needs the export token; nothing was downloaded");
  setBlackboxToken(token);

  const base = `${OTTOQ_SUPABASE_URL}/functions/v1/ottoq-run-blackbox?run=${encodeURIComponent(simRunId)}`;
  let cursor: string | null = null;
  for (let n = 0; n < MAX_FILES; n++) {
    const partial = n > 0 ? `; ${n} file(s) saved, the bundle is INCOMPLETE` : "";
    let res: Response;
    try {
      res = await fetch(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base, {
        headers: { "x-ottoq-export-token": token },
      });
    } catch (e) {
      throw new Error(`Black Box download failed: ${e instanceof Error ? e.message : "network error"}${partial}`);
    }
    if (res.status === 401) {
      setBlackboxToken(null);
      throw new Error(`Black Box token refused (401)${partial}. Press again and paste the current token.`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Black Box download failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}${partial}`);
    }
    const blob = await res.blob();
    saveBlob(blob, filenameFromDisposition(res.headers.get("content-disposition"), simRunId, n));
    onFile?.(n + 1);
    // The header is exposed to the browser; if a proxy strips it, the body carries the same cursor. If neither says,
    // the walk stops and says so rather than calling the bundle whole.
    let next = res.headers.get("x-ottoq-next-cursor");
    if (next === null || next === "") {
      let parsed: unknown = null;
      try { parsed = JSON.parse(await blob.text()); } catch { /* unreadable: unknown, as below */ }
      next = cursorFromBody(parsed);
      if (next === null) {
        throw new Error(`Black Box saved ${n + 1} file(s) but cannot tell whether more follow; the bundle may be INCOMPLETE`);
      }
    }
    if (next === "none") return { files: n + 1 };
    cursor = next;
  }
  throw new Error(`Black Box stopped after ${MAX_FILES} files; the bundle is INCOMPLETE`);
}
