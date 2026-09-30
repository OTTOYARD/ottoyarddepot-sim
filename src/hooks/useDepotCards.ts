// useDepotCards — every car in the twin depot, from ottoq_depot_cards (contract 1.4), for the OTTO-Q funnel.
//
// The cards answer for the depot's LIVE run. A body naming another run (or none) is not this run's picture, and the
// funnel then says so rather than drawing another run's cars. Pause follows the sim.
import { useEffect, useState } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import { TWIN_DEPOT_ID } from "@/hooks/useDecisionTrail";
import type { FunnelCardVehicle } from "@/lib/ottoqFunnel";

const POLL_MS = 10_000;

export interface DepotCardsState {
  vehicles: FunnelCardVehicle[] | null;
  /** 'ok' once the cards answered for this run; 'other_run' when they describe a different run or none. */
  status: "waiting" | "ok" | "other_run";
  simClock: string | null;
  error: string | null;
}

export function useDepotCards(enabled = true): DepotCardsState {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const [state, setState] = useState<DepotCardsState>({ vehicles: null, status: "waiting", simClock: null, error: null });

  useEffect(() => {
    setState({ vehicles: null, status: "waiting", simClock: null, error: null });
  }, [simRunId]);

  useEffect(() => {
    if (!enabled || !simRunId || paused) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data, error } = await ottoQ.rpc("ottoq_depot_cards", { p_depot_id: TWIN_DEPOT_ID, p_fleet_operator_id: null });
        if (cancelled) return;
        if (error) { setState((s) => ({ ...s, error: String(error.message ?? error) })); return; }
        const body = (data ?? {}) as { sim_run_id?: string | null; sim_clock?: string | null; vehicles?: FunnelCardVehicle[] };
        if (body.sim_run_id !== simRunId) {
          setState({ vehicles: null, status: "other_run", simClock: null, error: null });
          return;
        }
        setState({ vehicles: Array.isArray(body.vehicles) ? body.vehicles : [], status: "ok", simClock: body.sim_clock ?? null, error: null });
      } catch (e: unknown) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled, simRunId, paused]);

  return state;
}
