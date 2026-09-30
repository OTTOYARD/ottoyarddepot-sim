import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useSimulationStore, type CockpitTab } from '@/store/simulationStore';
import { TabBar } from './TabBar';
import { OperatorConsole } from '@/components/cockpit/OperatorConsole';
import { TwinKpisTab } from '@/components/tabs/TwinKpisTab';
import { TwinHistoryTab } from '@/components/tabs/TwinHistoryTab';
import { TwinCopilotTab } from '@/components/tabs/TwinCopilotTab';
import { WorldContractTab } from '@/components/tabs/WorldContractTab';
import { TwinOttoQTab } from '@/components/tabs/TwinOttoQTab';
import { TwinAgentTab } from '@/components/tabs/TwinAgentTab';
import { TwinValueTab } from '@/components/tabs/TwinValueTab';

const tabComponents: Record<CockpitTab, () => JSX.Element> = {
  controls: OperatorConsole,             // run the world: scenario, transport, speed, variability, injections
  ottoq: TwinOttoQTab,                   // the living funnel: every car through the engine's layers
  agent: TwinAgentTab,                   // the agent in plain English: read, chose, disposed, learned
  kpis: TwinKpisTab,                     // canonical five KPIs (ottoq_kpi_five) + live site readings
  history: TwinHistoryTab,               // run ledger + compare + Black Box download
  world: WorldContractTab,               // feed diagnostics: world load, channels, variable coverage
  copilot: TwinCopilotTab,               // on-demand model review of a sample of this run's decisions
  value: TwinValueTab,                   // what OTTO-Q is worth at this depot (ottoq_value_summary, otto-q-core 0576)
};

/** A popup (select list, menu, dialog) is open: that Esc is closing IT, not the full-width panel. */
const popupOpen = () =>
  !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]');

/**
 * The cockpit's right-hand panel: 420 px beside the depot view, or, with the expand
 * button in its header, the full width of the area under the top bar, over the depot
 * view. The view stays mounted underneath (its WebGL context is never torn down) and
 * so does the open tab: expanding restyles the same elements, it does not rebuild them.
 * Esc or the same button brings the panel back to 420 px.
 */
export const SidePanel = () => {
  const { isPanelOpen, togglePanel, activeTab, isPanelExpanded, togglePanelExpanded, setPanelExpanded } = useSimulationStore();
  const ActiveComponent = tabComponents[activeTab] ?? OperatorConsole;
  const expanded = isPanelOpen && isPanelExpanded;

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || popupOpen()) return;
      setPanelExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, setPanelExpanded]);

  const expandButton = (
    <button
      type="button"
      onClick={togglePanelExpanded}
      aria-label={expanded ? 'Exit full width' : 'Expand panel to full width'}
      aria-pressed={expanded}
      title={expanded ? 'Exit full width (Esc)' : 'Expand to full width'}
      data-testid="panel-expand"
      className="shrink-0 m-1 w-8 h-8 inline-flex items-center justify-center rounded-md text-ink-dim hover:text-ink hover:bg-white/[0.06] transition-colors"
    >
      {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );

  return (
    <div
      className={expanded ? 'absolute inset-0 z-30' : 'relative shrink-0 transition-all duration-300 ease-in-out'}
      style={expanded ? undefined : { width: isPanelOpen ? 420 : 0 }}
      data-panel-expanded={expanded ? 'true' : undefined}
    >
      {!expanded && (
        <button
          onClick={togglePanel}
          aria-label={isPanelOpen ? 'Close panel' : 'Open panel'}
          className="absolute -left-6 top-1/2 -translate-y-1/2 z-10 w-6 h-12 bg-canvas-panel border border-white/[0.06] border-r-0 rounded-l-md flex items-center justify-center text-ink-dim hover:text-ink transition-colors"
        >
          {isPanelOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      )}

      <div className={`${expanded ? 'w-full' : 'w-[420px] border-l border-white/[0.06]'} h-full bg-canvas-raised flex flex-col overflow-hidden`}>
        <TabBar trailing={expandButton} />
        <ActiveComponent />
      </div>
    </div>
  );
};
