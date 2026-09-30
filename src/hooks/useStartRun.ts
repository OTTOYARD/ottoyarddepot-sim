// ============================================================================
// useStartRun — THE start sequence, shared by the desktop Control tab and the
// phone's Start sheet, so there is ONE authoritative way to start a run.
//
//   1. startDemoRun(code, 1)  → control edge (src/lib/blackbox.ts). It purges
//      the previous run and adopts the new sim_run_id into the twin store.
//   2. ctrl.syncFromRun("running") — the backend starts the run already running,
//      so this ADOPTS that state instead of posting a resume the backend refuses
//      with 409 "run is not paused" (seen on every start, run 49c45bd4).
//   3. ctrl.setSpeed(3) — fresh runs open at 3×: watchable without touching a
//      control. Opening at 1× read as a frozen depot (run 7d8da1ca advanced 3.6
//      sim-minutes in 3.7 real minutes). The slider goes to 8×, the backend's own
//      playback ceiling.
//   4. a toast, success or failure.
//
// The caller passes ITS OWN useTwinControl() result, so the transport it shows
// (Pause/Resume, speed) takes the local hold from this start rather than a
// second, unseen copy of the control state.
// ============================================================================
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { startDemoRun } from "@/lib/blackbox";

/** The two transport calls the start sequence makes (a useTwinControl() result fits). */
export interface StartRunControl {
  syncFromRun: (status: string, speedX?: number) => void;
  setSpeed: (v: number) => void;
}

/** The playback speed a fresh run opens at. */
export const START_SPEED_X = 3;

export function useStartRun(ctrl: StartRunControl) {
  const [starting, setStarting] = useState(false);
  const { syncFromRun, setSpeed } = ctrl;

  /** Start `code`. Resolves true when the run started, false when it failed (a toast says why). */
  const start = useCallback(async (code: string, title: string = code): Promise<boolean> => {
    setStarting(true);
    try {
      await startDemoRun(code, 1);
      syncFromRun("running");
      setSpeed(START_SPEED_X);
      toast.success(`Started ${title}`);
      return true;
    } catch (e: unknown) {
      toast.error("Start failed", { description: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setStarting(false);
    }
  }, [syncFromRun, setSpeed]);

  return { start, starting };
}
