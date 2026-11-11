// ============================================================================
// usePowerOneLine — reads otto-q-core's ottoq_power_one_line for the Power tab.
//
// One read-only RPC (otto-q-core 0810). With no run named, the engine answers for the depot's live run, else for the
// newest run it measured. It polls every 5 s while a run is live (the transformers' load moves by the tick) and once a
// minute otherwise. Until 0810 is applied the RPC answers with an error: it lands in `error`, the tab shows its calm
// panel, and a failed poll keeps the last good reading.
// ============================================================================
import { useEffect, useState } from 'react';
import { ottoQ } from '@/lib/ottoQClient';
import { NASHVILLE_DEPOT } from '@/lib/ottoTwin';
import { readOneLine, type OneLine } from '@/lib/powerOneLine';

export const LIVE_POLL_MS = 5_000;
export const IDLE_POLL_MS = 60_000;

export interface PowerOneLineState {
  oneLine: OneLine | null;
  error: string | null;
  loading: boolean;
}

export function usePowerOneLine(runId: string | null, live: boolean, enabled = true): PowerOneLineState {
  const [oneLine, setOneLine] = useState<OneLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const poll = async () => {
      try {
        const { data, error: rpcError } = await ottoQ.rpc('ottoq_power_one_line', {
          p_depot_id: NASHVILLE_DEPOT,
          p_sim_run_id: runId,
        });
        if (cancelled) return;
        if (rpcError) {
          setError(String(rpcError.message ?? rpcError));
          return;
        }
        setOneLine(readOneLine(data));
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void poll();
    const t = setInterval(poll, live ? LIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, runId, live]);

  return { oneLine, error, loading };
}
