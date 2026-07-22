import { useRef, lazy, Suspense } from 'react';
import { BottomBar } from '@/components/layout/BottomBar';
import { DepotSVG } from './DepotSVG';
import { DepotLegend } from './DepotLegend';
import { StallTooltip } from './StallTooltip';
import { StallPopup } from './StallPopup';
import { VehicleTooltip } from './VehicleTooltip';
import { AlertToasts } from './AlertToasts';
import { LoadingOverlay } from './LoadingOverlay';
import { DemoBanner } from './DemoBanner';
import { useEngineLifecycle } from '@/hooks/useEngineLifecycle';
import { useAppointments } from '@/hooks/useAppointments';
import { useSimulationStore } from '@/store/simulationStore';

const DepotScene3D = lazy(() => import('./DepotScene3D'));
const OmniverseViewer = lazy(() =>
  import('@/components/photoreal/OmniverseViewer').then((m) => ({ default: m.OmniverseViewer })),
);

export const DepotCanvas = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewMode = useSimulationStore((s) => s.viewMode);
  useEngineLifecycle();
  useAppointments(); // poll the reservation seam so the on-map glow stays live

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 relative overflow-hidden">
        {viewMode === 'photoreal' ? (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-otto-gray">Loading photoreal stream…</div>}>
            <OmniverseViewer />
          </Suspense>
        ) : (
          <>
            <DemoBanner />
            {viewMode === '2d' ? (
              <>
                <div className="absolute inset-0 flex items-center justify-center p-2">
                  <DepotSVG ref={svgRef} />
                </div>
                <StallTooltip svgRef={svgRef} />
                <StallPopup svgRef={svgRef} />
                <VehicleTooltip svgRef={svgRef} />
              </>
            ) : (
              <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-otto-gray">Loading 3D…</div>}>
                <DepotScene3D />
              </Suspense>
            )}
            <AlertToasts />
            <DepotLegend />
            <LoadingOverlay />
          </>
        )}
      </div>
      <BottomBar />
    </div>
  );
};
