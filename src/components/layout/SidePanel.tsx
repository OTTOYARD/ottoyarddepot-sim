import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { TabBar } from './TabBar';
import { ControlsTab } from '@/components/tabs/ControlsTab';
import { KPIsTab } from '@/components/tabs/KPIsTab';
import { AISummaryTab } from '@/components/tabs/AISummaryTab';
import { AlertsTab } from '@/components/tabs/AlertsTab';
import { HistoryTab } from '@/components/tabs/HistoryTab';

const tabComponents = {
  controls: ControlsTab,
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
        className="absolute -left-6 top-1/2 -translate-y-1/2 z-10 w-6 h-12 bg-otto-charcoal border border-white/10 border-r-0 rounded-l-md flex items-center justify-center text-white/60 hover:text-white transition-colors"
      >
        {isPanelOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <div className="w-[420px] h-full bg-otto-charcoal border-l border-white/10 flex flex-col overflow-hidden">
        <TabBar />
        <ActiveComponent />
      </div>
    </div>
  );
};
