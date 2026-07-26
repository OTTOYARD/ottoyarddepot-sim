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

  // PLAYBACK SPEED (founder spec 2026-07-25). The slider now drives the real
  // playback contract — `ottoq_set_playback(run,'live',speed_x)` — where 1× is TRUE
  // 1:1 (one real second = one sim second) and the backend hard-caps at 3×.
  //
  // It previously drove `time_scale` (sim-MINUTES per tick), which was backwards for
  // this goal: raising it gave the same crawl with BIGGER jumps, and its client floor
  // of 15 pinned the minimum at 75× real time — 1:1 was unreachable. Anything faster
  // than 3× is a JUMP (ottoq_sim_jump_forward), not a speed change.
  // Debounced so dragging doesn't spam the API.
  const setSpeed = useCallback((v: number) => {
    const clamped = Math.min(3, Math.max(1, v));
    setSpeedState(clamped);
    if (tsTimer.current) clearTimeout(tsTimer.current);
    tsTimer.current = setTimeout(() => {
      // Read the run id FRESH from the store: Start seeds the run and adopts its
      // id in the same handler, so a value closed over at render time is stale.
      const id = useTwinStore.getState().activeSimRunId;
      if (id) twin.setPlayback(id, 'live', clamped).catch(() => {});
    }, 400);
  }, []);

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
  // Pause/Resume must move BOTH halves of the world: the server run (which owns
  // the clock) and the renderer's interpolation (which owns what the eye sees).
  // Flipping only the run left the cars gliding on for a world that had already
  // stopped — the driver reads twinStore.paused via useTwinSceneBridge.
  const play = useCallback(() => {
    setPlaying(true);
    useTwinStore.getState().setPaused(false);
    // Fresh read (see setSpeed): the run may have just been adopted this handler.
    const id = useTwinStore.getState().activeSimRunId;
    if (id) twin.resume(id).catch(() => {});
  }, []);

  const pause = useCallback(() => {
    setPlaying(false);
    useTwinStore.getState().setPaused(true);
    const id = useTwinStore.getState().activeSimRunId;
    if (id) twin.pause(id).catch(() => {});
  }, []);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  return {
    playing, speed,
    play,
    pause,
    toggle,
    setSpeed,
  };
}
