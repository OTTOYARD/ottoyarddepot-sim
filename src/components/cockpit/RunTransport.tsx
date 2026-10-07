import { useState, type ReactNode } from 'react';
import { Loader2, Minus, Pause, Play, Plus, Square } from 'lucide-react';
import { useTwinStore } from '@/store/twinStore';
import { useTwinControl, MAX_SPEED_X } from '@/hooks/useTwinControl';
import { useStopRun } from '@/hooks/useStopRun';
import { StartRunDialog } from './StartRunDialog';
import { StopRunDialog } from './StopRunDialog';

/**
 * THE RUN TRANSPORT — Start, or Pause/Resume and Stop, and the speed. ONE component
 * for the phone's run bar and the desktop top bar (Chase, 2026-10-07: "the same start
 * run at the top of the screen"), so both show the same controls in the same states:
 *
 *   no run   Start (opens the confirm), speed shown but off
 *   a run    Pause or Resume, Stop (asks first), speed 1..8x
 *
 * These are the REAL controls, the same calls the desktop Control tab makes:
 * Pause/Resume and speed through useTwinControl, Start through useStartRun (in the
 * confirm), Stop through useStopRun. A run started, paused or stopped here is started,
 * paused or stopped for every screen watching it. Start is never one tap: starting a
 * run purges the one before it and needs a scenario, so it opens StartRunDialog (the
 * featured scenarios, Busy Day first); nothing starts until its "Start run".
 *
 * `children` sit at the end of the row (the phone's "More" menu).
 */
const SIZES = {
  phone: {
    btn: 'h-10 min-w-10 gap-1.5 rounded-md text-[11px]',
    plain: 'px-2.5 border-white/10 bg-canvas-elev/90 active:bg-white/15', start: 'px-3', icon: 16, stop: 14,
    speed: 'h-10 rounded-md border-white/10 bg-canvas-elev/90', step: 'h-10 w-9', value: 'text-[12px] w-7',
  },
  desktop: {
    btn: 'h-7 min-w-7 gap-1 rounded text-[10px]',
    plain: 'px-1.5 border-white/[0.08] bg-canvas-elev hover:bg-white/10', start: 'px-2.5', icon: 13, stop: 11,
    speed: 'h-7 rounded border-white/[0.08] bg-canvas-elev', step: 'h-7 w-6 hover:text-white', value: 'text-[11px] w-7',
  },
} as const;

export function RunTransport({ variant, onOpenControl, children }: {
  variant: 'phone' | 'desktop';
  /** "Open Control for more options" in the Start confirm. */
  onOpenControl: () => void;
  children?: ReactNode;
}) {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const ctrl = useTwinControl();
  const { stop, stopping } = useStopRun(ctrl);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const z = SIZES[variant];
  const hasRun = !!activeSimRunId;
  const base = `${z.btn} inline-flex items-center justify-center border disabled:opacity-40 disabled:pointer-events-none font-display uppercase tracking-[0.06em] transition-colors`;
  const btn = `${base} ${z.plain} text-ink`;
  const desk = variant === 'desktop';

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0" data-testid="run-transport">
        {!hasRun ? (
          <button className={`${base} ${z.start} bg-brand-red border-brand-red text-white hover:bg-brand-deep`}
            onClick={() => setConfirmStart(true)} title={desk ? 'Start a run. You choose the scenario first.' : undefined}>
            <Play size={z.icon - 1} /> Start
          </button>
        ) : (
          <>
            <button className={btn} onClick={ctrl.toggle} aria-label={ctrl.playing ? 'Pause' : 'Resume'}
              title={desk ? (ctrl.playing ? 'Pause the run' : 'Resume the run') : undefined}>
              {ctrl.playing ? <Pause size={z.icon} /> : <Play size={z.icon} />}
            </button>
            <button className={btn} onClick={() => setConfirmStop(true)} disabled={stopping} aria-label="Stop run"
              title={desk ? 'Stop the run' : undefined}>
              {stopping ? <Loader2 size={z.stop + 1} className="animate-spin" /> : <Square size={z.stop} />}
            </button>
          </>
        )}
        {/* speed: the same 1..8x as the Control tab's slider, one step per press */}
        <div className={`flex items-center border ${z.speed}`} title={desk ? 'Run speed' : undefined}>
          <button className={`${z.step} inline-flex items-center justify-center text-ink disabled:opacity-40`}
            onClick={() => ctrl.setSpeed(ctrl.speed - 1)} disabled={!hasRun || ctrl.speed <= 1} aria-label="Decrease speed">
            <Minus size={z.icon - 2} />
          </button>
          <span className={`font-mono text-white cc-num text-center ${z.value}`} data-testid="run-speed">{ctrl.speed}×</span>
          <button className={`${z.step} inline-flex items-center justify-center text-ink disabled:opacity-40`}
            onClick={() => ctrl.setSpeed(ctrl.speed + 1)} disabled={!hasRun || ctrl.speed >= MAX_SPEED_X} aria-label="Increase speed">
            <Plus size={z.icon - 2} />
          </button>
        </div>
        {children}
      </div>

      <StartRunDialog open={confirmStart} onOpenChange={setConfirmStart} ctrl={ctrl} onOpenControl={onOpenControl} />
      <StopRunDialog open={confirmStop} onOpenChange={setConfirmStop} onStop={() => { void stop(); }} />
    </>
  );
}
