import type { ReactNode } from 'react';
import { useSimulationStore, type CockpitTab } from '@/store/simulationStore';

// EIGHT TABS, EACH ONE A DIFFERENT QUESTION (2026-09-30: Intelligence, Orchestration and Events became OTTO-Q and Agent).
//   Control      — run the world: scenario, transport, speed, variability, injections
//   OTTO-Q       — how OTTO-Q moves the depot: every car as a dot in a living funnel of the engine's layers, each decision
//                  the engine records flashing along its path; tap a layer to look inside it
//   Agent        — the agent layer in plain English: what it read, what it chose, what the solver and the decide path did
//                  with it, and what OTTO-Q learns afterwards (challenger, research wing)
//   KPIs         — the five canonical KPIs for this run, plus live site readings
//   Runs         — run history, compare, and the Black Box download
//   Diagnostics  — what this cockpit can and cannot see of the engine's world
//   Copilot      — an on-demand model review of a sample of this run's decisions (PR #108 repaired it)
//   Value        — what OTTO-Q is worth at this depot: power bill, chargers, revenue time (night-2 sweep, otto-q-core 0575/0576)
// Removed from navigation 2026-09-30 (Chase: "a lot of redundancy and slop data"; design note
// docs/OTTO-Q-FUNNEL-AND-AGENT-TABS.md): Intelligence, Orchestration and Events showed the same facts three times
// (a car placed on a charger was a trail step, a stream row, a lifecycle tile and an event). Their sources stay in
// src/components/tabs for review, as PR #108 did. Earlier: Decisions, AI Summary, Swap-Test, Scorekeeper, Recall,
// Black Box (2026-09-23).
const tabs: { id: CockpitTab; label: string }[] = [
  { id: 'controls', label: 'Control' },
  { id: 'ottoq', label: 'OTTO-Q' },
  { id: 'agent', label: 'Agent' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'history', label: 'Runs' },
  { id: 'world', label: 'Diagnostics' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'value', label: 'Value' },
];

/** `trailing` sits at the header's top-right, outside the (wrapping) tab row: the panel's expand button. */
export const TabBar = ({ trailing }: { trailing?: ReactNode } = {}) => {
  const { activeTab, setActiveTab } = useSimulationStore();

  return (
    <div className="flex items-start border-b border-white/[0.06]">
      <div className="flex flex-wrap flex-1 min-w-0">
        {tabs.map((tab) => {
          const isOttoQ = tab.id === 'ottoq';
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-xs font-display uppercase tracking-[0.06em] transition-colors relative inline-flex items-center gap-1.5 ${
                activeTab === tab.id ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
              }`}
            >
              {/* OTTO-Q is the engine itself — the tab to open when someone asks what the AI is
                  doing. Violet dot so the eye finds it. */}
              {isOttoQ && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-red" />
              )}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
};
