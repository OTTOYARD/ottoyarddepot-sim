import { useEffect } from 'react';
import { useSimulationStore } from '@/store/simulationStore';
import { useDemoStore } from '@/store/demoStore';
import { useTwinStore } from '@/store/twinStore';
import { twin } from '@/lib/ottoTwin';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const sim = useSimulationStore.getState();

      // TRUTH-2 (founder rule 2026-07-25): everything that moves on screen must be
      // OTTO-Q actually firing. The legacy offline engine is a MOCK — 12 hand-seeded
      // vehicles on locally regenerated stalls, no brain in the loop. Every keyboard
      // path that could start it has been severed:
      //   · 'D' entered the mock UNGUARDED — it would wipe a live twin fleet mid-demo.
      //   · Space started the mock whenever the twin run had not attached yet.
      // Space now only ever drives the TWIN hold; nothing here can start the mock.
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
          }
          // no twin run yet => do nothing. Starting the mock here is what made
          // "the play button" show vehicles that no OTTO-Q decision produced.
          break;
        case 'd':
        case 'D': {
          // Exit-only. There is no longer any way IN to the offline mock.
          const demo = useDemoStore.getState();
          if (demo.isDemoMode) {
            demo.exitDemo();
            sim.setControlsLocked(false);
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
