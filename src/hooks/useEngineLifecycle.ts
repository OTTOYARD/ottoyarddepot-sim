import { useEffect, useRef } from 'react';
import { simulationEngine } from '@/engine/SimulationEngine';
import { useSimulationStore } from '@/store/simulationStore';

/**
 * Manages the simulation engine lifecycle.
 * Starts/stops engine when simulation status changes.
 */
export function useEngineLifecycle() {
  const status = useSimulationStore((s) => s.status);
  const prevStatus = useRef(status);

  useEffect(() => {
    if (status === 'running' && prevStatus.current !== 'running') {
      simulationEngine.start();
    } else if (status === 'paused' && prevStatus.current === 'running') {
      simulationEngine.stop();
    } else if (status === 'idle' && prevStatus.current !== 'idle') {
      simulationEngine.reset();
    }
    prevStatus.current = status;
  }, [status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      simulationEngine.stop();
    };
  }, []);
}
