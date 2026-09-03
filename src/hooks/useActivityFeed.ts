// useActivityFeed — polls ottoq_activity_feed RPC for the active sim run.
// Used by TwinDecisionLogTab to show the "why" behind every OTTO-Q decision.
import { useEffect, useRef } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useActivityFeedStore } from "@/store/activityFeedStore";
import { useTwinStore } from "@/store/twinStore";

const POLL_MS = 4000;

export function useActivityFeed(enabled = true) {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const { setRows, setError } = useActivityFeedStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !simRunId) {
      setRows([]);
      return;
    }

    const fetch = async () => {
      try {
        const { data, error } = await ottoQ.rpc("ottoq_activity_feed", {
          p_sim_run_id: simRunId,
          p_limit: 200,
        });
        if (error) {
          setError(String(error.message ?? error));
          return;
        }
        setRows((data as any[]) ?? []);
        setError(null);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    };

    fetch();
    timerRef.current = setInterval(fetch, POLL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [simRunId, enabled, setRows, setError]);
}