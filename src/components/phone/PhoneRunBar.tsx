import { useState } from 'react';
import { ExternalLink, MoreHorizontal } from 'lucide-react';
import { useTwinStore } from '@/store/twinStore';
import { useCockpitStore } from '@/store/cockpitStore';
import { useFleetOwners } from '@/hooks/useFleetOwners';
import { COCKPIT_LABEL, cockpitUrl, isLiveRunStatus, type Cockpit } from '@/lib/cockpitLinks';
import { RunTransport } from '@/components/cockpit/RunTransport';
import { ChargersDownChip } from '@/components/cockpit/ChargersDownChip';
import { depotClock, phoneTelemetry, runPhase, type RunPhase } from './phoneLayout';
import mark from '@/assets/logo.png';

/**
 * THE PHONE'S RUN BAR — the slim Start / Pause / Stop / speed strip over the 3D
 * view. Its transport is RunTransport, the very component the desktop top bar
 * carries: the REAL controls, the same calls the desktop's Control tab makes. A run
 * started, paused or stopped here is started, paused or stopped for every screen
 * watching it.
 *
 * Start is deliberately NOT a one-tap button: starting a run purges the one
 * before it and needs a scenario, so "Start" opens a confirm (StartRunDialog)
 * with the featured scenarios, Busy Day first, whose "Start run" starts it for
 * real through useStartRun — the desktop Control tab's own start path. Its
 * "More options in Control" opens the full console in the panel sheet. Stop
 * asks first.
 *
 * The status strip leads with the red "N chargers down" chip while the twin
 * reports any charger down; a tap lists them and when each comes back.
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
  const [menu, setMenu] = useState(false);

  const phase = runPhase(snapshot, activeSimRunId, connected);
  const hasRun = !!activeSimRunId;
  const run = snapshot?.run;
  const telemetry = phoneTelemetry(snapshot);

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
      <ChargersDownChip variant="phone" />
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

  // Start, or Pause/Resume and Stop, and the speed: the desktop top bar's own transport
  const transport = (
    <RunTransport variant="phone" onOpenControl={onOpenControl}>
      <div className="relative">
        <button className={ICON_BTN} onClick={() => setMenu((m) => !m)} aria-label="More">
          <MoreHorizontal size={16} />
        </button>
        {menu && <MoreMenu onClose={() => setMenu(false)} />}
      </div>
    </RunTransport>
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
