import { useRef } from 'react';
import { BottomBar } from '@/components/layout/BottomBar';
import { DepotSVG } from './DepotSVG';
import { DepotLegend } from './DepotLegend';
import { StallTooltip } from './StallTooltip';
import { StallPopup } from './StallPopup';
import { VehicleTooltip } from './VehicleTooltip';
import { useEngineLifecycle } from '@/hooks/useEngineLifecycle';

export const DepotCanvas = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  useEngineLifecycle();

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center p-2">
          <DepotSVG ref={svgRef} />
        </div>
        <StallTooltip svgRef={svgRef} />
        <StallPopup svgRef={svgRef} />
        <DepotLegend />
      </div>
      <BottomBar />
    </div>
  );
};
