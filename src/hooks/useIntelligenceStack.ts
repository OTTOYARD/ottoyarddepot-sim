// ============================================================================
// useIntelligenceStack — polls otto-q-core's ottoq_intelligence_stack for the
// active sim run.
//
// TWO CALLS, ON PURPOSE. Migration 0351's assertion A4 bounds the cheap path
// (p_include_frame => false) at 3,000 ms and the full path at 6,000 ms, because
// the frame runs ottoq_agent_asset_depth over every asset in the depot. So the
// panel polls the cheap shape on the beat and fetches the frame only when the
// operator opens it. Putting the frame on a 5-second poll would double the
// panel's cost for a section nobody is looking at.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { ottoQ } from '@/lib/ottoQClient';
import { useTwinStore } from '@/store/twinStore';
import type { IntelligenceStack } from '@/lib/intelligenceStack';

const POLL_MS = 5000;

export interface IntelligenceStackState {
  stack: IntelligenceStack | null;
  frame: Record<string, unknown> | null;
  error: string | null;
  loading: boolean;
  frameLoading: boolean;
  /** Fetch the expensive per-asset frame once, on demand. */
  loadFrame: () => void;
  simRunId: string | null;
}

export function useIntelligenceStack(enabled = true): IntelligenceStackState {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const [stack, setStack] = useState<IntelligenceStack | null>(null);
  const [frame, setFrame] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameLoading, setFrameLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !simRunId) {
      setStack(null);
      setFrame(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const poll = async () => {
      try {
        const { data, error: rpcError } = await ottoQ.rpc('ottoq_intelligence_stack', {
          p_sim_run_id: simRunId,
          p_include_frame: false,
        });
        if (cancelled) return;
        if (rpcError) {
          setError(String(rpcError.message ?? rpcError));
          return;
        }
        setStack((data as IntelligenceStack) ?? null);
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void poll();
    timerRef.current = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // The frame is intentionally NOT a dependency — it is fetched on demand.
  }, [simRunId, enabled]);

  // A new run invalidates a frame fetched from the previous one.
  useEffect(() => {
    setFrame(null);
  }, [simRunId]);

  const loadFrame = useCallback(() => {
    if (!simRunId) return;
    setFrameLoading(true);
    void (async () => {
      try {
        const { data, error: rpcError } = await ottoQ.rpc('ottoq_intelligence_stack', {
          p_sim_run_id: simRunId,
          p_include_frame: true,
        });
        if (rpcError) {
          setError(String(rpcError.message ?? rpcError));
          return;
        }
        const next = (data as IntelligenceStack) ?? null;
        setFrame((next?.frame as Record<string, unknown> | null) ?? null);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setFrameLoading(false);
      }
    })();
  }, [simRunId]);

  return { stack, frame, error, loading, frameLoading, loadFrame, simRunId };
}
