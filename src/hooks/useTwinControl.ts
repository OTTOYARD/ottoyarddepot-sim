// ============================================================================
// useTwinControl — Pause/Resume + speed for the live twin.
// The WORLD CLOCK is server-side (pg_cron metronome advances every running
// run); this hook never posts ticks. Pause/Resume flip the run's status on
// the backend (every advance path honors it — the metronome skips paused
// runs), and Speed sets the run's real time-compression (time_scale).
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { twin } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

export function useTwinControl() {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);     // 1–10×; ALWAYS start at 1× real pace
  const tsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // HONEST SPEED: the slider drives the twin's real time-compression
  // (time_scale = 60 × slider, sim-minutes per tick; server metronome keeps
  // tick RATE steady). Debounced so dragging doesn't spam the API. The old
  // behavior (only shrinking the ms between browser tick posts) was a no-op
  // next to 11-20s server ticks — the slider provably did nothing.
  const setSpeed = useCallback((v: number) => {
    setSpeedState(v);
    if (tsTimer.current) clearTimeout(tsTimer.current);
    tsTimer.current = setTimeout(() => {
      if (activeSimRunId) twin.setTimeScale(activeSimRunId, Math.min(480, Math.max(15, 60 * v))).catch(() => {});
    }, 400);
  }, [activeSimRunId]);

  // NO BROWSER TICK LOOP. The server-side metronome (pg_cron →
  // ottoq_demo_metronome) owns the world clock: it advances every running run
  // ~2-5×/min, tab-independent. The old client loop POSTed /tick in parallel
  // and COLLIDED with the metronome's run lock — every collision surfaced as a
  // "tick failed: lock/statement timeout" 500 error modal on the deployed
  // site. Play/Pause below still control the WORLD (server resume/pause);
  // speed controls the world's real time-compression (time_scale).

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
    playing, speed,
    play,
    pause,
    toggle,
    setSpeed,
  };
}
