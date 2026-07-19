import { useEffect } from 'react';
import { simulationEngine } from '@/engine/SimulationEngine';
import { useSimulationStore } from '@/store/simulationStore';
import { useDemoStore } from '@/store/demoStore';
import { useTwinStore } from '@/store/twinStore';
import { twin } from '@/lib/ottoTwin';

export function useKeyboardShortcuts(enterDemoFn: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const sim = useSimulationStore.getState();

      // When a live twin run owns the board, the legacy offline engine must stay
      // out of it: starting it wipes the twin fleet and animates vehicles that
      // the twin's Pause has no authority over. Space is the natural "pause"
      // key, so in twin mode it drives the TWIN hold (world + renderer) instead.
      const tw = useTwinStore.getState();
      const twinLive = !!tw.activeSimRunId && !tw.offlineDemo;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (twinLive) {
            const next = !tw.paused;
            tw.setPaused(next);
            if (next) twin.pause(tw.activeSimRunId!).catch(() => {});
            else twin.resume(tw.activeSimRunId!).catch(() => {});
          } else if (sim.status === 'running') simulationEngine.stop();
          else simulationEngine.start();
          break;
        case 'r':
        case 'R':
          if (!twinLive) simulationEngine.reset();  // never reset the board out from under a live run
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
