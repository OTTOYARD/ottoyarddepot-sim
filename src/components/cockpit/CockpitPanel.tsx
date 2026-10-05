import { X, ExternalLink } from 'lucide-react';
import { useTwinStore } from '@/store/twinStore';
import { useCockpitStore } from '@/store/cockpitStore';
import { COCKPIT_LABEL, cockpitUrl } from '@/lib/cockpitLinks';

// The cockpit beside the depot, framed at ?embed=1 so it hides its own app header.
// It is the real cockpit on the real backend: nothing here reads or draws world state.
export const CockpitPanel = () => {
  const panel = useCockpitStore((s) => s.panel);
  const owner = useCockpitStore((s) => s.owner);
  const setPanel = useCockpitStore((s) => s.setPanel);
  const runId = useTwinStore((s) => s.activeSimRunId);
  if (!panel || !runId) return null;

  const src = cockpitUrl(panel, { runId, owner, embed: true });
  const tab = cockpitUrl(panel, { runId, owner });
  return (
    <div className="h-full flex flex-col bg-canvas-raised" data-testid="cockpit-panel">
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.06]">
        <span className="shrink-0 whitespace-nowrap font-display text-[11px] uppercase tracking-[0.08em] text-ink">{COCKPIT_LABEL[panel]}</span>
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-ink-faint" title={runId}>run {runId.slice(0, 4)}…</span>
        {/* The cockpit keeps its own sign-in, and a framed app gets its own storage, so it asks
            once here. Google refuses to be framed (X-Frame-Options: DENY): use email, or the tab. */}
        <span className="min-w-0 truncate font-mono text-[10px] text-ink-faint" title="Sign in one time in this panel, with email. Google sign-in works only in a new tab.">
          · sign in here with email · Google: use a new tab
        </span>
        <a href={tab} target="_blank" rel="noopener" className="ml-auto text-ink-dim hover:text-ink" title="Open in a new tab">
          <ExternalLink size={13} />
        </a>
        <button type="button" onClick={() => setPanel(null)} className="text-ink-dim hover:text-ink" title="Close">
          <X size={14} />
        </button>
      </div>
      {/* key: a new run or owner reloads the cockpit instead of leaving it on the old one */}
      <iframe key={src} src={src} title={`${COCKPIT_LABEL[panel]} (twin run)`} className="flex-1 w-full border-0 bg-canvas-base" />
    </div>
  );
};
