import { useSimulationStore } from '@/store/simulationStore';

const formatHHMM = (seconds: number) => {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  return `${h}:${m}`;
};

export const BottomBar = () => {
  const { simTime, setSimTime } = useSimulationStore();

  return (
    <div className="h-12 bg-otto-dark/90 border-t border-white/10 flex items-center px-4 gap-3 shrink-0">
      <span className="text-white/70 text-xs font-mono w-12">{formatHHMM(simTime)}</span>
      <input
        type="range"
        min={0}
        max={86399}
        value={simTime}
        onChange={(e) => setSimTime(Number(e.target.value))}
        className="flex-1 h-1.5 appearance-none rounded-full bg-otto-teal/30 cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-otto-red [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(192,0,0,0.5)]
          [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-otto-teal/30"
      />
      <span className="text-white/70 text-xs font-mono w-12 text-right">24:00</span>
    </div>
  );
};
