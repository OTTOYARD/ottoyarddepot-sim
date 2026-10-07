// useRunLearning — what the planners learned inside the active run (public.ottoq_run_learning, otto-q-core 0613).
//
// The same read the planners and the agent make on each pass, so the strip shows what they were told, not a summary of
// it. It covers the last 20 ticks, the window the planner edge function asks for. One call is light (it reads the
// run's own proposals, bookings and the depot's 40 chargers), so a 10 s poll is plenty against a 30 s tick.
//
// Pause follows the sim, as every other stream here: a paused cockpit issues no reads and keeps what it has.
import { useEffect, useState } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import type { RunLearning } from "@/lib/runLearning";

const POLL_MS = 10_000;
export const LEARNING_WINDOW_TICKS = 20;

export interface RunLearningState {
  data: RunLearning | null;
  error: string | null;
}

export function useRunLearning(enabled = true): RunLearningState {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const [data, setData] = useState<RunLearning | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [simRunId]);

  useEffect(() => {
    if (!enabled || !simRunId || paused) return;
    let cancelled = false;
    let ended = false;
    const poll = async () => {
      if (ended) return;
      try {
        const { data: d, error: e } = await ottoQ.rpc("ottoq_run_learning", {
          p_sim_run_id: simRunId, p_lookback_ticks: LEARNING_WINDOW_TICKS, p_detail: true,
        });
        if (cancelled) return;
        if (e) { setError(String(e.message ?? e)); return; }
        const l = d && typeof d === "object" && !Array.isArray(d) ? (d as RunLearning) : null;
        setData(l);
        setError(null);
        // an ended run's totals do not change: one read is the answer
        if (l?.ok && l.live === false) ended = true;
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled, simRunId, paused]);

  return { data, error };
}
