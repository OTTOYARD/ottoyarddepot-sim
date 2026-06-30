// ============================================================================
// OmniverseViewer — the "Photoreal" cockpit view.
//
// Streams the live, RTX path-traced depot from NVIDIA Isaac Sim (running on the
// AWS GPU box) into the cockpit over WebRTC, using NVIDIA's
// omniverse-webrtc-streaming-library in DIRECT (local) mode — it connects
// straight to the Kit app's signaling port, no session broker needed.
//
// The render box's public IP can change if the EC2 instance is stopped/started
// (use an Elastic IP for permanence). Override at runtime without a rebuild:
//   localStorage.setItem('ottoq_omniverse_ip', '<new-ip>')
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { AppStreamer, StreamType, type DirectConfig, type StreamEvent } from "@nvidia/omniverse-webrtc-streaming-library";

const DEFAULT_SERVER = "34.239.177.167";
const SIGNALING_PORT = 49100;

type Status = "connecting" | "live" | "error";

export function OmniverseViewer() {
  const server =
    (typeof localStorage !== "undefined" && localStorage.getItem("ottoq_omniverse_ip")) || DEFAULT_SERVER;
  const [status, setStatus] = useState<Status>("connecting");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // connect once (StrictMode double-mount guard)
    started.current = true;

    const streamConfig: DirectConfig = {
      videoElementId: "remote-video",
      audioElementId: "remote-audio",
      authenticate: true,
      maxReconnects: 20,
      signalingServer: server,
      signalingPort: SIGNALING_PORT,
      mediaServer: server,
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
    } as DirectConfig;

    try {
      AppStreamer.connect({ streamConfig, streamSource: StreamType.DIRECT }).catch((err: unknown) => {
        console.error("Omniverse stream connect failed", err);
        setStatus("error");
      });
    } catch (err) {
      console.error("Omniverse stream connect threw", err);
      setStatus("error");
    }

    return () => {
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
              <>NVIDIA Isaac Sim · RTX path-traced depot · <span className="font-mono">{server}:{SIGNALING_PORT}</span></>
            ) : (
              <>
                Couldn't reach <span className="font-mono">{server}:{SIGNALING_PORT}</span>. Make sure the render box is
                running and its WebRTC ports are open. Point at a different box with{" "}
                <span className="font-mono">localStorage ottoq_omniverse_ip</span>.
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
