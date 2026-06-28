// ============================================================================
// DepotEmptyState — shown over the canvas when the depot is idle (no twin run
// active and the offline-demo engine not running). The simulator is
// operator-triggered, so without this an idle depot just looks empty/broken.
// This makes the next action obvious: pick a scenario from Quick Launch.
// ============================================================================
import { MousePointerClick } from "lucide-react";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";
import { useVehicleStore } from "@/store/vehicleStore";

export const DepotEmptyState = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const legacyStatus = useSimulationStore((s) => s.status);
  const vehicleCount = useVehicleStore((s) => s.vehicles.length);

  // Hide as soon as anything is live: a twin run is selected, the offline
  // demo is running, or vehicles are on the map.
  if (activeSimRunId || legacyStatus === "running" || vehicleCount > 0) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto max-w-sm text-center rounded-xl border border-white/10 bg-canvas-elev/85 backdrop-blur px-6 py-5 shadow-xl">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-red/15">
          <MousePointerClick className="text-brand-red" size={20} />
        </div>
        <h3 className="font-display text-sm uppercase tracking-[0.08em] text-ink">Depot idle</h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">
          Pick a scenario under{" "}
          <span className="text-ink font-medium">Run Control → Quick Launch</span>{" "}
          on the right to bring the depot to life — vehicles arrive, charge, wash,
          stage, and dispatch in real time as OTTO-Q orchestrates them.
        </p>
      </div>
    </div>
  );
};
