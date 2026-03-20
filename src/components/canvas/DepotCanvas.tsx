import { useRef } from 'react';
import { BottomBar } from '@/components/layout/BottomBar';
import { DepotSVG } from './DepotSVG';
import { DepotLegend } from './DepotLegend';
import { StallTooltip } from './StallTooltip';
import { StallPopup } from './StallPopup';

export const DepotCanvas = () => {
  const svgRef = useRef<SVGSVGElement>(null);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center p-2">
          <div className="w-full h-full" ref={svgRef as any}>
            <DepotSVG />
          </div>
        </div>
        <StallTooltip svgRef={svgRef as any} />
        <StallPopup svgRef={svgRef as any} />
        <DepotLegend />
      </div>
      <BottomBar />
    </div>
  );
};
