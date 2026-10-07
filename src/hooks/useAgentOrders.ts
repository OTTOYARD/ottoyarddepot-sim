// useAgentOrders — what the agent's charge-line orders did on the active run (public.ottoq_agent_charge_order_usage,
// otto-q-core 0614 and 0616).
//
// The stack draws one orb per agent pass and the stream one line per pass; both look a pass's order up by the chain id
// the pass's feed row carries. ottoq_run_learning carries the same usage, but only for its last 20 orders, and the
// stack shows 30 passes, so this reads up to 200. On a run that takes no order the answer is all zeros and nothing
// changes colour. A 10 s poll against a 30 s tick, paused with the sim like every other stream here; an ended run is
// read once.
import { useEffect, useMemo, useState } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import { orderIndex, type OrderIndex } from "@/lib/agentStream";
import type { AgentOrderUsage } from "@/lib/runLearning";

const POLL_MS = 10_000;
export const ORDER_LIMIT = 200;

export interface AgentOrdersState {
  usage: AgentOrderUsage | null;
  /** chain id -> the order that pass sent. */
  byChain: OrderIndex;
}

export function useAgentOrders(enabled = true): AgentOrdersState {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const runStatus = useTwinStore((s) => s.snapshot?.run?.status ?? null);
  const [usage, setUsage] = useState<AgentOrderUsage | null>(null);

  useEffect(() => { setUsage(null); }, [simRunId]);

  useEffect(() => {
    if (!enabled || !simRunId || paused) return;
    let cancelled = false;
    const live = runStatus == null || runStatus === "running";
    const poll = async () => {
      try {
        const { data, error } = await ottoQ.rpc("ottoq_agent_charge_order_usage", { p_sim_run_id: simRunId, p_limit: ORDER_LIMIT });
        if (cancelled || error) return;
        if (data && typeof data === "object" && !Array.isArray(data)) setUsage(data as AgentOrderUsage);
      } catch {
        // a failed read keeps the last answer; the orbs keep their colours rather than all turning white
      }
    };
    void poll();
    if (!live) return () => { cancelled = true; };
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled, simRunId, paused, runStatus]);

  const byChain = useMemo(() => orderIndex(usage), [usage]);
  return { usage, byChain };
}
