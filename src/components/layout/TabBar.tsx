import { useSimulationStore } from '@/store/simulationStore';

type Tab = { id: 'controls' | 'kpis' | 'ai-summary' | 'alerts' | 'history'; label: string };

const tabs: Tab[] = [
  { id: 'controls', label: 'Controls' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'ai-summary', label: 'AI Summary' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'history', label: 'History' },
];

export const TabBar = () => {
  const { activeTab, setActiveTab } = useSimulationStore();

  return (
    <div className="flex border-b border-white/10">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === tab.id ? 'text-white' : 'text-otto-gray hover:text-white/80'
          }`}
        >
          {tab.label}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-otto-red" />
          )}
        </button>
      ))}
    </div>
  );
};
