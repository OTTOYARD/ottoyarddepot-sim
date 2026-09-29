import { useEffect } from 'react';
import { runFromSearch } from '@/lib/cockpitLinks';
import { useTwinStore } from '@/store/twinStore';

/**
 * A cockpit's "Back to the twin" link opens `/?run=<sim_run_id>`. Adopt that run once
 * on load. Discovery (useTwinFeed) still moves on to the live run if this one has ended,
 * exactly as it does for any run that is no longer live.
 */
export function useRunFromUrl() {
  useEffect(() => {
    const run = runFromSearch(window.location.search);
    if (run) useTwinStore.getState().setActiveSimRunId(run);
  }, []);
}
