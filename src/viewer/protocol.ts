// ============================================================================
// The live view's contract: its URL, and the messages it trades with the page that frames it.
//
// Chase, 2026-10-02: replace the cockpits' map sections with "a direct snapshot that could be spun around of the live
// depot from either various corners of the depot or along middle section pole ... blank or just show empty just as the
// twin UI does before a simulation has started ... mirrored from the actual twin 3-D rendering."
//
// The view is this app's own 3D depot (DepotScene3D, driven by the same snapshot feed and motion driver), served
// chrome-less at /view.html so OrchestrAV and OTTO-PULSE can frame it. The cockpits carry the same contract in
// src/lib/twin/twinView.ts; the two are kept word for word in step, and each side's tests pin it.
//
//   /view.html?run=<sim_run_id>&cam=<cam>&spin=0|1&embed=1
//
//   run     pin the view to one run. Absent: follow the live run at the twin depot, and show the empty depot when
//           there is none (exactly what the twin shows before a run starts).
//   cam     the opening camera (VIEWER_CAMS). Absent: the south-east corner.
//   spin    1 (default) turns the view slowly until someone takes hold of it; 0 holds still.
//   embed   1 when framed by a cockpit: the view drops the link back to itself and posts its state to the parent.
//
// Messages, in both directions, are plain objects with `source` naming the sender. Nothing in either is secret: the
// view is a read-only picture of a simulated depot, and every command it accepts changes only what it shows.
// ============================================================================

export const VIEW_SOURCE = "otto-twin-view";
export const COCKPIT_SOURCE = "otto-cockpit";

export const VIEWER_CAM_IDS = ["se", "sw", "ne", "nw", "pole", "top"] as const;
export type ViewerCamId = (typeof VIEWER_CAM_IDS)[number];

export interface ViewerParams {
  run: string | null;
  cam: ViewerCamId;
  spin: boolean;
  embed: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRunId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function parseViewerParams(search: string): ViewerParams {
  const q = new URLSearchParams(search);
  const run = q.get("run");
  const cam = q.get("cam");
  return {
    run: isRunId(run) ? run.toLowerCase() : null,
    cam: (VIEWER_CAM_IDS as readonly string[]).includes(cam ?? "") ? (cam as ViewerCamId) : "se",
    spin: q.get("spin") !== "0",
    embed: q.get("embed") === "1",
  };
}

/** What the view tells its frame, whenever any of it changes. */
export type ViewState =
  | { kind: "connecting" }
  | { kind: "no_run" }
  | { kind: "live"; runId: string; status: string; simClock: string | null; cars: number }
  | { kind: "ended"; runId: string; status: string }
  | { kind: "not_found"; runId: string }
  | { kind: "other_depot"; runId: string }
  | { kind: "offline"; runId: string | null };

export type ViewToParent =
  | { source: typeof VIEW_SOURCE; type: "ready" }
  | { source: typeof VIEW_SOURCE; type: "state"; state: ViewState }
  | { source: typeof VIEW_SOURCE; type: "webgl_unavailable" };

export type ParentToView =
  | { source: typeof COCKPIT_SOURCE; type: "visibility"; visible: boolean }
  | { source: typeof COCKPIT_SOURCE; type: "run"; runId: string | null }
  | { source: typeof COCKPIT_SOURCE; type: "camera"; cam: ViewerCamId };

/**
 * The pages allowed to steer the view: the two cockpits and the twin as published, their Lovable previews, and a
 * developer's own machine. A message from anywhere else is ignored. Steering can only change what the view shows,
 * but a view that anyone could steer would be a view nobody could trust to show what its frame asked for.
 */
export function isTrustedOrigin(origin: string, extra: readonly string[] = []): boolean {
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  if (extra.includes(u.origin)) return true;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
  if (u.protocol !== "https:") return false;
  return /\.lovable\.app$/.test(u.hostname) || /\.lovableproject\.com$/.test(u.hostname);
}

/** A message from the frame, read defensively: anything not exactly the contract is dropped. */
export function readParentMessage(data: unknown): ParentToView | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.source !== COCKPIT_SOURCE) return null;
  if (m.type === "visibility" && typeof m.visible === "boolean") return { source: COCKPIT_SOURCE, type: "visibility", visible: m.visible };
  if (m.type === "run" && (m.runId === null || isRunId(m.runId))) {
    return { source: COCKPIT_SOURCE, type: "run", runId: m.runId === null ? null : (m.runId as string).toLowerCase() };
  }
  if (m.type === "camera" && (VIEWER_CAM_IDS as readonly string[]).includes(String(m.cam))) {
    return { source: COCKPIT_SOURCE, type: "camera", cam: m.cam as ViewerCamId };
  }
  return null;
}
