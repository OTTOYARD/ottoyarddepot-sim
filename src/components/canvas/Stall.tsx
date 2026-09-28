import { memo } from 'react';
import type { StallState } from '@/store/depotStore';
import { useDepotStore } from '@/store/depotStore';
import { towardFor, pedestalPlanPoint } from '@/lib/ottoChargeArm/depotPlacement';
import { CABINET_BACKSET_PU, L2_PEDESTAL_OFFSET_PU } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { chargerStallPaint } from '@/lib/sitePlan';

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
 * oriented the way the car lies, plus the charger it plugs into. (The generic
 * stall below is anchored at its top-left corner and skews by cos(angle), which put
 * every charger stall off its car as a slanted parallelogram — the 2D plan misstated
 * the charging layout.) Both types are perpendicular head-in, the car lying
 * east-west with its nose toward the canopy spine (sitePlan.chargingStalls): a DCFC
 * cabinet stands south of the car, beside it; an L2 post stands in front of its nose.
 */
function ChargerStall({ stall, fill, stroke }: { stall: StallState; fill: string; stroke: string }) {
  const { x, y, angle } = stall.position;
  const dc = stall.type === 'dcfc';
  const { w, h } = chargerStallPaint(dc ? 'dcfc' : 'l2', angle);
  // the cabinet, body plus pad, as structurePlan.cabinetFootprints lays it out
  const ped = dc ? pedestalPlanPoint(x, y) : null;
  const post = ped
    ? { x: ped.x - 0.9, y: ped.y + CABINET_BACKSET_PU - 0.6, w: 1.8, h: 1.2 }
    : { x: x + towardFor(x) * L2_PEDESTAL_OFFSET_PU - 0.6, y: y - 0.7, w: 1.2, h: 1.4 };
  return (
    <>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={0.5} opacity={0.9} rx={0.6} />
      <rect x={post.x} y={post.y} width={post.w} height={post.h} fill="#d4d8dd" opacity={0.85} rx={0.2} />
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
