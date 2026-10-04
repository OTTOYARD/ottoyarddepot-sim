// useOwnerBoard — polls what owners' agents have set at the twin depot, otto-q-core 0608's
// public.ottoq_depot_owner_board, into ownerBoardStore. Mounted ONCE, in App, for the whole cockpit (desktop and phone):
// the cars in 2D and 3D, their Q cards, the Agent tab and the bottom bar all read the one store.
//
// The twin's own rules, as useActivityFeed keeps them:
//   - PAUSE FOLLOWS THE SIM: a paused cockpit asks nothing and keeps what it has.
//   - A different run (or none) starts clean; one run's commands are never shown on another's.
//   - Same cadence as the decision stream these lines join (4 s).
// Before 0607/0608 are applied the function does not exist (404 / PGRST202), or the anon key may not call it (401 /
// 42501): the store says which, and the board is asked again only once a minute, so the apply shows without a reload.
// Read-only: one RPC that reads.
import { useEffect } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import { useOwnerBoardStore } from "@/store/ownerBoardStore";
import { TWIN_DEPOT_ID } from "@/hooks/useDecisionTrail";
import { classifyBoardError, type OwnerBoardReply } from "@/lib/ownerBoard";

export const OWNER_BOARD_POLL_MS = 4000;
export const OWNER_BOARD_RETRY_MS = 60_000;
/** The board's own default: the depot's last 30 commands. */
const COMMANDS_PER_READ = 30;

export function useOwnerBoard(): void {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);

  useEffect(() => {
    useOwnerBoardStore.getState().reset(simRunId);
  }, [simRunId]);

  useEffect(() => {
    if (!simRunId || paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = "";
    const poll = async () => {
      let next = OWNER_BOARD_POLL_MS;
      try {
        const { data, error, status } = await ottoQ.rpc("ottoq_depot_owner_board", { p_depot_id: TWIN_DEPOT_ID, p_limit: COMMANDS_PER_READ });
        if (cancelled) return;
        if (error) {
          last = ""; // the next answer is news even if it matches the one before the failure
          const problem = classifyBoardError(error, status);
          useOwnerBoardStore.getState().fail(simRunId, problem, String(error.message ?? error));
          if (problem !== "error") next = OWNER_BOARD_RETRY_MS;
        } else {
          // the same answer as last time changes nothing on screen: do not hand the views a new object
          const text = JSON.stringify(data ?? null);
          if (text !== last) {
            last = text;
            useOwnerBoardStore.getState().receive(simRunId, (data ?? null) as OwnerBoardReply | null);
          }
        }
      } catch (e: unknown) {
        if (cancelled) return;
        last = "";
        useOwnerBoardStore.getState().fail(simRunId, "error", e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) timer = setTimeout(poll, next);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [simRunId, paused]);
}
