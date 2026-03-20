import { memo } from 'react';
import type { StallState } from '@/store/depotStore';
import { useDepotStore } from '@/store/depotStore';

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

export const Stall = memo(({ stall }: StallProps) => {
  const selectStall = useDepotStore((s) => s.selectStall);
  const setHoveredStall = useDepotStore((s) => s.setHoveredStall);

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
