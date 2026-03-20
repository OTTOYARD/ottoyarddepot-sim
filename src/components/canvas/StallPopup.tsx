import { useDepotStore } from '@/store/depotStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  dcfc: 'DC Fast Charger',
  l2: 'Level 2 Charger',
  wash: 'Wash Bay',
  staging: 'Staging Stall',
};

interface Props {
  svgRef: React.RefObject<SVGSVGElement>;
}

export const StallPopup = ({ svgRef }: Props) => {
  const selectedStallId = useDepotStore((s) => s.selectedStallId);
  const stalls = useDepotStore((s) => s.stalls);
  const selectStall = useDepotStore((s) => s.selectStall);

  if (!selectedStallId || !svgRef.current) return null;

  const stall = stalls.find((s) => s.id === selectedStallId);
  if (!stall) return null;

  const svg = svgRef.current;
  const pt = svg.createSVGPoint();
  pt.x = stall.position.x + 15;
  pt.y = stall.position.y;
  const screenPt = pt.matrixTransform(svg.getScreenCTM()!);
  const rect = svg.getBoundingClientRect();

  const left = Math.min(screenPt.x - rect.left, rect.width - 200);
  const top = Math.max(screenPt.y - rect.top - 40, 10);

  return (
    <Card
      className="absolute z-50 w-48 bg-otto-charcoal border-otto-gray/30 shadow-xl"
      style={{ left, top }}
    >
      <CardHeader className="p-3 pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-otto-white">{stall.id}</CardTitle>
          <button onClick={() => selectStall(null)} className="text-otto-gray hover:text-otto-white">
            <X size={14} />
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1 space-y-1.5">
        <div className="text-[11px] text-otto-gray">{TYPE_LABELS[stall.type]}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-otto-gray">Status:</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize border-otto-gray/30 text-otto-white">
            {stall.status}
          </Badge>
        </div>
        <div className="text-[11px] text-otto-gray">
          Vehicle: {stall.vehicleId || '—'}
        </div>
        <div className="text-[11px] text-otto-gray">
          Position: ({stall.position.x}, {stall.position.y})
        </div>
      </CardContent>
    </Card>
  );
};
