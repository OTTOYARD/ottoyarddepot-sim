import { useState } from 'react';
import { ExternalLink, Loader2, Minus, MoreHorizontal, Pause, Play, Plus, Square } from 'lucide-react';
import { toast } from 'sonner';
import { useTwinStore } from '@/store/twinStore';
import { useSimulationStore } from '@/store/simulationStore';
import { useCockpitStore } from '@/store/cockpitStore';
import { useTwinControl, MAX_SPEED_X } from '@/hooks/useTwinControl';
import { useFleetOwners } from '@/hooks/useFleetOwners';
import { stopAndReset } from '@/lib/blackbox';
import { COCKPIT_LABEL, cockpitUrl, isLiveRunStatus, type Cockpit } from '@/lib/cockpitLinks';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PhoneStartDialog } from './PhoneStartDialog';
import { depotClock, phoneTelemetry, runPhase, type RunPhase } from './phoneLayout';
import mark from '@/assets/logo.png';

/**
 * THE PHONE'S RUN BAR — the slim Start / Pause / Stop / speed strip over the 3D
 * view. These are the REAL controls, the same calls the desktop's Control tab
 * makes: Pause/Resume and speed through useTwinControl, Stop through
 * blackbox.stopAndReset. A run started, paused or stopped here is started,
 * paused or stopped for every screen watching it.
 *
 * Start is deliberately NOT a one-tap button: starting a run purges the one
 * before it and needs a scenario, so "Start" opens a confirm (PhoneStartDialog)
 * with the featured scenarios, Busy Day first, whose "Start run" starts it for
 * real through useStartRun — the desktop Control tab's own start path. Its
 * "More options in Control" opens the full console in the panel sheet. Stop
 * asks first.
 */

const PHASE_LABEL: Record<RunPhase, string> = {
  offline: 'OFFLINE', 'no-run': 'NO RUN', running: 'LIVE', paused: 'PAUSED', ended: 'ENDED',
};
const PHASE_DOT: Record<RunPhase, string> = {
  offline: 'bg-ink-faint', 'no-run': 'bg-ink-faint', running: 'bg-state-go animate-pulse', paused: 'bg-state-warn', ended: 'bg-ink-faint',
};

const ICON_BTN =
  'h-10 min-w-10 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-md border border-white/10 bg-canvas-elev/90 text-ink ' +
  'active:bg-white/15 disabled:opacity-40 disabled:pointer-events-none font-display text-[11px] uppercase tracking-[0.06em]';

