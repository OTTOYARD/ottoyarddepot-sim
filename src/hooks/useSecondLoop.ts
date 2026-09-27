// ============================================================================
// useSecondLoop — polls otto-q-core's two boards for the second loop.
//
// The challenger board is per run and cheap (one indexed read of its ledger), so
// it polls on the stream's beat while a run is active. The learning board calls
// the dial verdict once per experiment, and the experiments move overnight, not
// by the second, so it polls once a minute. Both are read-only RPCs
// (otto-q-core 0536).
// ============================================================================
import { useEffect, useState } from 'react';
import { ottoQ } from '@/lib/ottoQClient';
import { useTwinStore } from '@/store/twinStore';
import type { ChallengerBoard, LearningBoard } from '@/lib/secondLoop';

const CHALLENGER_POLL_MS = 10_000;
const LEARNING_POLL_MS = 60_000;

export interface SecondLoopState {
  challenger: ChallengerBoard | null;
  learning: LearningBoard | null;
  error: string | null;
  loading: boolean;
  simRunId: string | null;
}

export function useSecondLoop(enabled = true): SecondLoopState {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const [challenger, setChallenger] = useState<ChallengerBoard | null>(null);
  const [learning, setLearning] = useState<LearningBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The challenger follows the active run; with none, the board names the most recent operator run itself.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    const poll = async () => {
      try {
        const { data, error: rpcError } = await ottoQ.rpc('ottoq_challenger_board', {
          p_sim_run_id: simRunId ?? null,
        });
        if (cancelled) return;
        if (rpcError) {
          setError(String(rpcError.message ?? rpcError));
          return;
        }
        setChallenger((data as ChallengerBoard) ?? null);
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void poll();
    const t = setInterval(poll, CHALLENGER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [simRunId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data, error: rpcError } = await ottoQ.rpc('ottoq_learning_board');
        if (cancelled) return;
        if (rpcError) {
          setError(String(rpcError.message ?? rpcError));
          return;
        }
        setLearning((data as LearningBoard) ?? null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const t = setInterval(poll, LEARNING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled]);

  return { challenger, learning, error, loading, simRunId };
}
