import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { TabBar } from './TabBar';
import { OperatorConsole } from '@/components/cockpit/OperatorConsole';
import { TwinKpisTab } from '@/components/tabs/TwinKpisTab';
import { TwinOrchestrationTab } from '@/components/tabs/TwinOrchestrationTab';
import { TwinAlertsTab } from '@/components/tabs/TwinAlertsTab';
import { TwinHistoryTab } from '@/components/tabs/TwinHistoryTab';
import { TwinCopilotTab } from '@/components/tabs/TwinCopilotTab';
import { BlackBoxPanel } from '@/components/cockpit/BlackBoxPanel';
import { WorldContractTab } from '@/components/tabs/WorldContractTab';
import TwinIntelligenceTab from '@/components/tabs/TwinIntelligenceTab';

const tabComponents = {
  controls: OperatorConsole,       // AV-only backend-driven console (replaces legacy ControlsTab)
  orchestration: TwinOrchestrationTab, // OTTO-Q appointment/reservation/servicing seam (investor view)
  world: WorldContractTab,         // world-load gate, channel integrity, coverage, decision trace
  kpis: TwinKpisTab,               // live backend KPIs (replaces legacy KPIsTab)
  alerts: TwinAlertsTab,           // live backend event feed (replaces legacy AlertsTab)
  history: TwinHistoryTab,         // backend run-history ledger + compare
  intelligence: TwinIntelligenceTab, // includes both the live decision stream and measured layers
  copilot: TwinCopilotTab,         // agentic copilot: Nemotron 3 Ultra audit of OTTO-Q decisions
  blackbox: BlackBoxPanel,         // flight recorder: Play/Stop/Download run-audit bundle
};

export const SidePanel = () => {
  const { isPanelOpen, togglePanel, activeTab } = useSimulationStore();
  const ActiveComponent = tabComponents[activeTab];

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
