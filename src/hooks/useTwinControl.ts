// ============================================================================
// useTwinControl — Play/Pause/Step for the live twin.
// When "playing", repeatedly POSTs /tick (keyless) so the sim advances in real
// time; the snapshot poll (useTwinFeed) renders each new frame. Speed controls
// tick cadence.
//
// Pause is WORLD-level, not tab-level: it also flips the run to status
// 'paused' on the backend, which every advance path honors (other open tabs'
// tick loops no-op, and the 2-min pg_cron decide/wave loop skips it). Without
// that, any second tab kept the world moving and Pause looked broken.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { twin } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

export function useTwinControl() {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);          // 1–10×; ALWAYS start at 1× real pace
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const stepOnce = useCallback(async () => {
    if (!activeSimRunId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await twin.tick(activeSimRunId); }
    catch { /* surfaced via snapshot connected=false */ }
    finally { inFlight.current = false; setBusy(false); }
  }, [activeSimRunId]);

  // Play loop: cadence = clamp(2400/speed) ms, min 600ms
  useEffect(() => {
    if (!playing || !activeSimRunId) return;
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      await stepOnce();
      if (cancelled) return;
      const delay = Math.max(600, Math.round(2400 / speed));
      timer.current = setTimeout(loop, delay);
    };
    loop();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [playing, speed, activeSimRunId, stepOnce]);

  // Auto-pause if the run goes away
  useEffect(() => { if (!activeSimRunId) setPlaying(false); }, [activeSimRunId]);

  // Backend calls are fire-and-forget: a 409 just means the run was already
  // in that state (e.g. play() right after starting a fresh run).
  const play = useCallback(() => {
    setPlaying(true);
    if (activeSimRunId) twin.resume(activeSimRunId).catch(() => {});
  }, [activeSimRunId]);

  const pause = useCallback(() => {
    setPlaying(false);
    if (activeSimRunId) twin.pause(activeSimRunId).catch(() => {});
  }, [activeSimRunId]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  return {
    playing, speed, busy,
    play,
    pause,
    toggle,
    step: stepOnce,
    setSpeed,
  };
}
