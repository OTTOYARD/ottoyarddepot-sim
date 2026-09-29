import { lazy, Suspense, useEffect, useState } from 'react';
import { useTwinStore } from '@/store/twinStore';
import { SceneErrorBoundary } from './SceneErrorBoundary';

const DepotScene3D = lazy(() => import('./DepotScene3D'));

/**
 * THE TWIN ON A PHONE (phone lane, phase 1): the live 3D depot, full screen,
 * watch-only. Phones used to get a "use a desktop" card here (ResponsiveGuard's
 * 900 px floor). The full phone cockpit — run controls and the panels in a
 * bottom sheet — is phase 2; until then this is the view, and every control
 * that exists is the 3D view's own: camera presets, quality, tap a car to follow.
 *
 * Landscape is the twin's orientation. Where the browser allows it (Android,
 * installed or full-screen) the view asks to lock landscape; everywhere else a
 * portrait phone gets a hint to turn, and the scene still runs underneath.
 */
const DEPOT_TZ = 'America/Chicago';
const fmtClock = (iso?: string) => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DEPOT_TZ });
};

function usePortrait(): boolean {
  const q = '(orientation: portrait)';
  const [p, setP] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setP(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return p;
}

export function PhoneTwin() {
  const run = useTwinStore((s) => s.snapshot?.run);
  const connected = useTwinStore((s) => s.connected);
  const portrait = usePortrait();
  const [hintDismissed, setHintDismissed] = useState(false);

  // Ask for landscape. Only honoured where the Screen Orientation lock exists
  // and the page is full-screen or installed (Android); iOS ignores it.
  useEffect(() => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => { /* not allowed here: the hint covers it */ });
  }, []);

  const live = connected && run?.status === 'running';

  return (
    <div className="fixed inset-0 bg-otto-dark overflow-hidden select-none" style={{ height: '100dvh' }}>
      <SceneErrorBoundary onReturnTo2D={() => window.location.reload()}>
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-otto-gray text-sm">Loading 3D…</div>}>
          <DepotScene3D />
        </Suspense>
      </SceneErrorBoundary>

      {/* status strip, inside the notch-safe area */}
      <div
        className="absolute left-0 top-0 flex items-center gap-2 pointer-events-none"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 10px)' }}
      >
        <svg viewBox="0 0 100 100" className="w-5 h-5" aria-hidden>
          <path d="M50 5 L93 27.5 L93 72.5 L50 95 L7 72.5 L7 27.5 Z" fill="#C00000" />
          <path d="M50 20 L78 35 L78 65 L50 80 L22 65 L22 35 Z" fill="none" stroke="white" strokeWidth="3" />
        </svg>
        <span className="font-display text-[11px] tracking-[0.12em] text-white">OTTO-TWIN</span>
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 border border-white/10 font-mono text-[10px] text-white">
          <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-otto-gray'}`} />
          {live ? 'LIVE' : connected ? (run?.status ?? 'no run').toUpperCase() : 'OFFLINE'}
          <span className="text-otto-gray">·</span>
          {fmtClock(run?.sim_clock)} CT
        </span>
      </div>

      {portrait && !hintDismissed && (
        <button
          onClick={() => setHintDismissed(true)}
          className="absolute inset-x-6 bottom-24 mx-auto max-w-xs px-4 py-3 rounded-lg bg-black/80 border border-white/10 text-center text-white text-sm"
        >
          <div className="text-2xl mb-1" aria-hidden>⟳</div>
          Turn your phone sideways for the full depot view.
          <div className="mt-1 text-[11px] text-otto-gray">Tap to dismiss</div>
        </button>
      )}
    </div>
  );
}
