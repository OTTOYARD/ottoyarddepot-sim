import { useDepotStore } from '@/store/depotStore';
import { Badge } from '@/components/ui/badge';

const TYPE_LABELS: Record<string, string> = {
  dcfc: 'DCFC',
  l2: 'L2',
  wash: 'Wash Bay',
  staging: 'Staging',
};

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-otto-teal/20 text-otto-teal',
  occupied: 'bg-otto-amber/20 text-otto-amber',
  charging: 'bg-otto-teal/30 text-otto-teal',
  servicing: 'bg-blue-500/20 text-blue-400',
  offline: 'bg-otto-red/20 text-otto-red',
  reserved: 'bg-otto-amber/20 text-otto-amber',
};

interface Props {
  svgRef: React.RefObject<SVGSVGElement>;
}

export const StallTooltip = ({ svgRef }: Props) => {
  const hoveredStallId = useDepotStore((s) => s.hoveredStallId);
  const stalls = useDepotStore((s) => s.stalls);

  if (!hoveredStallId || !svgRef.current) return null;

  const stall = stalls.find((s) => s.id === hoveredStallId);
  if (!stall) return null;

  const svg = svgRef.current;
  const pt = svg.createSVGPoint();
  pt.x = stall.position.x + 5;
  pt.y = stall.position.y;
  const screenPt = pt.matrixTransform(svg.getScreenCTM()!);
  const rect = svg.getBoundingClientRect();

  const left = screenPt.x - rect.left;
  const top = screenPt.y - rect.top - 60;

  return (
    <div
      className="absolute z-50 pointer-events-none bg-otto-charcoal border border-otto-gray/30 rounded-md px-3 py-2 shadow-lg"
      style={{ left, top, minWidth: 140 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-otto-white text-xs font-bold">{stall.id}</span>
        <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[stall.status] || ''}`}>
          {stall.status}
        </Badge>
      </div>
      <div className="text-otto-gray text-[10px]">{TYPE_LABELS[stall.type]}</div>
      {stall.vehicleId && (
        <div className="text-otto-teal text-[10px] mt-0.5">Vehicle: {stall.vehicleId}</div>
      )}
    </div>
  );
};
