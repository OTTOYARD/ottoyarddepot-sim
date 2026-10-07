// ============================================================================
// useStopRun — THE stop sequence for the run transport, shared by the phone's run
// bar and the desktop top bar (src/components/cockpit/RunTransport.tsx), so the two
// stop a run the same way. It is the desktop Control tab's own Stop
// (OperatorConsole.stopRun), step for step:
//
//   1. stopAndReset(run) → the control edge (src/lib/blackbox.ts): the run freezes,
//      the depot empties, the run stays downloadable from the Runs tab.
//   2. ctrl.pause() — the renderer stops interpolating with it.
//   3. the Runs tab opens, where its Black Box is.
//   4. a toast, success or failure.
//
// The caller passes ITS OWN useTwinControl() result, as with useStartRun.
// ============================================================================
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { stopAndReset } from "@/lib/blackbox";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";

/** The one transport call the stop sequence makes (a useTwinControl() result fits). */
export interface StopRunControl {
  pause: () => void;
}

export function useStopRun(ctrl: StopRunControl) {
  const [stopping, setStopping] = useState(false);
  const { pause } = ctrl;

  /** Stop the active run. Resolves true when it stopped, false when there was none or it failed (a toast says why). */
  const stop = useCallback(async (): Promise<boolean> => {
    const runId = useTwinStore.getState().activeSimRunId;
    if (!runId) return false;
    setStopping(true);
    try {
      await stopAndReset(runId);
      pause();
      useSimulationStore.getState().setActiveTab("history");
      toast.success("Run stopped. The depot is empty.", { description: "Its Black Box is on the Runs tab." });
      return true;
    } catch (e: unknown) {
      toast.error("Stop failed", { description: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setStopping(false);
    }
  }, [pause]);

  return { stop, stopping };
}
