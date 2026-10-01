import { useCallback, useRef, lazy, Suspense } from 'react';
import { poseStore } from '@/engine/motion/poseStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { AnchoredQCard } from './VehicleQCard';
import { BottomBar } from '@/components/layout/BottomBar';
import { DepotSVG } from './DepotSVG';
import { DepotLegend } from './DepotLegend';
import { StallTooltip } from './StallTooltip';
import { StallPopup } from './StallPopup';
import { VehicleTooltip } from './VehicleTooltip';
import { AlertToasts } from './AlertToasts';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { useAppointments } from '@/hooks/useAppointments';
import { useSimulationStore } from '@/store/simulationStore';

const DepotScene3D = lazy(() => import('./DepotScene3D'));
const OmniverseViewer = lazy(() =>
  import('@/components/photoreal/OmniverseViewer').then((m) => ({ default: m.OmniverseViewer })),
);

export const DepotCanvas = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewMode = useSimulationStore((s) => s.viewMode);
  const setViewMode = useSimulationStore((s) => s.setViewMode);

  useAppointments(); // poll the reservation seam so the on-map glow stays live

  // The open Q card's car on screen: its drawn pose (the same poseStore pose the dot is moved by) through the map's
  // own transform, in client pixels. Camera-free and world-free: it only says where to draw.
  const anchor2D = useCallback((id: string) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = poseStore.get(id) ?? useVehicleStore.getState().vehicles.find((v) => v.id === id)?.position;
    if (!p) return null;
    const pt = svg.createSVGPoint();
    pt.x = p.x; pt.y = p.y;
    const s = pt.matrixTransform(ctm);
    // the card keeps clear of the car: half its 9.8u body plus a margin, at the map's scale
    return { x: s.x, y: s.y, r: 6.5 * Math.hypot(ctm.a, ctm.b) };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 relative overflow-hidden">
        {viewMode === 'photoreal' ? (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-otto-gray">Loading photoreal stream…</div>}>
            <OmniverseViewer />
          </Suspense>
        ) : (
          <>
            {viewMode === '2d' ? (
              <>
                <div className="absolute inset-0 flex items-center justify-center p-2">
                  <DepotSVG ref={svgRef} />
                </div>
                <StallTooltip svgRef={svgRef} />
                <StallPopup svgRef={svgRef} />
                <VehicleTooltip svgRef={svgRef} />
                <AnchoredQCard getAnchor={anchor2D} />
              </>
            ) : (
              <SceneErrorBoundary onReturnTo2D={() => setViewMode('2d')}>
                <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-otto-gray">Loading 3D…</div>}>
                  <DepotScene3D />
                </Suspense>
              </SceneErrorBoundary>
            )}
            <AlertToasts />
            <DepotLegend />
          </>
        )}
      </div>
      <BottomBar />
    </div>
  );
};
