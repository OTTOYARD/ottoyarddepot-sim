import { lazy, Suspense, useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Toaster } from 'sonner';
import { SceneErrorBoundary } from '@/components/canvas/SceneErrorBoundary';
import { RunBootSplash } from '@/components/canvas/RunBootSplash';
import { JumpPlanningOverlay } from '@/components/canvas/JumpPlanningOverlay';
import { useSimulationStore } from '@/store/simulationStore';
import { PhoneRunBar } from './PhoneRunBar';
import { PhoneSheet } from './PhoneSheet';
import { usePhoneSheet } from './phoneStore';
import { PhoneCameraMenu } from './PhoneCameraMenu';

const DepotScene3D = lazy(() => import('@/components/canvas/DepotScene3D'));

/**
 * THE PHONE COCKPIT (phone lane, phase 2). What a phone gets instead of the
 * desktop cockpit (ResponsiveGuard decides; a desktop never renders this).
 *
 *   landscape  the live 3D depot fills the screen; the run bar (status, clock,
 *              Start / Pause / Stop, speed) floats over its top edge; the panels
 *              live in a sheet anchored bottom-left; the camera presets and
 *              quality fold into one button.
 *   portrait   the run bar on top, a small live view under it (expandable), and
 *              the panels filling the rest.
 *
 * ONE element tree for both: rotating the phone restyles the same elements, so
 * the 3D view (its WebGL context, camera, followed car) and the open panel are
 * never torn down and rebuilt by a turn of the wrist.
 *
 * Everything here is presentation. The controls are the desktop's own calls, the
 * panels the desktop's own components; the world and the engine are untouched.
 */

const BAR_H = 56;

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

export default function PhoneCockpit() {
  const portrait = usePortrait();
  const [bigStage, setBigStage] = useState(false);

  // The Start sheet's "More options in Control": the desktop's own console, in the panel sheet.
  const openControl = () => {
    useSimulationStore.getState().setActiveTab('controls');
    usePhoneSheet.getState().setSnap('full');
  };

  return (
    <div className="fixed inset-0 bg-canvas-base overflow-hidden flex flex-col select-none" style={{ height: '100dvh' }}>
      {/* run bar */}
      <div
        className={portrait
          ? 'relative z-20 shrink-0 bg-canvas-raised border-b border-white/[0.06]'
          : 'absolute top-0 inset-x-0 z-20 bg-gradient-to-b from-black/80 via-black/55 to-transparent'}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 10px)',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + 10px)',
        }}
      >
        <PhoneRunBar layout={portrait ? 'portrait' : 'landscape'} onOpenControl={openControl} />
      </div>

      {/* the live view */}
      <div
        className={portrait ? 'relative shrink-0 transition-[height] duration-200' : 'absolute inset-0'}
        style={portrait ? { height: bigStage ? '58dvh' : '34dvh' } : undefined}
      >
        <SceneErrorBoundary onReturnTo2D={() => window.location.reload()}>
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-ink-faint text-sm">Loading 3D…</div>}>
            <DepotScene3D chrome="phone" overlayTop={portrait ? 0 : BAR_H} />
          </Suspense>
        </SceneErrorBoundary>
        <div
          className="absolute z-10 flex flex-col items-end gap-2"
          style={portrait
            ? { top: 8, right: 8 }
            : { top: `calc(env(safe-area-inset-top, 0px) + ${BAR_H + 8}px)`, right: 'calc(env(safe-area-inset-right, 0px) + 10px)' }}
        >
          <PhoneCameraMenu />
          {portrait && (
            <button
              onClick={() => setBigStage((b) => !b)}
              aria-label={bigStage ? 'Smaller live view' : 'Bigger live view'}
              className="h-11 w-11 inline-flex items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur active:bg-white/15"
            >
              {bigStage ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          )}
        </div>
        {/* run start and fast-forward overlays, as on the desktop canvas */}
        <RunBootSplash />
        <JumpPlanningOverlay />
      </div>

      {/* the panels */}
      <PhoneSheet mode={portrait ? 'inline' : 'floating'} topInset={BAR_H} />

      {/* feedback for the run bar and the panels' actions (the desktop mounts no toaster) */}
      <Toaster position="top-center" theme="dark" offset={BAR_H + 8} />
    </div>
  );
}
