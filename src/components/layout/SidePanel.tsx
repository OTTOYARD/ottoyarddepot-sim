import { ChevronLeft, ChevronRight } from 'lucide-react';
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

export const SidePanel = () => {
  const { isPanelOpen, togglePanel, activeTab } = useSimulationStore();
  const ActiveComponent = tabComponents[activeTab] ?? OperatorConsole;

  return (
    <div
      className="relative shrink-0 transition-all duration-300 ease-in-out"
      style={{ width: isPanelOpen ? 420 : 0 }}
    >
      <button
        onClick={togglePanel}
        className="absolute -left-6 top-1/2 -translate-y-1/2 z-10 w-6 h-12 bg-canvas-panel border border-white/[0.06] border-r-0 rounded-l-md flex items-center justify-center text-ink-dim hover:text-ink transition-colors"
      >
        {isPanelOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <div className="w-[420px] h-full bg-canvas-raised border-l border-white/[0.06] flex flex-col overflow-hidden">
        <TabBar />
        <ActiveComponent />
      </div>
    </div>
  );
};
