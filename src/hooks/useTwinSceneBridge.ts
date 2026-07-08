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
import { useEffect, useState } from "react";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";
import { twin } from "@/lib/ottoTwin";

export function useTwinSceneBridge() {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const legacyStatus = useSimulationStore((s) => s.status);
  // Reconciling is GATED on the layout attempt finishing: if the first snapshot
  // landed before the exact-stall map, the whole fleet would be placed on
  // zone-based stalls and then MASS-REASSIGNED when the layout arrived — a
  // fleet-wide reshuffle (every parked car backing out at once). Never again.
  const [layoutSettled, setLayoutSettled] = useState(false);

  // Start/stop the motion loop with the mode. Clear render state when we leave
  // twin mode or the offline engine takes over (it owns the stores then).
  useEffect(() => {
    if (!activeSimRunId || legacyStatus === "running") {
      twinMotionDriver.clear();
      setLayoutSettled(false);
      return;
    }
    twinMotionDriver.start();
    let cancelled = false;
    // Exact-stall fidelity: load the twin's depot layout BEFORE the first
    // reconcile so cars are placed on OTTO-Q's exact stalls from frame one.
    twin.layout()
      .then((l) => {
        if (!cancelled && l?.stalls?.length) twinMotionDriver.setTwinStallMap(l.stalls);
      })
      .catch(() => { /* layout unavailable → zone-based fallback still works */ })
      .finally(() => {
        if (!cancelled) setLayoutSettled(true);
      });
    return () => {
      cancelled = true;
      twinMotionDriver.stop();
    };
  }, [activeSimRunId, legacyStatus]);

  // Reconcile routes against each fresh snapshot (only once the layout settled).
  useEffect(() => {
    if (!activeSimRunId || !snapshot || !layoutSettled) return;
    if (legacyStatus === "running") return;
    twinMotionDriver.reconcile(snapshot);
  }, [snapshot, activeSimRunId, legacyStatus, layoutSettled]);
}
