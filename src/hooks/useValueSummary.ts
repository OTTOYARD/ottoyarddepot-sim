// ============================================================================
// useValueSummary — reads otto-q-core's ottoq_value_summary for the Value tab.
//
// One read-only RPC (otto-q-core 0576) over a sweep that runs overnight, so it
// polls once a minute while the tab is open; the numbers move by the test day,
// not by the second. With p_sweep_code null the function answers for the
// newest value sweep.
//
// Written ahead of the function. Until 0576 is applied the RPC answers with an
// error; it lands in `error`, and the tab shows its calm "not measured yet"
// panel, never a crash. A failed poll keeps the last good reading.
// ============================================================================
import { useEffect, useState } from 'react';
import { ottoQ } from '@/lib/ottoQClient';
import { readValueSummary, type ValueSummary } from '@/lib/valueSummary';

const POLL_MS = 60_000;

export interface ValueSummaryState {
  summary: ValueSummary | null;
  error: string | null;
  loading: boolean;
}

export function useValueSummary(enabled = true, sweepCode: string | null = null): ValueSummaryState {
  const [summary, setSummary] = useState<ValueSummary | null>(null);
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
        const { data, error: rpcError } = await ottoQ.rpc('ottoq_value_summary', { p_sweep_code: sweepCode });
        if (cancelled) return;
        if (rpcError) {
          setError(String(rpcError.message ?? rpcError));
          return;
        }
        setSummary(readValueSummary(data));
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, sweepCode]);

  return { summary, error, loading };
}
