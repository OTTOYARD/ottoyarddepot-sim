import { useEffect } from 'react';
import { useSimulationStore, type CockpitTab } from '@/store/simulationStore';
import { useTwinStore } from '@/store/twinStore';
import { twin } from '@/lib/ottoTwin';

/** Number keys follow the tab bar, left to right. */
const TAB_KEYS: Record<string, CockpitTab> = {
  '1': 'controls',
  '2': 'intelligence',
  '3': 'orchestration',
  '4': 'kpis',
  '5': 'alerts',
  '6': 'history',
  '7': 'world',
  '8': 'copilot',
};

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const sim = useSimulationStore.getState();

      // TRUTH-2 (founder rule 2026-07-25): everything that moves on screen must be OTTO-Q
      // actually firing. Space pauses and resumes the TWIN — the server run and the renderer
      // together — and nothing here can start anything else. ('D' used to exit an offline demo
      // mode that nothing can enter any more, and +/- moved a legacy speed nothing reads; both
      // are gone. Playback speed lives on the Control tab.)
      const tw = useTwinStore.getState();
      const twinLive = !!tw.activeSimRunId && !tw.offlineDemo;

      if (e.key === ' ') {
        e.preventDefault();
        if (twinLive) {
          const next = !tw.paused;
          tw.setPaused(next);
          if (next) twin.pause(tw.activeSimRunId!).catch(() => {});
          else twin.resume(tw.activeSimRunId!).catch(() => {});
        }
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        sim.togglePanel();
        return;
      }
      const tab = TAB_KEYS[e.key];
      if (tab) sim.setActiveTab(tab);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