export function PhoneRunBar({ layout, onOpenControl }: { layout: 'landscape' | 'portrait'; onOpenControl: () => void }) {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const snapshot = useTwinStore((s) => s.snapshot);
  const connected = useTwinStore((s) => s.connected);
  const ctrl = useTwinControl();
  const [stopping, setStopping] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [menu, setMenu] = useState(false);

  const phase = runPhase(snapshot, activeSimRunId, connected);
  const hasRun = !!activeSimRunId;
  const run = snapshot?.run;
  const telemetry = phoneTelemetry(snapshot);

  // The desktop Control tab's Stop, step for step (OperatorConsole.stopRun).
  const stop = async () => {
    if (!activeSimRunId) return;
    setStopping(true);
    try {
      await stopAndReset(activeSimRunId);
      ctrl.pause();
      useSimulationStore.getState().setActiveTab('history');
      toast.success('Run stopped. The depot is empty.', { description: 'Its Black Box is on the Runs tab.' });
    } catch (e: unknown) {
      toast.error('Stop failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setStopping(false);
    }
  };

  const status = (
    <div className="flex items-center gap-2 min-w-0">
      <img src={mark} alt="OTTOYARD" className="h-7 w-auto shrink-0 select-none" draggable={false} />
      <div className="flex flex-col leading-none min-w-0">
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PHASE_DOT[phase]}`} />
          {PHASE_LABEL[phase]}
          {run?.scenario && hasRun && <span className="text-ink-faint truncate">· {run.scenario}</span>}
        </span>
        <span className="font-mono text-[15px] text-white cc-num mt-0.5">
          {depotClock(hasRun ? run?.sim_clock : null)}
          <span className="text-ink-faint text-[10px] ml-1">CT</span>
        </span>
      </div>
    </div>
  );

  const telemetryStrip = (
    <div className="flex items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0 px-1">
      {telemetry.slice(0, layout === 'landscape' ? 4 : telemetry.length).map((c) => (
        <div key={c.key} className="flex flex-col leading-none shrink-0">
          <span className="font-display text-[8.5px] uppercase tracking-[0.08em] text-ink-faint">{c.label}</span>
          <span className="font-mono text-[12px] text-ink cc-num">
            {c.value}{c.unit && <span className="text-ink-faint text-[9px] ml-0.5">{c.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  );

  const transport = (
    <div className="flex items-center gap-1.5 shrink-0">
      {!hasRun ? (
        <button className={`${ICON_BTN} bg-brand-red border-brand-red text-white px-3`} onClick={() => setConfirmStart(true)}>
          <Play size={15} /> Start
        </button>
      ) : (
        <>
          <button className={ICON_BTN} onClick={ctrl.toggle} aria-label={ctrl.playing ? 'Pause' : 'Resume'}>
            {ctrl.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className={ICON_BTN} onClick={() => setConfirmStop(true)} disabled={stopping} aria-label="Stop run">
            {stopping ? <Loader2 size={15} className="animate-spin" /> : <Square size={14} />}
          </button>
        </>
      )}
      {/* speed: the same 1..8x as the desktop slider, one step per tap */}
      <div className="flex items-center h-10 rounded-md border border-white/10 bg-canvas-elev/90">
        <button className="h-10 w-9 inline-flex items-center justify-center text-ink disabled:opacity-40"
          onClick={() => ctrl.setSpeed(ctrl.speed - 1)} disabled={!hasRun || ctrl.speed <= 1} aria-label="Decrease speed">
          <Minus size={14} />
        </button>
        <span className="font-mono text-[12px] text-white cc-num w-7 text-center">{ctrl.speed}×</span>
        <button className="h-10 w-9 inline-flex items-center justify-center text-ink disabled:opacity-40"
          onClick={() => ctrl.setSpeed(ctrl.speed + 1)} disabled={!hasRun || ctrl.speed >= MAX_SPEED_X} aria-label="Increase speed">
          <Plus size={14} />
        </button>
      </div>
      <div className="relative">
        <button className={ICON_BTN} onClick={() => setMenu((m) => !m)} aria-label="More">
          <MoreHorizontal size={16} />
        </button>
        {menu && <MoreMenu onClose={() => setMenu(false)} />}
      </div>
    </div>
  );

  return (
    <>
      {layout === 'landscape' ? (
        <div className="flex items-center gap-3 h-14">
          {status}
          <div className="flex-1 min-w-0">{telemetryStrip}</div>
          {transport}
        </div>
      ) : (
        <div className="flex flex-col gap-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            {status}
            {transport}
          </div>
          {telemetryStrip}
        </div>
      )}

      <PhoneStartDialog open={confirmStart} onOpenChange={setConfirmStart} ctrl={ctrl} onOpenControl={onOpenControl} />

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent className="bg-canvas-panel border-white/10 text-ink max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this run?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-dim">
              The run stops for all viewers. The depot becomes empty. Its Black Box stays on the Runs tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-canvas-elev border-white/10 text-ink">Continue run</AlertDialogCancel>
            <AlertDialogAction className="bg-brand-red hover:bg-brand-deep text-white" onClick={stop}>Stop run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * "View in" for the phone: OrchestrAV and PULSE open in a new tab pinned to the
 * run on screen (the desktop switcher's links; its side-by-side panel has no
 * room on a phone and is not offered). No live run, nothing to pin to: it says so.
 */
function MoreMenu({ onClose }: { onClose: () => void }) {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const run = useTwinStore((s) => s.snapshot?.run);
  const owner = useCockpitStore((s) => s.owner);
  const { owners } = useFleetOwners(activeSimRunId);
  const liveRunId = run && run.sim_run_id === activeSimRunId && isLiveRunStatus(run.status) ? run.sim_run_id : null;
  const asOwner = owner && owners.some((o) => o.id === owner) ? owner : owners[0]?.id ?? null;
  const open = (c: Cockpit) => {
    if (!liveRunId) return;
    window.open(cockpitUrl(c, { runId: liveRunId, owner: asOwner }), '_blank', 'noopener');
    onClose();
  };
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-12 z-50 w-56 rounded-lg border border-white/10 bg-canvas-panel/95 backdrop-blur p-1.5 shadow-xl">
        <div className="px-2 pt-1 pb-1.5 font-display text-[9px] uppercase tracking-[0.1em] text-ink-faint">View this run in</div>
        {(['pulse', 'orchestrav'] as Cockpit[]).map((c) => (
          <button key={c} disabled={!liveRunId} onClick={() => open(c)}
            className="w-full min-h-11 px-2 rounded-md flex items-center justify-between text-left text-[13px] text-ink active:bg-white/10 disabled:opacity-40">
            <span>
              {COCKPIT_LABEL[c]}
              {c === 'orchestrav' && asOwner && (
                <span className="block text-[10px] text-ink-faint">as {owners.find((o) => o.id === asOwner)?.name ?? 'fleet owner'}</span>
              )}
            </span>
            <ExternalLink size={14} className="text-ink-faint" />
          </button>
        ))}
        {!liveRunId && <div className="px-2 py-1.5 text-[11px] text-ink-faint">No live run. Start a run, then open a cockpit.</div>}
      </div>
    </>
  );
}
