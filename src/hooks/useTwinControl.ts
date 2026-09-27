// ============================================================================
// useTwinControl — Pause/Resume + speed for the live twin.
// The WORLD CLOCK is server-side (pg_cron metronome advances every running
// run); this hook never posts ticks. Pause/Resume flip the run's status on
// the backend (every advance path honors it — the metronome skips paused
// runs), and Speed sets the run's live playback speed (ottoq_set_playback).
//
// THE CONTROLS SHOW THE RUN, NOT A LOCAL GUESS (2026-09-23). Both values used
// to live only in React state: speed opened at 3× and playing at false, and
// neither ever read the run. A run started at 8× — from SQL, a second screen,
// or a page reload — showed "3×" on the slider and "Resume" on a button over a
// depot that was plainly running. Both now follow the snapshot, and a local
// change holds only until the backend has had time to confirm it.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { twin } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

/** Continuous-play ceiling. MUST match the hard clamp in ottoq_set_playback — the
 *  backend silently clamps anything above it, so a slider that offered more would lie.
 *  Skipping hours at a time is still a JUMP (ottoq_sim_jump_forward), not a speed. */
export const MAX_SPEED_X = 8;

/** How long a local change wins over the snapshot before the run is believed again. */
const LOCAL_HOLD_MS = 4000;

export function useTwinControl() {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const runStatus = useTwinStore((s) => s.snapshot?.run?.status ?? null);
  const runSpeed = useTwinStore((s) => s.snapshot?.run?.speed_x ?? null);
  const rendererPaused = useTwinStore((s) => s.paused);

  // 1–8× (ottoq_set_playback hard-clamps at 8; the slider matches).
  const [speed, setSpeedState] = useState(3);
  const [playing, setPlaying] = useState(false);
  const tsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSpeedAt = useRef(0);
  const localPlayAt = useRef(0);

  // Follow the run's own speed unless the operator has just moved the slider.
  useEffect(() => {
    if (typeof runSpeed !== "number" || !Number.isFinite(runSpeed)) return;
    if (Date.now() - localSpeedAt.current < LOCAL_HOLD_MS) return;
    setSpeedState(Math.min(MAX_SPEED_X, Math.max(1, Math.round(runSpeed))));
  }, [runSpeed]);

  // Follow the run's own status the same way. A running run with the renderer held
  // (Space, or Pause pressed a moment ago) reads as paused.
  useEffect(() => {
    if (!activeSimRunId) { setPlaying(false); return; }
    if (Date.now() - localPlayAt.current < LOCAL_HOLD_MS) return;
    if (runStatus === "running") setPlaying(!rendererPaused);
    else if (runStatus === "paused" || runStatus === "completed" || runStatus === "aborted") setPlaying(false);
  }, [activeSimRunId, runStatus, rendererPaused]);

  // A reload can attach to a run that the server is already advancing. Adopt
  // its transport state without sending a second resume/pause request.
  const syncFromRun = useCallback((status: string, speedX?: number) => {
    setPlaying(status === 'running');
    useTwinStore.getState().setPaused(status === 'paused');
    if (typeof speedX === 'number' && Number.isFinite(speedX)) setSpeedState(speedX);
  }, []);

  // PLAYBACK SPEED (founder spec 2026-07-25; ceiling raised 2026-08-11). The slider
  // drives the real playback contract — `ottoq_set_playback(run,'live',speed_x)` —
  // where 1× is TRUE 1:1 (one real second = one sim second). Debounced so dragging
  // doesn't spam the API.
  const setSpeed = useCallback((v: number) => {
    const clamped = Math.min(MAX_SPEED_X, Math.max(1, v));
    localSpeedAt.current = Date.now();
    setSpeedState(clamped);
    if (tsTimer.current) clearTimeout(tsTimer.current);
    tsTimer.current = setTimeout(() => {
      // Read the run id FRESH from the store: Start seeds the run and adopts its
      // id in the same handler, so a value closed over at render time is stale.
      const id = useTwinStore.getState().activeSimRunId;
      if (id) twin.setPlayback(id, 'live', clamped).catch(() => {});
    }, 400);
  }, []);

  // Pause/Resume must move BOTH halves of the world: the server run (which owns
  // the clock) and the renderer's interpolation (which owns what the eye sees).
  // Backend calls are fire-and-forget: a 409 just means the run was already in that state.
  const play = useCallback(() => {
    localPlayAt.current = Date.now();
    setPlaying(true);
    useTwinStore.getState().setPaused(false);
    const id = useTwinStore.getState().activeSimRunId;
    if (id) twin.resume(id).catch(() => {});
  }, []);

  const pause = useCallback(() => {
    localPlayAt.current = Date.now();
    setPlaying(false);
    useTwinStore.getState().setPaused(true);
    const id = useTwinStore.getState().activeSimRunId;
    if (id) twin.pause(id).catch(() => {});
  }, []);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  return { playing, speed, play, pause, toggle, setSpeed, syncFromRun };
}
