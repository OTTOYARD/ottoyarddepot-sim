import { useVehicleStore } from '@/store/vehicleStore';
import { useSimulationStore } from '@/store/simulationStore';
import { Badge } from '@/components/ui/badge';

const TYPE_COLORS: Record<string, string> = {
  fleet: '#00B4A6',
  core: '#FFFFFF',
  concierge: '#C0C0C0',
  elite: '#FFD700',
};

interface Props {
  svgRef: React.RefObject<SVGSVGElement>;
}

export const VehicleTooltip = ({ svgRef }: Props) => {
  const hoveredVehicleId = useVehicleStore((s) => s.hoveredVehicleId);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const simTime = useSimulationStore((s) => s.simTime);

  if (!hoveredVehicleId || !svgRef.current) return null;

  const v = vehicles.find((veh) => veh.id === hoveredVehicleId);
  if (!v) return null;

  const svg = svgRef.current;
  const pt = svg.createSVGPoint();
  pt.x = v.position.x;
  pt.y = v.position.y;
  const screenPt = pt.matrixTransform(svg.getScreenCTM()!);
  const rect = svg.getBoundingClientRect();
  const left = screenPt.x - rect.left;
  const top = screenPt.y - rect.top - 90;

  const socColor = v.currentSoC < 20 ? '#C00000' : v.currentSoC < 50 ? '#F59E0B' : '#00B4A6';
  const remaining = v.serviceStartTime !== null && v.serviceDuration !== null
    ? Math.max(0, v.serviceDuration - (simTime - v.serviceStartTime))
    : null;
  const remainingMin = remaining !== null ? (remaining / 60).toFixed(1) : null;
  const completedServices = v.currentServiceIndex;
  const totalServices = v.serviceQueue.length;

  return (
    <div
      className="absolute z-50 pointer-events-none rounded-md px-3 py-2 shadow-lg border"
      style={{
        left,
        top,
        minWidth: 160,
        backgroundColor: '#2D2D2D',
        borderColor: 'rgba(255,255,255,0.15)',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: TYPE_COLORS[v.type] }}
        />
        <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>{v.id}</span>
        <Badge className="text-[10px] px-1.5 py-0" style={{ backgroundColor: TYPE_COLORS[v.type] + '33', color: TYPE_COLORS[v.type] }}>
          {v.type}
        </Badge>
      </div>

      {/* SoC bar */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px]" style={{ color: '#666666' }}>SoC</span>
        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: '#444' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${v.currentSoC}%`, backgroundColor: socColor }}
          />
        </div>
        <span className="text-[10px] font-mono" style={{ color: socColor }}>{Math.round(v.currentSoC)}%</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] capitalize" style={{ color: '#999' }}>{v.status}</span>
        {remainingMin && (
          <span className="text-[10px]" style={{ color: '#F59E0B' }}>{remainingMin}m left</span>
        )}
      </div>

      <div className="text-[10px] mt-0.5" style={{ color: '#666666' }}>
        Services: {completedServices}/{totalServices}
      </div>
    </div>
  );
};
