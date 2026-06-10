import { useCallback, useEffect } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { SidePanel } from '@/components/layout/SidePanel';
import { DepotCanvas } from '@/components/canvas/DepotCanvas';
import { ResponsiveGuard } from '@/components/layout/ResponsiveGuard';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useSimulationStore } from '@/store/simulationStore';
import { useDemoStore } from '@/store/demoStore';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { simulationEngine } from '@/engine/SimulationEngine';
import { createQueueVehicle } from '@/engine/IncidentInjector';
import { INGRESS } from '@/engine/types';
import { useTwinFeed } from '@/hooks/useTwinFeed';
import { useTwinSceneBridge } from '@/hooks/useTwinSceneBridge';

const App = () => {
  const enterDemo = useCallback(() => {
    const sim = useSimulationStore.getState();
    const demo = useDemoStore.getState();
    const depot = useDepotStore.getState();

    // Reset first
    simulationEngine.reset();

    // Set demo config (site-plan counts; continuous arrivals so the depot is alive immediately)
    sim.updateConfig({
      activeFleetSize: 50,
      activeConsumerMembers: 150,
      ottoQAlgorithm: 'Priority-Weighted',
      turnaroundMode: 'Standard',
      fleetArrivalPattern: 'Continuous',
      consumerArrivalDist: 'Uniform',
      dcfcCount: 10,
      l2Count: 30,
      washBayCount: 3,
      stagingStalls: 97,
    });
    depot.regenerateStalls(10, 30, 3, 97);

    // Seed an opening wave: half already holding on the queue row, half
    // driving in through the ingress gate (full one-way choreography).
    const simTime = sim.simTime;
    const seed = Array.from({ length: 12 }, (_, i) => {
      const v = createQueueVehicle(simTime, i);
      if (i >= 6) {
        v.status = 'approaching';
        v.position = { x: INGRESS.x, y: INGRESS.y + (i - 6) * 4 };
      }
      return v;
    });
    useVehicleStore.getState().setVehicles(seed);

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
  // CC-P2b: drive the depot scene (stalls + vehicles) from the live snapshot.
  useTwinSceneBridge();

  return (
    <ResponsiveGuard>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas-base">
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
