// useActivityFeed — drives the OTTO-Q decision STREAM from ottoq_activity_feed.
//
// Two behaviours matter here, and the second is the one Chase asked for.
//
// 1. MERGE, DO NOT REPLACE. Each poll returns the last 200 decisions; those are
//    merged into the accumulated stream rather than swapped for it, so rows
//    that age past the RPC's page do not vanish from under a reader and a poll
//    returning nothing new re-renders nothing. See activityFeedStore.
//
// 2. PAUSE FOLLOWS THE SIM. Chase, 2026-09-21: "If I pause the depot or the
//    simulation at any given point that should also pause the intelligence live
//    stream ... so that I can toggle over to it and scroll through recent
//    decisions or proposals." So while twinStore.paused is true this stops
//    polling entirely. It does NOT clear the rows — freezing has to preserve
//    exactly the scrollback he paused in order to read.
//
//    Pausing is a real stop, not a visual one: the interval is torn down, so a
//    paused cockpit issues no RPCs at all. That matters beyond tidiness, because
//    the alternative (keep polling, hide the result) would let the stream jump
//    forward the instant he resumes, which is the opposite of what a pause is
//    for.
//
// The run identity is watched separately from the pause. Changing runs REPLACES
// the stream via setRows — one run's decisions must never be appended to
// another's — while pausing only suspends it.
import { useEffect, useRef } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useActivityFeedStore } from "@/store/activityFeedStore";
import { useTwinStore } from "@/store/twinStore";

const POLL_MS = 4000;

export function useActivityFeed(enabled = true) {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const { mergeRows, setRows, setFrozen, setError } = useActivityFeedStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Run identity owns the stream's lifetime. A new or absent run clears it;
  // this deliberately does NOT depend on `paused`, so pausing never wipes rows.
  useEffect(() => {
    setRows([]);
  }, [simRunId, setRows]);

  // Mirror the sim's pause into the store so the view can say so without
  // reaching into twinStore itself.
  useEffect(() => {
    setFrozen(Boolean(paused) && Boolean(simRunId) && enabled);
  }, [paused, simRunId, enabled, setFrozen]);

  useEffect(() => {
    if (!enabled || !simRunId || paused) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const { data, error } = await ottoQ.rpc("ottoq_activity_feed", {
          p_sim_run_id: simRunId,
          p_limit: 200,
        });
        if (cancelled) return;
        if (error) {
          setError(String(error.message ?? error));
          return;
        }
        mergeRows((data as any[]) ?? []);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      }
    };

    poll();
    timerRef.current = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [simRunId, enabled, paused, mergeRows, setError]);
}
