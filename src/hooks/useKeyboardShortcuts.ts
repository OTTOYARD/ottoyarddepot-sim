import { useEffect } from 'react';
import { simulationEngine } from '@/engine/SimulationEngine';
import { useSimulationStore } from '@/store/simulationStore';
import { useDemoStore } from '@/store/demoStore';

export function useKeyboardShortcuts(enterDemoFn: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const sim = useSimulationStore.getState();

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (sim.status === 'running') simulationEngine.stop();
          else simulationEngine.start();
          break;
        case 'r':
        case 'R':
          simulationEngine.reset();
          break;
        case 'd':
        case 'D': {
          const demo = useDemoStore.getState();
          if (demo.isDemoMode) {
            demo.exitDemo();
            sim.setControlsLocked(false);
          } else {
            enterDemoFn();
          }
          break;
        }
        case 'p':
        case 'P':
          sim.togglePanel();
          break;
        case '1':
          sim.setActiveTab('controls');
          break;
        case '2':
          sim.setActiveTab('kpis');
          break;
        case '3':
          sim.setActiveTab('ai-summary');
          break;
        case '4':
          sim.setActiveTab('alerts');
          break;
        case '5':
          sim.setActiveTab('history');
          break;
        case '+':
        case '=':
          sim.setSimSpeed(Math.min(60, sim.simSpeed + 5));
          break;
        case '-':
          sim.setSimSpeed(Math.max(1, sim.simSpeed - 5));
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enterDemoFn]);
}
