import { useSimulationStore, type CockpitTab } from '@/store/simulationStore';

// EIGHT TABS, EACH ONE A DIFFERENT QUESTION (consolidated 2026-09-23 from fourteen, reconciled with PR #108).
//   Control       — run the world: scenario, transport, speed, variability, injections
//   Intelligence  — what OTTO-Q is deciding now (stream) and how it is built (layers)
//   Orchestration — the reservation / appointment seam the kernel maintains
//   KPIs          — the five canonical KPIs for this run, plus live site readings
//   Events        — the engine's event feed for this run
//   Runs          — run history, compare, and the Black Box download
//   Diagnostics   — what this cockpit can and cannot see of the engine's world
//   Copilot       — an on-demand model review of a sample of this run's decisions (PR #108 repaired it)
// Removed from navigation: Decisions (it was the Intelligence stream a second time), AI Summary (a
// browser-side narrative labelled as the engine; its source stays for review, per PR #108), Swap-Test and
// Scorekeeper (unsupported comparative claims), Recall (its writes are denied to this app's key), Black Box
// (its Play/Stop duplicated Control; the download lives on Runs).
const tabs: { id: CockpitTab; label: string }[] = [
  { id: 'controls', label: 'Control' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'alerts', label: 'Events' },
  { id: 'history', label: 'Runs' },
  { id: 'world', label: 'Diagnostics' },
  { id: 'copilot', label: 'Copilot' },
];

export const TabBar = () => {
  const { activeTab, setActiveTab } = useSimulationStore();

  return (
    <div className="flex flex-wrap border-b border-white/[0.06]">
      {tabs.map((tab) => {
        const isIntelligence = tab.id === 'intelligence';
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs font-display uppercase tracking-[0.06em] transition-colors relative inline-flex items-center gap-1.5 ${
              activeTab === tab.id ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
            }`}
          >
            {/* Intelligence is the OTTO-Q stack itself — the tab to open when someone asks what
                the AI is doing. Violet dot so the eye finds it. */}
            {isIntelligence && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
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
