// ============================================================================
// DepotViewer — the live 3D depot on its own: no cockpit, no panels, no controls that touch the world.
//
// Chase, 2026-10-02: in OrchestrAV and OTTO-PULSE, "a direct snapshot that could be spun around of the live depot from
// either various corners of the depot or along middle section pole ... It could be blank or just show empty just as
// the twin UI does before a simulation has started. Then when a simulation has started it loads similarly and then you
// can see the vehicles moving around in action ... mirrored from the actual twin 3-D rendering."
//
// It is the twin's own scene (DepotScene3D) and motion driver, fed the twin's own snapshots (useViewerFeed), so what it
// draws is what the twin draws. The contract with a framing page is src/viewer/protocol.ts. It reads and draws; it has
// no control that starts, stops, pauses or changes a run.
// ============================================================================
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { SceneErrorBoundary } from "@/components/canvas/SceneErrorBoundary";
import { useTwinSceneBridge } from "@/hooks/useTwinSceneBridge";
import {
  VIEW_SOURCE, VIEWER_CAM_IDS, isTrustedOrigin, parseViewerParams, readParentMessage,
  type ViewToParent, type ViewerCamId,
} from "./protocol";
import { VIEWER_CAMS } from "./viewerCams";
import { stateWords } from "./viewWords";
import { useViewerFeed } from "./useViewerFeed";

const DepotScene3D = lazy(() => import("@/components/canvas/DepotScene3D"));

/** Extra origins allowed to steer the view, comma-separated (VITE_VIEW_PARENT_ORIGINS), beside the built-in list. */
const EXTRA_ORIGINS = String(import.meta.env.VITE_VIEW_PARENT_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch { return false; }
}

const BTN = "inline-flex h-7 min-w-7 items-center justify-center rounded border border-white/15 bg-black/55 px-2 font-mono text-[10.5px] text-ink-dim backdrop-blur transition-colors hover:border-white/30 hover:text-white [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:min-w-9";

