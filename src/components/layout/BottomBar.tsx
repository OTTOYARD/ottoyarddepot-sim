import { Bot } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { useOwnerBoardStore } from '@/store/ownerBoardStore';
import { agentLabel, connectedAgents, connectedCount } from '@/lib/ownerBoard';

/**
 * Owners' agents connected to the depot (otto-q-core 0608), beside the run's LIVE mark; nothing when none is. Here and
 * not in the top bar: at 1440 px the top bar's telemetry strip has no room to spare, and a chip there clipped it.
 */
const AgentsConnected = () => {
  const board = useOwnerBoardStore((s) => s.board);
  const n = connectedCount(board);
  if (!n) return null;
  const who = connectedAgents(board).map((a) => agentLabel(a.agent, a.via)).join(', ');
  return (
    <span
      data-testid="agents-connected"
      title={`Owners' agents connected to this depot${who ? `: ${who}` : ''}. What they set shows on each car's Q card and in the Agent tab.`}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-200"
    >
      <Bot size={11} aria-hidden />
      {n} {n === 1 ? 'agent' : 'agents'} connected
    </span>
  );
};

const formatHHMM = (seconds: number) => {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  return `${h}:${m}`;
};

export const BottomBar = () => {
  const { simTime, setSimTime, simClockLive } = useSimulationStore();

  // TWO CLOCKS, ONE SLIDER. While a backend run owns the clock, TwinMotionDriver
  // publishes the depot's real sim time here every second; a scrub would be
  // overwritten on the next frame, so the control would look broken rather than
  // ignored. Disable it and say WHY instead of letting the operator fight it.
  return (
    <div className="h-12 bg-otto-dark/90 border-t border-white/10 flex items-center px-4 gap-3 shrink-0">
      <span className="text-white text-xs font-mono w-16" title="Depot local time (America/Chicago)">{formatHHMM(simTime)} CT</span>
      <input
        type="range"
        min={0}
        max={86399}
        value={simTime}
        disabled={simClockLive}
        title={simClockLive ? 'The live run sets the depot clock. You cannot move this slider.' : undefined}
        onChange={(e) => setSimTime(Number(e.target.value))}
        className={`flex-1 h-1.5 appearance-none rounded-full bg-otto-teal/30
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-otto-red
          [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(192,0,0,0.5)]
          [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-otto-teal/30
          ${simClockLive
            ? 'opacity-50 cursor-not-allowed [&::-webkit-slider-thumb]:cursor-not-allowed'
            : 'cursor-pointer [&::-webkit-slider-thumb]:cursor-pointer'}`}
      />
      <span className="text-white text-xs font-mono w-12 text-right">
        {simClockLive ? 'LIVE' : '24:00'}
      </span>
      <AgentsConnected />
    </div>
  );
};
