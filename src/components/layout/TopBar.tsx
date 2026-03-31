import { Play, Pause, RotateCcw, Settings, Presentation, Loader2, Check } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDemoStore } from '@/store/demoStore';
import { simulationEngine } from '@/engine/SimulationEngine';
import logo from '@/assets/logo.png';

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

const SaveIndicator = () => {
  const isSaving = useDemoStore((s) => s.isSaving);
  if (!isSaving) return null;
  return (
    <div className="flex items-center gap-1 text-otto-teal">
      <Loader2 size={12} className="animate-spin" />
      <span className="text-[10px]">Saving…</span>
    </div>
  );
};

const ViewModeToggle = () => {
  const viewMode = useSimulationStore((s) => s.viewMode);
  const setViewMode = useSimulationStore((s) => s.setViewMode);

  const btnClass = (mode: '2d' | '3d') =>
    viewMode === mode
      ? 'px-2 py-1 text-xs font-bold bg-otto-red text-white rounded transition-colors'
      : 'px-2 py-1 text-xs font-bold bg-transparent text-otto-gray border border-otto-gray/30 rounded transition-colors hover:text-white';

  return (
    <div className="flex items-center gap-0.5 mx-1">
      <button className={btnClass('2d')} onClick={() => setViewMode('2d')}>2D</button>
      <button className={btnClass('3d')} onClick={() => setViewMode('3d')}>3D</button>
    </div>
  );
};

export const TopBar = () => {
  const { status, simTime, simSpeed } = useSimulationStore();
  const vehiclesProcessed = useVehicleStore((s) => s.vehiclesProcessed);
  const queueDepth = useVehicleStore((s) => s.queueDepth);
  const vehicleCount = useVehicleStore((s) => s.vehicles.length);
  const isDemoMode = useDemoStore((s) => s.isDemoMode);

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
        <div className="flex items-center gap-2">
          <img src={logo} alt="OTTOYARD" className="h-8 w-8 shrink-0" />
          <div className="flex flex-col">
            <span className="text-white font-bold text-xl tracking-[2px] leading-tight">OTTOYARD</span>
            <span className="text-otto-gray text-[10px] leading-tight hidden xl:block">Depot Simulation Platform</span>
          </div>
        </div>
        <StatusPill status={status} />
        <SaveIndicator />
      </div>

      <div className="flex-1 flex items-center justify-center gap-4">
        <span className="font-mono text-white text-lg tracking-widest">{formatTime(simTime)}</span>
        <span className="text-otto-teal text-sm font-medium">{simSpeed}x</span>
        <span className="text-otto-gray text-xs">
          🚗 {vehicleCount} | ⏳ {queueDepth} | ✅ {vehiclesProcessed}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {!isDemoMode && (
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('ottoyard-demo'));
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-otto-amber hover:text-white hover:bg-otto-amber/10 rounded-md transition-colors border border-otto-amber/30"
          >
            <Presentation size={14} />
            <span className="hidden lg:inline">Demo</span>
          </button>
        )}
        <button onClick={togglePlayPause} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors">
          {status === 'running' ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={reset} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors">
          <RotateCcw size={18} />
        </button>

        <ViewModeToggle />

        <button className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
};
