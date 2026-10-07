// useDispositions — the proposers' offers for the active run and what the decide path did with each.
//
// Read from public.ottoq_proposal_disposition_ledger (otto-q-core 0364, class='evidence'), never from
// ottoq_external_proposals: the working table is run-scoped and loses rows, the ledger keeps them (otto-q-core
// CLAUDE.md Part 3). Indexed on sim_run_id, so a run-filtered read is light. After the first page each poll asks only
// for rows past the newest disposition_id it holds.
//
// Pause follows the sim, as every other stream here: a paused cockpit issues no reads and keeps what it has.
import { useEffect, useRef, useState } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import type { DispositionRow } from "@/lib/ottoqFunnel";

const POLL_MS = 8000;
const PAGE = 500;
/** Newest-first cap on what is kept in memory. */
const KEEP = 2000;

export interface DispositionState {
  rows: DispositionRow[] | null;
  error: string | null;
}

export function useDispositions(enabled = true): DispositionState {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const [rows, setRows] = useState<DispositionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);

  useEffect(() => {
    setRows(null);
    setError(null);
    last.current = 0;
  }, [simRunId]);

  useEffect(() => {
    if (!enabled || !simRunId || paused) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data, error: e } = await ottoQ
          .from("ottoq_proposal_disposition_ledger")
          .select("disposition_id,entity_id,source,status,disposition_reason,abstained,stall_id,disposed_at,disposed_tick,promotion_count")
          .eq("sim_run_id", simRunId)
          .gt("disposition_id", last.current)
          .order("disposition_id", { ascending: false })
          .limit(PAGE);
        if (cancelled) return;
        if (e) { setError(String(e.message ?? e)); return; }
        const fresh = ((data ?? []) as DispositionRow[]).map((d) => ({ ...d, disposition_id: Number(d.disposition_id) }));
        if (fresh.length) last.current = Math.max(last.current, ...fresh.map((d) => d.disposition_id));
        setRows((prev) => {
          if (!fresh.length) return prev ?? [];
          const seen = new Set((prev ?? []).map((d) => d.disposition_id));
          return [...fresh.filter((d) => !seen.has(d.disposition_id)), ...(prev ?? [])].slice(0, KEEP);
        });
        setError(null);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled, simRunId, paused]);

  return { rows, error };
}
