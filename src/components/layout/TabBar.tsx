import { useSimulationStore } from '@/store/simulationStore';

type Tab = { id: 'controls' | 'recall' | 'world' | 'orchestration' | 'kpis' | 'ai-summary' | 'alerts' | 'history' | 'swap-test' | 'scorekeeper' | 'copilot' | 'blackbox' | 'decisions'; label: string };

const tabs: Tab[] = [
  { id: 'controls', label: 'Controls' },
  { id: 'recall', label: 'Recall' },
  { id: 'world', label: 'World' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'ai-summary', label: 'AI Summary' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'history', label: 'History' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'swap-test', label: 'Swap-Test' },
  { id: 'scorekeeper', label: 'Scorekeeper' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'blackbox', label: 'Black Box' },
];

export const TabBar = () => {
  const { activeTab, setActiveTab } = useSimulationStore();

  return (
    // flex-wrap so all tabs stay visible in the fixed-width panel — a single
    // non-wrapping row clipped the rightmost tabs (incl. Black Box) off-screen.
    <div className="flex flex-wrap border-b border-white/[0.06]">
      {tabs.map((tab) => {
        const isBlackbox = tab.id === 'blackbox';
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs font-display uppercase tracking-[0.06em] transition-colors relative inline-flex items-center gap-1.5 ${
              activeTab === tab.id ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
            }`}
          >
            {/* Black Box is the founder-side flight recorder — give it a red dot
                so the eye finds it immediately. */}
            {isBlackbox && <span className="w-1.5 h-1.5 rounded-full bg-brand-red shrink-0" />}
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-red" />
            )}
          </button>
        );
      })}
    </div>
  );
};
