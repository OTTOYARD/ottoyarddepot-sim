// ============================================================================
// OmniverseViewer — the "Photoreal" cockpit view.
//
// Streams the live, RTX path-traced depot from NVIDIA Isaac Sim (running on the
// AWS GPU box) into the cockpit over WebRTC, using NVIDIA's
// omniverse-webrtc-streaming-library in DIRECT (local) mode — it connects
// straight to the Kit app's signaling port, no session broker needed.
//
// The render box now has a permanent Elastic IP, so DEFAULT_SERVER is stable.
// A runtime override still exists for pointing at a different box, but under a
// VERSIONED key so an override written against an old rotating IP can never
// silently beat the current default again:
//   localStorage.setItem('ottoq_omniverse_ip_v2', '<new-ip>')
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { AppStreamer, StreamType, type DirectConfig, type StreamEvent } from "@nvidia/omniverse-webrtc-streaming-library";

const DEFAULT_SERVER = "54.166.168.193";
const SIGNALING_PORT = 49100;
const OVERRIDE_KEY = "ottoq_omniverse_ip_v2";

type Status = "connecting" | "live" | "error";

export function OmniverseViewer() {
  const override =
    typeof localStorage !== "undefined" ? localStorage.getItem(OVERRIDE_KEY) : null;
  // Any override that matches the default is not an override at all.
  const server = override && override !== DEFAULT_SERVER ? override : DEFAULT_SERVER;
  const [status, setStatus] = useState<Status>("connecting");
  const [activeServer, setActiveServer] = useState(server);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // connect once (StrictMode double-mount guard)
    started.current = true;

    // Self-healing: try the override first, then fall back to the Elastic IP
    // default. A stale override (pointing at a dead IP) can never blank the
    // stream again — the app retries the known-good default on its own.
    const candidates =
      server !== DEFAULT_SERVER ? [server, DEFAULT_SERVER] : [DEFAULT_SERVER];

    const baseConfig: Omit<DirectConfig, "signalingServer" | "mediaServer"> = {
      videoElementId: "remote-video",
      audioElementId: "remote-audio",
      authenticate: true,
      maxReconnects: 2,
      signalingPort: SIGNALING_PORT,
      nativeTouchEvents: true,
      width: 1920,
      height: 1080,
      fps: 60,
      onStart: (m: StreamEvent) => {
        const e = m as unknown as { action?: string; status?: string };
        if (e?.action === "start" && e?.status === "success") setStatus("live");
        if (e?.status === "error") setStatus("error");
      },
      onUpdate: () => {},
      onCustomEvent: () => {},
      onStop: () => {},
      onTerminate: () => {},
    };

    let attempt = 0;
    let cancelled = false;

    const tryNext = () => {
      if (cancelled) return;
      if (attempt >= candidates.length) {
        setStatus("error");
        return;
      }
      const srv = candidates[attempt++];
      setActiveServer(srv);
      const streamConfig = {
        ...baseConfig,
        signalingServer: srv,
        mediaServer: srv,
      } as DirectConfig;
      AppStreamer.connect({ streamConfig, streamSource: StreamType.DIRECT }).catch(() => {
        // This candidate is unreachable — fall through to the next one.
        tryNext();
      });
    };

    tryNext();

    return () => {
      cancelled = true;
      try { AppStreamer.stop(); } catch { /* noop */ }
    };
  }, [server]);

  return (
    <div className="absolute inset-0 bg-black">
      {/* Mouse/keyboard interaction is forwarded to the streamed app by the library */}
      <video
        id="remote-video"
        autoPlay
        muted
        playsInline
        tabIndex={-1}
        className="w-full h-full object-contain"
        style={{ visibility: status === "live" ? "visible" : "hidden" }}
      />
      <audio id="remote-audio" muted />

      {status !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
          <div className="font-display text-sm uppercase tracking-[0.08em] text-ink">
            {status === "connecting" ? "Connecting to photoreal stream…" : "Photoreal stream unavailable"}
          </div>
          <div className="text-[12px] text-ink-dim max-w-sm leading-relaxed">
            {status === "connecting" ? (
              <>NVIDIA Isaac Sim · RTX path-traced depot · <span className="font-mono">{activeServer}:{SIGNALING_PORT}</span></>
            ) : (
              <>
                Couldn't reach <span className="font-mono">{activeServer}:{SIGNALING_PORT}</span>. Make sure the render box is
                running and its WebRTC ports are open. Point at a different box with{" "}
                <span className="font-mono">localStorage ottoq_omniverse_ip_v2</span>.
              </>
            )}
          </div>
          {status === "connecting" && (
            <div className="w-6 h-6 border-2 border-brand-red border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      )}
    </div>
  );
}