export default function DepotViewer() {
  const params = useMemo(() => parseViewerParams(window.location.search), []);
  const framed = useMemo(() => { try { return window.self !== window.top; } catch { return true; } }, []);
  const [pin, setPin] = useState<string | null>(params.run);
  const [cam, setCam] = useState<ViewerCamId>(params.cam);
  const [shot, setShot] = useState(1);
  const [spin, setSpin] = useState(params.spin);
  const [hostVisible, setHostVisible] = useState(true);
  const [docVisible, setDocVisible] = useState(() => !document.hidden);
  const [full, setFull] = useState(false);
  const [webgl] = useState(hasWebGL);
  const parentOrigin = useRef<string | null>(null);
  const visible = hostVisible && docVisible;

  const state = useViewerFeed(pin, visible);
  useTwinSceneBridge();

  const frameCam = useCallback((c: ViewerCamId) => { setCam(c); setShot((n) => n + 1); }, []);
  const framing = useMemo(() => ({ ...VIEWER_CAMS[cam], n: shot }), [cam, shot]);
  const viewer = useMemo(() => ({ framing, spin, paused: !visible, onInteract: () => setSpin(false) }), [framing, spin, visible]);

  // ── the page that frames this one ──────────────────────────────────────────
  const post = useCallback((m: ViewToParent) => {
    if (!framed) return;
    // Nothing posted is secret (a read-only picture's state), so it goes to the frame whatever its origin; a frame
    // that has spoken first is answered at its own origin only.
    try { window.parent.postMessage(m, parentOrigin.current ?? "*"); } catch { /* the frame went away */ }
  }, [framed]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !isTrustedOrigin(e.origin, EXTRA_ORIGINS)) return;
      const m = readParentMessage(e.data);
      if (!m) return;
      parentOrigin.current = e.origin;
      if (m.type === "visibility") setHostVisible(m.visible);
      else if (m.type === "run") setPin(m.runId);
      else if (m.type === "camera") frameCam(m.cam);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameCam]);

  useEffect(() => { post(webgl ? { source: VIEW_SOURCE, type: "ready" } : { source: VIEW_SOURCE, type: "webgl_unavailable" }); }, [post, webgl]);
  const stateKey = JSON.stringify(state);
  useEffect(() => { post({ source: VIEW_SOURCE, type: "state", state }); }, [stateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onVis = () => setDocVisible(!document.hidden);
    const onFull = () => setFull(!!document.fullscreenElement);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("fullscreenchange", onFull);
    return () => { document.removeEventListener("visibilitychange", onVis); document.removeEventListener("fullscreenchange", onFull); };
  }, []);
  const toggleFull = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch { /* a frame without allow="fullscreen" */ }
  };

  const words = stateWords(state);
  const twinHref = (() => {
    const u = new URL("/", window.location.href); // the twin itself: this page's own origin
    const run = state.kind === "live" || state.kind === "ended" ? state.runId : pin;
    if (run) u.searchParams.set("run", run);
    return u.toString();
  })();

  return (
    <div className="fixed inset-0 overflow-hidden bg-canvas-base font-ui text-ink" style={{ height: "100dvh" }}>
      {webgl ? (
        <SceneErrorBoundary onReturnTo2D={() => window.location.reload()} actionLabel="Reload the view">
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-faint">Loading the depot…</div>}>
            <DepotScene3D chrome="viewer" viewer={viewer} />
          </Suspense>
        </SceneErrorBoundary>
      ) : (
        <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-ink-dim">
          This browser cannot draw the 3D depot (no WebGL). The twin itself has a 2D map.
        </div>
      )}

      {/* what the view is showing */}
      <div className="pointer-events-none absolute left-2 top-2 right-2 flex items-start justify-between gap-2">
        <div role="status" aria-live="polite"
          className="pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded border border-white/10 bg-black/60 px-2 py-1 text-[11px] leading-4 text-white backdrop-blur">
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${words.tone === "live" ? "animate-pulse bg-emerald-400" : words.tone === "warn" ? "bg-amber-400" : "bg-ink-faint"}`} />
          <span className="min-w-0 truncate">{words.text}</span>
        </div>
        {!params.embed && (
          <a href={twinHref} target="_blank" rel="noopener noreferrer"
            className="pointer-events-auto inline-flex shrink-0 items-center gap-1 rounded border border-white/10 bg-black/60 px-2 py-1 text-[11px] text-ink-dim backdrop-blur hover:text-white">
            OTTO-TWIN <ExternalLink aria-hidden size={10} />
          </a>
        )}
      </div>

      {/* cameras, spin, full screen */}
      <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-1" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div role="group" aria-label="Camera" className="flex flex-wrap gap-1">
          {VIEWER_CAM_IDS.map((id) => (
            <button key={id} type="button" onClick={() => frameCam(id)} title={VIEWER_CAMS[id].hint} aria-pressed={cam === id}
              className={`${BTN} ${cam === id ? "!border-brand-red !bg-brand-red/85 !text-white" : ""}`}>
              {VIEWER_CAMS[id].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setSpin((s) => !s)} aria-pressed={spin} title={spin ? "Stop turning" : "Turn the view slowly"}
          className={`${BTN} ${spin ? "!border-white/40 !text-white" : ""}`}>
          {spin ? <Pause aria-hidden size={12} /> : <Play aria-hidden size={12} />}<span className="ml-1">Spin</span>
        </button>
        {document.fullscreenEnabled && (
          <button type="button" onClick={toggleFull} title={full ? "Leave full screen" : "Full screen"} aria-label={full ? "Leave full screen" : "Full screen"} className={`${BTN} ml-auto`}>
            {full ? <Minimize2 aria-hidden size={12} /> : <Maximize2 aria-hidden size={12} />}
          </button>
        )}
      </div>
    </div>
  );
}
