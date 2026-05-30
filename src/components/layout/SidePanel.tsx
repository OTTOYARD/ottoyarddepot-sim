import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { TabBar } from './TabBar';
import { OperatorConsole } from '@/components/cockpit/OperatorConsole';
import { KPIsTab } from '@/components/tabs/KPIsTab';
import { AISummaryTab } from '@/components/tabs/AISummaryTab';
import { AlertsTab } from '@/components/tabs/AlertsTab';
import { HistoryTab } from '@/components/tabs/HistoryTab';

const tabComponents = {
  controls: OperatorConsole,   // AV-only backend-driven console (replaces legacy ControlsTab)
  kpis: KPIsTab,
  'ai-summary': AISummaryTab,
  alerts: AlertsTab,
  history: HistoryTab,
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
