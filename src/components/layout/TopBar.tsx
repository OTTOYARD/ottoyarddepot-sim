import { Play, Pause, RotateCcw, Settings } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { simulationEngine } from '@/engine/SimulationEngine';

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const StatusPill = ({ status }: { status: 'idle' | 'running' | 'paused' }) => {
  const config = {
    idle: 'bg-otto-gray/30 text-otto-gray',
    running: 'bg-otto-teal/20 text-otto-teal animate-pulse',
    paused: 'bg-otto-amber/20 text-otto-amber',
  };
  const labels = { idle: 'Idle', running: 'Running', paused: 'Paused' };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${config[status]}`}>
      {labels[status]}
    </span>
  );
};

export const TopBar = () => {
  const { status, simTime, simSpeed } = useSimulationStore();
  const vehiclesProcessed = useVehicleStore((s) => s.vehiclesProcessed);
  const queueDepth = useVehicleStore((s) => s.queueDepth);
  const vehicleCount = useVehicleStore((s) => s.vehicles.length);

  const togglePlayPause = () => {
    if (status === 'running') simulationEngine.stop();
    else simulationEngine.start();
  };

  const reset = () => {
    simulationEngine.reset();
  };

  return (
    <div className="h-14 bg-otto-dark border-b-2 border-otto-red flex items-center px-4 shrink-0 z-20">
      <div className="flex items-center gap-3">
        <span className="text-otto-red font-bold text-xl tracking-tight">OTTOYARD</span>
        <StatusPill status={status} />
      </div>

      <div className="flex-1 flex items-center justify-center gap-4">
        <span className="font-mono text-white text-lg tracking-widest">{formatTime(simTime)}</span>
        <span className="text-otto-teal text-sm font-medium">{simSpeed}x</span>
        <span className="text-otto-gray text-xs">
          🚗 {vehicleCount} | ⏳ {queueDepth} | ✅ {vehiclesProcessed}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button onClick={togglePlayPause} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors">
          {status === 'running' ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={reset} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors">
          <RotateCcw size={18} />
        </button>
        <button className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
};
