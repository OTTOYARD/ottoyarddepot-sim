import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useSimulationStore, type CockpitTab } from '@/store/simulationStore';
import { OperatorConsole } from '@/components/cockpit/OperatorConsole';
import { TwinKpisTab } from '@/components/tabs/TwinKpisTab';
import { TwinHistoryTab } from '@/components/tabs/TwinHistoryTab';
import { TwinCopilotTab } from '@/components/tabs/TwinCopilotTab';
import { WorldContractTab } from '@/components/tabs/WorldContractTab';
import { TwinOttoQTab } from '@/components/tabs/TwinOttoQTab';
import { TwinAgentTab } from '@/components/tabs/TwinAgentTab';
import { TwinValueTab } from '@/components/tabs/TwinValueTab';
import { TwinBackgroundTab } from '@/components/tabs/TwinBackgroundTab';
import { settleSheet, sheetHeights } from './phoneLayout';
import { usePhoneSheet } from './phoneStore';

/**
 * The phone's panels: the desktop side panel's EIGHT TABS, the very same
 * components, in a sheet.
 *
 *   landscape  'floating' — a sheet over the 3D view, anchored bottom-left and
 *              about half the width (the panels are built 420 px wide; a
 *              full-width sheet would stretch them), dragged or tapped between
 *              peek (the tab row), half and full height.
 *   portrait   'inline'  — the panels fill the screen under the small live view.
 *
 * Either one goes FULL SCREEN with the toggle at the end of the tab row: the sheet
 * covers the whole screen (run bar and live view stay mounted underneath) and the
 * same toggle brings it back to where it was.
 *
 * Same tabs, same order, same labels as the desktop TabBar; a tab added to
 * CockpitTab fails to compile here until the phone shows it too.
 */
const TAB_LABEL: Record<CockpitTab, string> = {
  controls: 'Control',
  ottoq: 'OTTO-Q',
  agent: 'Agent',
  kpis: 'KPIs',
  history: 'Runs',
  world: 'Diagnostics',
  copilot: 'Copilot',
  value: 'Value',
  background: 'Background',
};
const TABS = (Object.keys(TAB_LABEL) as CockpitTab[]).map((id) => ({ id, label: TAB_LABEL[id] }));
const TAB_COMPONENTS: Record<CockpitTab, () => JSX.Element> = {
  controls: OperatorConsole,
  ottoq: TwinOttoQTab,
  agent: TwinAgentTab,
  kpis: TwinKpisTab,
  history: TwinHistoryTab,
  world: WorldContractTab,
  copilot: TwinCopilotTab,
  value: TwinValueTab,
  background: TwinBackgroundTab,
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
  const fullscreen = usePhoneSheet((s) => s.fullscreen);
  const toggleFullscreen = usePhoneSheet((s) => s.toggleFullscreen);
  const vh = useViewportHeight();
  const heights = sheetHeights(vh, PEEK_H, topInset);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ id: number; y0: number; h0: number; lastY: number; lastT: number; v: number; moved: boolean } | null>(null);
  /** A drag ends in a click on some browsers; that click must not also toggle the sheet. */
  const dragged = useRef(false);
  const Active = TAB_COMPONENTS[activeTab] ?? OperatorConsole;
  // Full screen overrides both modes; the handle, the drag and the snaps are for the floating sheet only.
  const floating = mode === 'floating' && !fullscreen;

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
      data-sheet-fullscreen={fullscreen ? 'true' : undefined}
      className={fullscreen
        ? 'fixed inset-0 z-40 flex flex-col bg-canvas-raised'
        : floating
        ? 'absolute bottom-0 z-30 flex flex-col rounded-t-xl border border-b-0 border-white/10 bg-canvas-raised/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.45)] overflow-hidden'
        : 'relative flex-1 min-h-0 flex flex-col bg-canvas-raised border-t border-white/[0.06]'}
      style={floating ? {
        height,
        left: 'calc(env(safe-area-inset-left, 0px) + 8px)',
        width: 'min(460px, 52vw)',
        transition: dragH === null ? 'height 220ms cubic-bezier(.2,.8,.2,1)' : 'none',
        paddingBottom: snap === 'peek' ? 0 : 'env(safe-area-inset-bottom, 0px)',
      } : fullscreen ? {
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
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
      <div className="shrink-0 flex items-center border-b border-white/[0.06]" style={{ height: TABS_H }}>
        <div className="flex-1 min-w-0 h-full flex items-center gap-1 px-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => pick(t.id)}
              className={`shrink-0 h-9 px-3 rounded-md inline-flex items-center gap-1.5 font-display text-[11px] uppercase tracking-[0.06em] ${
                activeTab === t.id ? 'bg-white/10 text-ink' : 'text-ink-faint active:bg-white/5'}`}>
              {t.id === 'ottoq' && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen panels'}
          aria-pressed={fullscreen}
          data-testid="sheet-fullscreen"
          className="shrink-0 mr-1.5 h-9 w-9 inline-flex items-center justify-center rounded-md border border-white/10 text-ink-dim active:bg-white/10"
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      {/* the desktop panel's own component, in a column of the height the sheet leaves it */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Active />
      </div>
    </div>
  );
}
