import { useEffect, useRef, useState } from 'react';
import { useSimulationStore, type CockpitTab } from '@/store/simulationStore';
import { OperatorConsole } from '@/components/cockpit/OperatorConsole';
import { TwinKpisTab } from '@/components/tabs/TwinKpisTab';
import { TwinOrchestrationTab } from '@/components/tabs/TwinOrchestrationTab';
import { TwinAlertsTab } from '@/components/tabs/TwinAlertsTab';
import { TwinHistoryTab } from '@/components/tabs/TwinHistoryTab';
import { TwinCopilotTab } from '@/components/tabs/TwinCopilotTab';
import { WorldContractTab } from '@/components/tabs/WorldContractTab';
import TwinIntelligenceTab from '@/components/tabs/TwinIntelligenceTab';
import { TwinValueTab } from '@/components/tabs/TwinValueTab';
import { settleSheet, sheetHeights } from './phoneLayout';
import { usePhoneSheet } from './phoneStore';

/**
 * The phone's panels: the desktop side panel's NINE TABS, the very same
 * components, in a sheet.
 *
 *   landscape  'floating' — a sheet over the 3D view, anchored bottom-left and
 *              about half the width (the panels are built 420 px wide; a
 *              full-width sheet would stretch them), dragged or tapped between
 *              peek (the tab row), half and full height.
 *   portrait   'inline'  — the panels fill the screen under the small live view.
 *
 * Same tabs, same order, same labels as the desktop TabBar; a tab added to
 * CockpitTab fails to compile here until the phone shows it too.
 */
const TAB_LABEL: Record<CockpitTab, string> = {
  controls: 'Control',
  intelligence: 'Intelligence',
  orchestration: 'Orchestration',
  kpis: 'KPIs',
  alerts: 'Events',
  history: 'Runs',
  world: 'Diagnostics',
  copilot: 'Copilot',
  value: 'Value',
};
const TABS = (Object.keys(TAB_LABEL) as CockpitTab[]).map((id) => ({ id, label: TAB_LABEL[id] }));
const TAB_COMPONENTS: Record<CockpitTab, () => JSX.Element> = {
  controls: OperatorConsole,
  intelligence: TwinIntelligenceTab,
  orchestration: TwinOrchestrationTab,
  kpis: TwinKpisTab,
  alerts: TwinAlertsTab,
  history: TwinHistoryTab,
  world: WorldContractTab,
  copilot: TwinCopilotTab,
  value: TwinValueTab,
};


const HANDLE_H = 22;
const TABS_H = 44;
const PEEK_H = HANDLE_H + TABS_H;

function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return h;
}

export function PhoneSheet({ mode, topInset }: { mode: 'floating' | 'inline'; topInset: number }) {
  const activeTab = useSimulationStore((s) => s.activeTab);
  const setActiveTab = useSimulationStore((s) => s.setActiveTab);
  const snap = usePhoneSheet((s) => s.snap);
  const setSnap = usePhoneSheet((s) => s.setSnap);
  const vh = useViewportHeight();
  const heights = sheetHeights(vh, PEEK_H, topInset);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ id: number; y0: number; h0: number; lastY: number; lastT: number; v: number; moved: boolean } | null>(null);
  /** A drag ends in a click on some browsers; that click must not also toggle the sheet. */
  const dragged = useRef(false);
  const Active = TAB_COMPONENTS[activeTab] ?? OperatorConsole;
  const floating = mode === 'floating';

  const pick = (id: CockpitTab) => {
    setActiveTab(id);
    if (floating && snap === 'peek') setSnap('half');
  };

  // ── drag the handle: follow the finger, then settle on a snap ─────────────
  const onDown = (e: React.PointerEvent) => {
    if (!floating) return;
    dragged.current = false;
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* capture is a nicety: moves still arrive on the handle */ }
    drag.current = { id: e.pointerId, y0: e.clientY, h0: heights[snap], lastY: e.clientY, lastT: performance.now(), v: 0, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const now = performance.now();
    const dy = d.lastY - e.clientY; // up = positive
    if (now > d.lastT) d.v = dy / (now - d.lastT);
    d.lastY = e.clientY; d.lastT = now;
    if (Math.abs(e.clientY - d.y0) > 6) d.moved = true;
    if (d.moved) setDragH(Math.min(heights.full, Math.max(heights.peek, d.h0 + (d.y0 - e.clientY))));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    dragged.current = d.moved;
    if (!d.moved) { setDragH(null); return; } // a tap: the click handler toggles
    const h = Math.min(heights.full, Math.max(heights.peek, d.h0 + (d.y0 - e.clientY)));
    setSnap(settleSheet(h, d.v, heights));
    setDragH(null);
  };
  // A tap (or Enter / Space on the focused handle) opens a peeking sheet, closes an open one.
  const onClick = () => {
    if (dragged.current) { dragged.current = false; return; }
    setSnap(snap === 'peek' ? 'half' : 'peek');
  };

  const height = floating ? (dragH ?? heights[snap]) : undefined;

  return (
    <div
      className={floating
        ? 'absolute bottom-0 z-30 flex flex-col rounded-t-xl border border-b-0 border-white/10 bg-canvas-raised/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.45)] overflow-hidden'
        : 'relative flex-1 min-h-0 flex flex-col bg-canvas-raised border-t border-white/[0.06]'}
      style={floating ? {
        height,
        left: 'calc(env(safe-area-inset-left, 0px) + 8px)',
        width: 'min(460px, 52vw)',
        transition: dragH === null ? 'height 220ms cubic-bezier(.2,.8,.2,1)' : 'none',
        paddingBottom: snap === 'peek' ? 0 : 'env(safe-area-inset-bottom, 0px)',
      } : undefined}
    >
      {floating && (
        <div
          className="shrink-0 flex items-center justify-center cursor-grab touch-none"
          style={{ height: HANDLE_H }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onClick={onClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
          tabIndex={0}
          role="button"
          aria-label={snap === 'peek' ? 'Open panels' : 'Close panels'}
        >
          <span className="w-10 h-1.5 rounded-full bg-white/25" />
        </div>
      )}
      <div className="shrink-0 flex items-center gap-1 px-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-white/[0.06]"
        style={{ height: TABS_H }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => pick(t.id)}
            className={`shrink-0 h-9 px-3 rounded-md inline-flex items-center gap-1.5 font-display text-[11px] uppercase tracking-[0.06em] ${
              activeTab === t.id ? 'bg-white/10 text-ink' : 'text-ink-faint active:bg-white/5'}`}>
            {t.id === 'intelligence' && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            {t.label}
          </button>
        ))}
      </div>
      {/* the desktop panel's own component, in a column of the height the sheet leaves it */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Active />
      </div>
    </div>
  );
}
