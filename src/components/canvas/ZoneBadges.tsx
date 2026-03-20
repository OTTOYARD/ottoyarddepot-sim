import React, { useMemo } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';

const ZoneBadgesInner = () => {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const stalls = useDepotStore((s) => s.stalls);

  const counts = useMemo(() => {
    const dcfcOccupied = vehicles.filter((v) => v.assignedStall?.startsWith('DCFC')).length;
    const l2Occupied = vehicles.filter((v) => v.assignedStall?.startsWith('L2')).length;
    const washOccupied = vehicles.filter((v) => v.assignedStall?.startsWith('WASH')).length;
    const stagingOccupied = vehicles.filter((v) => v.assignedStall?.startsWith('STAGE')).length;
    const queued = vehicles.filter((v) => v.status === 'queued').length;

    const dcfcTotal = stalls.filter((s) => s.type === 'dcfc').length;
    const l2Total = stalls.filter((s) => s.type === 'l2').length;
    const washTotal = stalls.filter((s) => s.type === 'wash').length;
    const stagingTotal = stalls.filter((s) => s.type === 'staging').length;

    return { dcfcOccupied, l2Occupied, washOccupied, stagingOccupied, queued, dcfcTotal, l2Total, washTotal, stagingTotal };
  }, [vehicles, stalls]);

  return (
    <>
      <Badge x={185} y={48} label={`${counts.dcfcOccupied}/${counts.dcfcTotal}`} bg="#C00000" />
      <Badge x={210} y={78} label={`${counts.l2Occupied}/${counts.l2Total}`} bg="#00B4A6" />
      <Badge x={240} y={26} label={`${counts.washOccupied}/${counts.washTotal}`} bg="#2196F3" />
      <Badge x={185} y={165} label={`${counts.stagingOccupied}/${counts.stagingTotal}`} bg="#F59E0B" />
      <Badge x={150} y={197} label={String(counts.queued)} bg="#FFFFFF" textColor="#1A1A2E" />
    </>
  );
};

function Badge({ x, y, label, bg, textColor = '#FFFFFF' }: { x: number; y: number; label: string; bg: string; textColor?: string }) {
  const width = Math.max(14, label.length * 4 + 6);
  return (
    <g>
      <rect x={x - width / 2} y={y - 4} width={width} height={8} rx={3} fill={bg} opacity={0.85} />
      <text x={x} y={y + 1.5} textAnchor="middle" fontSize={4} fill={textColor} fontWeight="bold" fontFamily="monospace">
        {label}
      </text>
    </g>
  );
}

export const ZoneBadges = React.memo(ZoneBadgesInner);
ZoneBadges.displayName = 'ZoneBadges';
