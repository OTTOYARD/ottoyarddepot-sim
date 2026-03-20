import { useCallback, useEffect } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { SidePanel } from '@/components/layout/SidePanel';
import { DepotCanvas } from '@/components/canvas/DepotCanvas';
import { ResponsiveGuard } from '@/components/layout/ResponsiveGuard';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useSimulationStore } from '@/store/simulationStore';
import { useDemoStore } from '@/store/demoStore';
import { useDepotStore } from '@/store/depotStore';
import { simulationEngine } from '@/engine/SimulationEngine';

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

  return (
    <ResponsiveGuard>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-otto-dark">
        <TopBar />
        <div className="flex-1 flex min-h-0">
          <DepotCanvas />
          <SidePanel />
        </div>
      </div>
    </ResponsiveGuard>
  );
};

export default App;
