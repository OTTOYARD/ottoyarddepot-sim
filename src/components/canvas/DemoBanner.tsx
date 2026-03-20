import { useDemoStore } from '@/store/demoStore';
import { X } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';

export const DemoBanner = () => {
  const { isDemoMode, exitDemo } = useDemoStore();
  const setControlsLocked = useSimulationStore((s) => s.setControlsLocked);

  if (!isDemoMode) return null;

  const handleExit = () => {
    exitDemo();
    setControlsLocked(false);
  };

  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-1.5 bg-otto-dark/80 border-b border-otto-red/30 backdrop-blur-sm">
      <span className="text-xs text-white/90 tracking-widest font-medium">
        DEMO MODE — OTTOYARD Depot Simulation
      </span>
      <button
        onClick={handleExit}
        className="flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors"
      >
        <X size={12} /> Exit Demo
      </button>
    </div>
  );
};
