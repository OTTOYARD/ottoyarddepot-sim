import { TopBar } from '@/components/layout/TopBar';
import { SidePanel } from '@/components/layout/SidePanel';
import { DepotCanvas } from '@/components/canvas/DepotCanvas';
import { ResponsiveGuard } from '@/components/layout/ResponsiveGuard';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useTwinFeed } from '@/hooks/useTwinFeed';
import { useWorldBoot } from '@/hooks/useWorldBoot';
import { useTwinSceneBridge } from '@/hooks/useTwinSceneBridge';
import { RunBootSplash } from '@/components/canvas/RunBootSplash';
import { JumpPlanningOverlay } from '@/components/canvas/JumpPlanningOverlay';

const App = () => {
  // TRUTH-2 (founder rule 2026-07-25): everything that plays on screen must be
  // OTTO-Q actually firing. The offline mock (12 hand-seeded vehicles on locally
  // regenerated stalls, no brain in the loop) and every trigger into it — the
  // `ottoyard-demo` window event, the 'D' shortcut, the engine lifecycle hook —
  // have been DELETED. The twin feed below is now the only thing that can move a car.

  useKeyboardShortcuts();

  // Attach the server-authoritative twin feed (loads layout, polls snapshots).
  useTwinFeed();
  // Load the complete world for each adopted run and grade its channels before
  // OTTO-Q is asked to orchestrate in it (worldStore.phase).
  useWorldBoot();
  // NO BROWSER-SIDE ORCHESTRATOR (2026-09-23). A second "OTTO-Q" used to run here every tick —
  // client-side advisors, arbiter, shield and battery model — and its assign_stall commands
  // outranked the engine's own stall choice in the motion driver, so a car could be drawn
  // driving to a stall the engine never picked. The engine decides; the renderer draws.
  // CC-P2b: drive the depot scene (stalls + vehicles) from the live snapshot.
  useTwinSceneBridge();

  return (
    <ResponsiveGuard>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas-base">
        <TopBar />
        <div className="relative flex-1 flex min-h-0">
          <DepotCanvas />
          <SidePanel />
          {/* CARD-2: the Monte Carlo boot-draw loading screen (auto-dismisses) */}
          <RunBootSplash />
          {/* fast-forward: the planning moment while OTTO-Q batch-processes the skip */}
          <JumpPlanningOverlay />
        </div>
      </div>
    </ResponsiveGuard>
  );
};

export default App;
