import { memo } from 'react';
import type { StallState } from '@/store/depotStore';
import { useDepotStore } from '@/store/depotStore';
import { chargerPad } from '@/lib/ottoChargeArm/depotPlacement';
import { chargerStallPaint, chargerStallFrame } from '@/lib/sitePlan';
import { downTag } from '@/lib/chargerFaults';

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
 * turned the way the car lies, plus the charger it plugs into. (The generic stall
 * below is anchored at its top-left corner and skews by cos(angle), which put every
 * charger stall off its car as a slanted parallelogram — the 2D plan misstated the
 * charging layout.) Every charger stall is ANGLED 60° to its lane, the car pointing
 * north-east or north-west toward the canopy spine (sitePlan.chargingStalls); its
 * cabinet stands on the car's south-side flank — abeam its centre for a DCFC (the
 * OTTO-CHARGE ARM's pedestal), beside its front quarter for an L2 post — exactly
 * where depotPlacement.chargerCabinet puts it for the 3D field and the solids.
 */
function ChargerStall({ stall, fill, stroke }: { stall: StallState; fill: string; stroke: string }) {
  const { x, y, angle } = stall.position;
  const dc = stall.type === 'dcfc';
  const { len, wid } = chargerStallPaint(dc ? 'dcfc' : 'l2');
  // SVG's rotate() turns +x toward +y, and the plan's y runs south, so a plan
  // heading in degrees is exactly the SVG rotation that lays +x along the car.
  const deg = (chargerStallFrame(angle).heading * 180) / Math.PI;
  // the charger on its pad (a DCFC's carries its arm too), as structurePlan.cabinetFootprints lays it out
  const pad = chargerPad(dc ? 'dcfc' : 'l2', x, y, angle);
  const cw = pad.hl * 2, cd = pad.hw * 2;
  const cab = { x: pad.cx, y: pad.cy };
  const cabDeg = (pad.th * 180) / Math.PI;
  const fault = stall.down?.kind === 'fault';
  return (
    <>
      <rect x={-len / 2} y={-wid / 2} width={len} height={wid} transform={`translate(${x} ${y}) rotate(${deg})`}
        fill={fill} stroke={stroke} strokeWidth={fault ? 0.8 : 0.5} opacity={0.9} rx={0.6} />
      <rect x={-cw / 2} y={-cd / 2} width={cw} height={cd} transform={`translate(${cab.x} ${cab.y}) rotate(${cabDeg})`}
        fill={fault ? '#ff5a5a' : '#d4d8dd'} opacity={0.85} rx={0.2} />
      {fault && <FaultMark x={x} y={y - 0.9} tag={downTag(stall.down!)} />}
      <text x={x} y={fault ? y + 3.6 : y + 1} textAnchor="middle" fontSize={3} fill="#ffffff" pointerEvents="none">
        {stall.id.split('-')[1]}
      </text>
    </>
  );
}

/**
 * THE FAULT MARK on a charger stall (Chase, 2026-10-07: the charger must read as "down
 * due to a fault"): a warning triangle and the word, upright over the stall whatever
 * its bearing, so it reads in shape and in words, not by the red alone. The stall
 * number moves under it. Drawn only where the twin says the charger is Faulted
 * (stall.down.kind 'fault'); a stall offline for another reason keeps the plain
 * crosshatch. The tooltip and the "chargers down" chip carry the reason and the time.
 */
function FaultMark({ x, y, tag }: { x: number; y: number; tag: string }) {
  const h = 3.8, tri = 2.7, pad = 0.55, gap = 0.45, font = 2.35;
  const textW = tag.length * font * 0.68;
  const w = pad + tri + gap + textW + pad;
  const left = x - w / 2;
  const tx = left + pad; // the triangle's left corner
  const ty = y + tri * 0.43; // its base line
  return (
    <g pointerEvents="none" data-testid="stall-fault-mark">
      <rect x={left} y={y - h / 2} width={w} height={h} rx={0.9} fill="#C00000" stroke="#ffffff" strokeWidth={0.28} />
      <path d={`M${tx} ${ty} L${tx + tri / 2} ${ty - tri * 0.87} L${tx + tri} ${ty} Z`} fill="#ffffff" />
      <rect x={tx + tri / 2 - 0.17} y={ty - tri * 0.62} width={0.34} height={tri * 0.34} rx={0.1} fill="#C00000" />
      <circle cx={tx + tri / 2} cy={ty - tri * 0.14} r={0.2} fill="#C00000" />
      <text x={tx + tri + gap} y={y + font * 0.36} fontSize={font} fontWeight="bold" fill="#ffffff" letterSpacing={0.12}>
        {tag}
      </text>
    </g>
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
