// ============================================================================
// useTwinSceneBridge — makes the depot scene LIVE and MOVING from the backend.
//
// Hands every twin snapshot to the TwinMotionDriver, which holds a stable
// per-vehicle stall assignment and routes each vehicle along the real depot
// lanes (sitePlan) as its backend state changes — gate → charge → wash →
// stage → egress — while a rAF loop interpolates the smooth motion. The twin
// (OTTO-Q) owns the discrete truth; the driver owns only the interpolation.
//
// Only runs in backend-twin mode (an active sim_run + the legacy client engine
// NOT running) so it never fights the offline-demo engine for the stores.
// ============================================================================
import { useEffect } from "react";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";

export function useTwinSceneBridge() {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const legacyStatus = useSimulationStore((s) => s.status);

  // Start/stop the motion loop with the mode. Clear render state when we leave
  // twin mode or the offline engine takes over (it owns the stores then).
  useEffect(() => {
    if (!activeSimRunId || legacyStatus === "running") {
      twinMotionDriver.clear();
      return;
    }
    twinMotionDriver.start();
    return () => twinMotionDriver.stop();
  }, [activeSimRunId, legacyStatus]);

  // Reconcile routes against each fresh snapshot.
  useEffect(() => {
    if (!activeSimRunId || !snapshot) return;
    if (legacyStatus === "running") return;
    twinMotionDriver.reconcile(snapshot);
  }, [snapshot, activeSimRunId, legacyStatus]);
}
