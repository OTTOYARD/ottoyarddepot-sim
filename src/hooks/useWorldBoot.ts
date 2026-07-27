// ============================================================================
// useWorldBoot — run the world loader whenever a run is adopted.
//
// Sits alongside useTwinFeed rather than inside it: the feed's job is to keep
// frames flowing, the boot's job is to establish ONCE, per run, whether the
// world that is flowing is complete. Mixing them would re-grade the world on
// every poll and make the readiness gate flap.
//
// Boot runs to completion even when it fails — the report IS the deliverable.
// Nothing here starts, resumes, or ticks the run.
// ============================================================================
import { useEffect } from "react";
import { NASHVILLE_DEPOT } from "@/lib/ottoTwin";
import { bootWorld } from "@/lib/ottoq/worldBoot";
import { useTwinStore } from "@/store/twinStore";
import { useWorldStore } from "@/store/worldStore";

export function useWorldBoot(depotId: string = NASHVILLE_DEPOT) {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);

  useEffect(() => {
    const world = useWorldStore.getState();
    if (!activeSimRunId) {
      world.reset();
      return;
    }

    let cancelled = false;
    world.beginBoot();

    bootWorld({ simRunId: activeSimRunId, depotId })
      .then(({ report, bundle, layout }) => {
        if (cancelled) return;
        // The boot already paid for the layout fetch; hand it to the twin store
        // so useTwinFeed's own layout effect is not the only source and the
        // renderer is never left waiting on a second round trip.
        if (layout && !useTwinStore.getState().layout) useTwinStore.getState().setLayout(layout);
        useWorldStore.getState().completeBoot(report, bundle);
      })
      .catch((e) => {
        if (!cancelled) {
          useWorldStore.getState().failBoot(e instanceof Error ? e.message : String(e));
        }
      });

    return () => { cancelled = true; };
  }, [activeSimRunId, depotId]);
}
