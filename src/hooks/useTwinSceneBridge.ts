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
//
// Snapshot ordering: the driver BUFFERS snapshots until the exact-stall layout
// fetch settles (expectLayout → setTwinStallMap/layoutFailed), so the fleet is
// placed on OTTO-Q's exact stalls from frame one — never a zone-based placement
// followed by a fleet-wide reshuffle. The gate lives in the driver (no extra
// React state → the app's hook order never changes).
// ============================================================================
import { useEffect } from "react";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";
import { twin } from "@/lib/ottoTwin";

export function useTwinSceneBridge() {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const legacyStatus = useSimulationStore((s) => s.status);

  // Operator hold. The server metronome skips paused runs, but the driver
  // interpolates on its own rAF clock and would keep animating toward the last
  // snapshot's targets — so Pause has to reach the renderer too, or the depot
  // keeps moving after the world has stopped. Reconcile deliberately stays live
  // (below): freezing motion, not data, means Resume never teleports a car.
  // PLAYBACK: mirror the backend's speed onto the renderer, and FREEZE motion while a
  // fast-forward is being processed. During a jump the backend is batch-running ticks
  // with coarse resolution — animating toward those targets would show cars teleporting,
  // so the depot holds on a planning pause and resumes when the jump lands.
  const jumping = snapshot?.run?.jump?.status === 'planning';
  const speedX = snapshot?.run?.speed_x ?? 1;
  useEffect(() => {
    twinMotionDriver.setViewMult(speedX);
  }, [speedX]);
  useEffect(() => {
    // operator Pause still wins; this only adds the jump hold on top of it
    twinMotionDriver.setPaused(paused || jumping);
  }, [paused, jumping]);

  // Start/stop the motion loop with the mode. Clear render state when we leave
  // twin mode or the offline engine takes over (it owns the stores then).
  useEffect(() => {
    if (!activeSimRunId || legacyStatus === "running") {
      twinMotionDriver.clear();
      return;
    }
    twinMotionDriver.expectLayout(); // buffer snapshots until the layout settles
    twinMotionDriver.start();
    let cancelled = false;
    twin.layout()
      .then((l) => {
        if (cancelled) return;
        if (l?.stalls?.length) twinMotionDriver.setTwinStallMap(l.stalls);
        else twinMotionDriver.layoutFailed();
      })
      .catch(() => {
        if (!cancelled) twinMotionDriver.layoutFailed();
      });
    return () => {
      cancelled = true;
      twinMotionDriver.stop();
    };
  }, [activeSimRunId, legacyStatus]);

  // Reconcile routes against each fresh snapshot.
  useEffect(() => {
    if (!activeSimRunId || !snapshot) return;
    if (legacyStatus === "running") return;
    twinMotionDriver.reconcile(snapshot);
  }, [snapshot, activeSimRunId, legacyStatus]);
}
