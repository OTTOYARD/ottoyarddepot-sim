import { useEffect, useState } from 'react';
import { Columns2, ExternalLink } from 'lucide-react';
import { useTwinStore } from '@/store/twinStore';
import { useCockpitStore } from '@/store/cockpitStore';
import { useFleetOwners } from '@/hooks/useFleetOwners';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { COCKPIT_LABEL, cockpitUrl, isLiveRunStatus, type Cockpit } from '@/lib/cockpitLinks';

// "View in": Twin · OrchestrAV · PULSE. A cockpit opens a small menu: a new tab pinned to the
// run on screen, or the cockpit beside the depot (OrchestrAV as the owner picked there). With
// no live run there is nothing to pin a cockpit to, so the control says so and opens nothing.
// Compact on purpose: it sits under LIVE / 2D / 3D so the telemetry strip still fits at 1440 px.
const NO_RUN = 'No live twin run. Start one in Control, then open a cockpit on it.';

export const CockpitSwitcher = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const run = useTwinStore((s) => s.snapshot?.run);
  const { panel, setPanel, owner, setOwner } = useCockpitStore();
  const { owners, error: ownersError } = useFleetOwners(activeSimRunId);
  const [menu, setMenu] = useState<Cockpit | null>(null);

  const liveRunId =
    run && run.sim_run_id === activeSimRunId && isLiveRunStatus(run.status) ? run.sim_run_id : null;

  // Default to the largest fleet; drop a remembered owner the depot no longer carries.
  useEffect(() => {
    if (!owners.length) return;
    if (!owner || !owners.some((o) => o.id === owner)) setOwner(owners[0].id);
  }, [owners, owner, setOwner]);

  // A run that ends takes the side-by-side panel and any open menu with it.
  useEffect(() => {
    if (liveRunId) return;
    if (panel) setPanel(null);
    setMenu(null);
  }, [liveRunId, panel, setPanel]);

  const openTab = (c: Cockpit) => {
    if (!liveRunId) return;
    window.open(cockpitUrl(c, { runId: liveRunId, owner }), '_blank', 'noopener');
    setMenu(null);
  };
  const showBeside = (c: Cockpit) => {
    if (!liveRunId) return;
    setPanel(c);
    setMenu(null);
  };

  const seg = 'h-5 px-2 text-[11px] font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const on = 'text-white bg-brand-red';
  const off = 'text-ink-dim hover:text-ink';
  const item = 'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[12px] text-ink hover:bg-white/[0.06]';

  const cockpit = (c: Cockpit) => (
    <Popover key={c} open={menu === c} onOpenChange={(o) => setMenu(o ? c : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!liveRunId}
          title={liveRunId ? `Open ${COCKPIT_LABEL[c]} on this run` : NO_RUN}
          className={`${seg} border-l border-white/[0.06] ${panel === c ? on : off}`}
          data-testid={`view-in-${c}`}
        >
          {COCKPIT_LABEL[c]}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2 bg-canvas-panel border-white/[0.08] text-ink" data-testid={`view-in-menu-${c}`}>
        <div className="px-2 pb-1.5 font-mono text-[10px] text-ink-faint">
          run {liveRunId?.slice(0, 4)}… · {c === 'orchestrav' ? 'one fleet owner' : 'all owners'}
        </div>
        {c === 'orchestrav' && (
          <label className="block px-2 pb-2">
            <span className="block font-display text-[9px] uppercase tracking-[0.1em] text-ink-faint mb-1">Open as</span>
            <select
              value={owner ?? ''}
              onChange={(e) => setOwner(e.target.value || null)}
              disabled={!owners.length}
              aria-label="OrchestrAV fleet owner"
              className="w-full h-7 rounded bg-canvas-raised border border-white/[0.08] text-ink text-[12px] px-1.5 outline-none"
              data-testid="view-in-owner"
            >
              {!owners.length && <option value="">{ownersError ? 'Fleet owners unavailable' : 'Loading owners…'}</option>}
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name} · {o.vehicles} cars</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className={item} onClick={() => openTab(c)} data-testid={`open-tab-${c}`}>
          <ExternalLink size={13} className="text-ink-dim" /> Open in a new tab
        </button>
        <button type="button" className={item} onClick={() => showBeside(c)} data-testid={`open-beside-${c}`}>
          <Columns2 size={13} className="text-ink-dim" /> Show beside the depot
        </button>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex items-center gap-1.5 shrink-0" data-testid="view-in">
      <span
        className={`font-display text-[9px] uppercase tracking-[0.1em] leading-none ${liveRunId ? 'text-ink-faint' : 'text-state-warn'}`}
        title={liveRunId ? undefined : NO_RUN}
        data-testid={liveRunId ? undefined : 'view-in-no-run'}
      >
        {liveRunId ? 'View in' : 'View in · no live run'}
      </span>
      <div className="flex items-center rounded border border-white/[0.06] overflow-hidden">
        <button
          type="button"
          onClick={() => setPanel(null)}
          className={`${seg} ${panel === null ? on : off}`}
          title="The twin alone"
          data-testid="view-in-twin"
        >
          Twin
        </button>
        {cockpit('orchestrav')}
        {cockpit('pulse')}
      </div>
    </div>
  );
};
