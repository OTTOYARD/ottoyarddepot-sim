import { useEffect } from 'react';
import { runFromSearch, tabFromSearch } from '@/lib/cockpitLinks';
import { useSimulationStore } from '@/store/simulationStore';
import { useTwinStore } from '@/store/twinStore';

/**
 * A cockpit's "Back to the twin" link opens `/?run=<sim_run_id>`. Adopt that run once
 * on load. Discovery (useTwinFeed) still moves on to the live run if this one has ended,
 * exactly as it does for any run that is no longer live.
 *
 * A cockpit's "Engineering model" link opens `/?tab=robotics&robot=<key>`: open that tab once on
 * load (the Robotics tab reads the robot itself).
 */
export function useRunFromUrl() {
  useEffect(() => {
    const run = runFromSearch(window.location.search);
    if (run) useTwinStore.getState().setActiveSimRunId(run);
    const tab = tabFromSearch(window.location.search);
    if (tab) useSimulationStore.getState().setActiveTab(tab);
  }, []);
}
