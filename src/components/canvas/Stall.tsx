import { memo } from 'react';
import type { StallState } from '@/store/depotStore';
import { useDepotStore } from '@/store/depotStore';
import { towardFor, PEDESTAL_OFFSET_PU } from '@/lib/ottoChargeArm/depotPlacement';
import { CABINET_BACKSET_PU, L2_PEDESTAL_OFFSET_PU } from '@/lib/ottoChargeArm/cabinetEnvelope';

const TYPE_COLORS: Record<string, string> = {
  dcfc: '#C00000',
  l2: '#00B4A6',
  wash: '#2196F3',
  staging: '#F59E0B',
};

function getStallFill(type: string, status: string): string {
  const base = TYPE_COLORS[type] || '#666';
  switch (status) {
    case 'available': return `${base}26`; // 15%
    case 'occupied': return `${base}80`; // 50%
    case 'charging': return `${base}CC`; // 80%
    case 'servicing': return '#2196F399'; // blue 60%
    case 'offline': return 'url(#crosshatch)';
    case 'reserved': return 'transparent';
    default: return `${base}26`;
  }
}

function getStallStroke(type: string, status: string): string {
  if (status === 'reserved') return '#F59E0B';
  if (status === 'offline') return '#C00000';
  return TYPE_COLORS[type] || '#666';
}

interface StallProps {
  stall: StallState;
}

function getParallelogramPoints(w: number, h: number, angleDeg: number): string {
  const skew = h * Math.cos((angleDeg * Math.PI) / 180);
  // bottom-left, bottom-right, top-right, top-left
  return `0,${h} ${w},${h} ${w + skew},0 ${skew},0`;
}

/**
 * A CHARGER stall, drawn where it is: a footprint centred on the parked car and
 * oriented the way the car lies, plus the charger post it plugs into. (The generic
 * stall below is anchored at its top-left corner and skews by cos(angle), which put
 * every charger stall off its car as a slanted parallelogram — the 2D plan misstated
 * the charging layout.) DCFC: pull-alongside, the car lies north-south with its
 * cabinet beside it. L2: perpendicular head-in, the car lies east-west, nose to the
 * post on the canopy spine (sitePlan.chargingStalls).
 */
function ChargerStall({ stall, fill, stroke }: { stall: StallState; fill: string; stroke: string }) {
  const { x, y, angle } = stall.position;
  const dc = stall.type === 'dcfc';
  const alongX = angle === 90 || angle === 270;
  // stall = the 10.2 x 4.2 car with room round it; DCFC pitches 16u, L2 10.6/11u
  const len = 12.4, wid = dc ? 7.2 : 6.6;
  const w = alongX ? len : wid, h = alongX ? wid : len;
  const toward = towardFor(x);
  const postX = x + toward * (dc ? PEDESTAL_OFFSET_PU + CABINET_BACKSET_PU : L2_PEDESTAL_OFFSET_PU);
  return (
    <>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={0.5} opacity={0.9} rx={0.6} />
      <rect x={postX - 0.6} y={y - (dc ? 0.9 : 0.7)} width={1.2} height={dc ? 1.8 : 1.4} fill="#d4d8dd" opacity={0.85} rx={0.2} />
      <text x={x} y={y + 1} textAnchor="middle" fontSize={3} fill="#ffffff" opacity={0.7} pointerEvents="none">
        {stall.id.split('-')[1]}
      </text>
    </>
  );
}

export const Stall = memo(({ stall }: StallProps) => {
  const selectStall = useDepotStore((s) => s.selectStall);
  const setHoveredStall = useDepotStore((s) => s.setHoveredStall);
  const isCharger = stall.type === 'dcfc' || stall.type === 'l2';

  const isWash = stall.type === 'wash';
  const w = isWash ? 12 : stall.type === 'dcfc' ? 10 : 8;
  const h = isWash ? 14 : 16;
  const angleDeg = stall.position.angle;

  const points = angleDeg === 0
    ? `0,0 ${w},0 ${w},${h} 0,${h}`
    : getParallelogramPoints(w, h, angleDeg);

  const fill = getStallFill(stall.type, stall.status);
  const stroke = getStallStroke(stall.type, stall.status);
  const isCharging = stall.status === 'charging';

  if (isCharger) {
    return (
      <g
        className={`cursor-pointer ${isCharging ? 'stall-charging-pulse' : ''}`}
        onClick={(e) => { e.stopPropagation(); selectStall(stall.id); }}
        onMouseEnter={() => setHoveredStall(stall.id)}
        onMouseLeave={() => setHoveredStall(null)}
      >
        <ChargerStall stall={stall} fill={fill} stroke={stroke} />
      </g>
    );
  }

  return (
    <g
      transform={`translate(${stall.position.x}, ${stall.position.y})`}
      className={`cursor-pointer ${isCharging ? 'stall-charging-pulse' : ''}`}
      onClick={(e) => { e.stopPropagation(); selectStall(stall.id); }}
      onMouseEnter={() => setHoveredStall(stall.id)}
      onMouseLeave={() => setHoveredStall(null)}
    >
      <polygon
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth={0.5}
        opacity={0.9}
      />
      <text
        x={w / 2 + (angleDeg ? h * Math.cos((angleDeg * Math.PI) / 180) / 2 : 0)}
        y={h / 2 + 1}
        textAnchor="middle"
        fontSize={3}
        fill="#ffffff"
        opacity={0.7}
        pointerEvents="none"
      >
        {stall.id.split('-')[1]}
      </text>
    </g>
  );
});

Stall.displayName = 'Stall';
