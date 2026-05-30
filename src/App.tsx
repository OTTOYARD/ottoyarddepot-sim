import { useCallback, useEffect, useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { SidePanel } from '@/components/layout/SidePanel';
import { DepotCanvas } from '@/components/canvas/DepotCanvas';
import { ResponsiveGuard } from '@/components/layout/ResponsiveGuard';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useSimulationStore } from '@/store/simulationStore';
import { useDemoStore } from '@/store/demoStore';
import { useDepotStore } from '@/store/depotStore';
import { simulationEngine } from '@/engine/SimulationEngine';
import { useTwinFeed } from '@/hooks/useTwinFeed';
import { useTwinStore } from '@/store/twinStore';
import { Link2 } from 'lucide-react';

// Phase 1: paste a sim_run_id to attach the live backend feed. (Phase 2 replaces
// this with a scenario picker that starts runs via the control API.)
const RunConnector = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const setActiveSimRunId = useTwinStore((s) => s.setActiveSimRunId);
  const connected = useTwinStore((s) => s.connected);
  const [val, setVal] = useState(activeSimRunId ?? '');

  return (
    <div className="fixed bottom-3 left-3 z-30 flex items-center gap-2 bg-canvas-panel border border-white/[0.06] rounded-md px-2.5 py-1.5">
      <Link2 size={13} className={connected ? 'text-state-go' : 'text-ink-faint'} />
      <input
        value={val}
        onChange={(e) => setVal(e.target.value.trim())}
        placeholder="paste sim_run_id…"
        className="bg-transparent font-mono text-[11px] text-ink placeholder:text-ink-faint outline-none w-[260px]"
      />
      <button
        onClick={() => setActiveSimRunId(val || null)}
        className="font-mono text-[10px] uppercase px-2 py-1 rounded bg-brand-red text-white hover:bg-brand-deep transition-colors"
      >
        {connected ? 'Reconnect' : 'Connect'}
      </button>
    </div>
  );
};

const App = () => {
  const enterDemo = useCallback(() => {
    const sim = useSimulationStore.getState();
    const demo = useDemoStore.getState();
    const depot = useDepotStore.getState();

    // Reset first
    simulationEngine.reset();

    // Set demo config
    sim.updateConfig({
      activeFleetSize: 50,
      activeConsumerMembers: 150,
      ottoQAlgorithm: 'Priority-Weighted',
      turnaroundMode: 'Standard',
      dcfcCount: 10,
      l2Count: 40,
      washBayCount: 3,
      stagingStalls: 15,
    });
    depot.regenerateStalls(10, 40, 3, 15);

    // Lock controls, set speed, open KPIs
    sim.setControlsLocked(true);
    sim.setSimSpeed(30);
    sim.setActiveTab('kpis');

    // Show loading overlay
    demo.setLoading(true);
    demo.enterDemo();

    setTimeout(() => {
      demo.setLoading(false);
      simulationEngine.start();
    }, 1500);
  }, []);

  // Listen for demo trigger from TopBar button
  useEffect(() => {
    const handler = () => enterDemo();
    window.addEventListener('ottoyard-demo', handler);
    return () => window.removeEventListener('ottoyard-demo', handler);
  }, [enterDemo]);

  useKeyboardShortcuts(enterDemo);

  // Attach the server-authoritative twin feed (loads layout, polls snapshots).
  useTwinFeed();

  return (
    <ResponsiveGuard>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas-base">
        <TopBar />
        <div className="flex-1 flex min-h-0">
          <DepotCanvas />
          <SidePanel />
        </div>
        <RunConnector />
      </div>
    </ResponsiveGuard>
  );
};

export default App;
