import { useSimulationStore } from '@/store/simulationStore';

type Tab = { id: 'controls' | 'kpis' | 'ai-summary' | 'alerts' | 'history' | 'swap-test' | 'copilot'; label: string };

const tabs: Tab[] = [
  { id: 'controls', label: 'Controls' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'ai-summary', label: 'AI Summary' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'history', label: 'History' },
  { id: 'swap-test', label: 'Swap-Test' },
  { id: 'copilot', label: 'Copilot' },
];

export const TabBar = () => {
  const { activeTab, setActiveTab } = useSimulationStore();

  return (
    <div className="flex border-b border-white/[0.06]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`px-4 py-3 text-xs font-display uppercase tracking-[0.06em] transition-colors relative ${
            activeTab === tab.id ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
          }`}
        >
          {tab.label}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-red" />
          )}
        </button>
      ))}
    </div>
  );
};
