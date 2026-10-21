import React, { useMemo } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { CANOPIES, canopyKind } from '@/lib/sitePlan';

/** Plan x over the middle of the canopies a charger kind has in the build being drawn
 *  (DepotSVG labels the same run there), or null when the build has none of that kind. */
const runX = (kind: 'dcfc' | 'l2'): number | null => {
  const run = CANOPIES.filter((c) => canopyKind(c) === kind);
  return run.length ? (run[0].cx + run[run.length - 1].cx) / 2 : null;
};

const ZoneBadgesInner = () => {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const stalls = useDepotStore((s) => s.stalls);

  const counts = useMemo(() => {
    const dcfcOccupied = vehicles.filter((v) => v.assignedStall?.startsWith('DCFC')).length;
    const l2Occupied = vehicles.filter((v) => v.assignedStall?.startsWith('L2')).length;
    const washOccupied = vehicles.filter((v) => v.assignedStall?.startsWith('WASH')).length;
    const stagingOccupied = vehicles.filter((v) => v.assignedStall?.startsWith('STAGE')).length;

    const dcfcTotal = stalls.filter((s) => s.type === 'dcfc').length;
    const l2Total = stalls.filter((s) => s.type === 'l2').length;
    const washTotal = stalls.filter((s) => s.type === 'wash').length;
    const stagingTotal = stalls.filter((s) => s.type === 'staging').length;

    // the stalls are regenerated on a change of charger build, so the runs are read with them
    const dcfcX = dcfcTotal ? runX('dcfc') : null;
    const l2X = l2Total ? runX('l2') : null;
    return { dcfcOccupied, l2Occupied, washOccupied, stagingOccupied, dcfcTotal, l2Total, washTotal, stagingTotal, dcfcX, l2X };
  }, [vehicles, stalls]);

  return (
    <>
      {/* positions follow the v2 site plan zones; a charger kind's badge sits over its canopies, and a build with
          none of a kind (the 30-post build has no L2) draws no badge for it */}
      {counts.dcfcX != null && <Badge x={counts.dcfcX} y={73} label={`${counts.dcfcOccupied}/${counts.dcfcTotal}`} bg="#C00000" />}
      {counts.l2X != null && <Badge x={counts.l2X} y={73} label={`${counts.l2Occupied}/${counts.l2Total}`} bg="#00B4A6" />}
      <Badge x={186} y={23} label={`${counts.washOccupied}/${counts.washTotal}`} bg="#2196F3" />
      <Badge x={150} y={188} label={`${counts.stagingOccupied}/${counts.stagingTotal}`} bg="#F59E0B" />
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
