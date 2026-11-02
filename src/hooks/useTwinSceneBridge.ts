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
//
// THE IDLE TWIN draws the depot the twin has, too. With no run there is no fleet to
// place, but the depot is on screen (the cockpit, the phone cockpit, and the live view
// the other cockpits frame), so the bridge reads the twin depot's layout and draws its
// charger build (TwinMotionDriver.adoptChargerBuild). The build used to be read only
// with a run: from 0763 (10:11 PM CT, 2026-10-22) the idle twin drew canopies B and C as standard
// chargers, with no charge arm and no cleaning arm, until someone started a run.
// ============================================================================
import { useEffect } from "react";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";
import { twin } from "@/lib/ottoTwin";

/** With no run, a layout read that failed (offline, a slow edge function) is asked again this often. */
export const IDLE_LAYOUT_RETRY_MS = 15000;

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
      // the offline engine owns the stores while it runs
      if (legacyStatus === "running") return;
      // No run: draw the chargers the twin's layout has (see the header). Only the build
      // is taken; no stall is mapped, because no car will be drawn. A read that fails
      // leaves the build as drawn and is asked again until it lands or a run starts.
      let cancelled = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const read = () => {
        twin.layout()
          .then((l) => {
            if (cancelled) return;
            if (l?.stalls?.length) twinMotionDriver.adoptChargerBuild(l.stalls);
            else retry = setTimeout(read, IDLE_LAYOUT_RETRY_MS);
          })
          .catch(() => {
            if (!cancelled) retry = setTimeout(read, IDLE_LAYOUT_RETRY_MS);
          });
      };
      read();
      return () => {
        cancelled = true;
        clearTimeout(retry);
      };
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
