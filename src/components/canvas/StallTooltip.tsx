import { useDepotStore, type StallState } from '@/store/depotStore';
import { useTwinStore } from '@/store/twinStore';
import { Badge } from '@/components/ui/badge';
import { downText, NO_CARS_SENT, stallBadge } from '@/lib/chargerFaults';

const TYPE_LABELS: Record<string, string> = {
  dcfc: 'DCFC',
  l2: 'L2',
  wash: 'Wash Bay',
  staging: 'Staging',
  service: 'Service Bay',
};

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-otto-teal/20 text-otto-teal',
  occupied: 'bg-otto-amber/20 text-otto-amber',
  charging: 'bg-otto-teal/30 text-otto-teal',
  servicing: 'bg-blue-500/20 text-blue-400',
  offline: 'bg-otto-red/20 text-otto-red',
  fault: 'bg-otto-red text-white',
  reserved: 'bg-otto-amber/20 text-otto-amber',
};

/**
 * Why a stall is out of use, when the twin says so: "Charger fault: communication dropout. Back about 11:07 AM sim."
 * and what OTTO-Q does about it. Shared by the hover tooltip and the click card.
 */
export const StallDownNote = ({ stall }: { stall: Pick<StallState, 'down'> }) => {
  const simClock = useTwinStore((s) => s.snapshot?.run?.sim_clock ?? null);
  if (!stall.down) return null;
  return (
    <div className="mt-1 text-[10px] leading-snug" data-testid="stall-down-note">
      <div className="font-semibold text-red-300">{downText(stall.down, simClock)}</div>
      <div className="text-white/80">{NO_CARS_SENT}</div>
    </div>
  );
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

  const TOOLTIP_W = 160;
  const TOOLTIP_H = stall.down ? 100 : 65;
  const PADDING = 8;

  let left = screenPt.x - rect.left;
  let top = screenPt.y - rect.top - TOOLTIP_H;

  // Clamp within SVG container bounds
  if (left + TOOLTIP_W > rect.width - PADDING) left = rect.width - TOOLTIP_W - PADDING;
  if (left < PADDING) left = PADDING;
  if (top < PADDING) top = screenPt.y - rect.top + 10; // flip below if above clips
  if (top + TOOLTIP_H > rect.height - PADDING) top = rect.height - TOOLTIP_H - PADDING;

  const badge = stallBadge(stall);
  return (
    <div
      className="absolute z-50 pointer-events-none bg-otto-charcoal border border-otto-gray/30 rounded-md px-3 py-2 shadow-lg"
      style={{ left, top, minWidth: TOOLTIP_W, maxWidth: stall.down ? 230 : undefined }}
      data-testid="stall-tooltip"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-otto-white text-xs font-bold">{stall.id}</span>
        <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[badge] || ''}`}>
          {badge}
        </Badge>
      </div>
      <div className="text-white text-[10px]">{TYPE_LABELS[stall.type]}</div>
      {stall.vehicleId && (
        <div className="text-otto-teal text-[10px] mt-0.5">Car: {stall.vehicleId}</div>
      )}
      <StallDownNote stall={stall} />
    </div>
  );
};
