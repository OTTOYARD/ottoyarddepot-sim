import React from 'react';
import type { Vehicle } from '@/engine/types';
import { useVehicleStore } from '@/store/vehicleStore';

const VEHICLE_COLORS: Record<string, string> = {
  fleet: '#00B4A6',
  core: '#FFFFFF',
  concierge: '#C0C0C0',
  elite: '#FFD700',
};

const STROKE_COLORS: Record<string, string> = {
  fleet: '#008A7F',
  core: '#BBBBBB',
  concierge: '#909090',
  elite: '#CCA800',
};

// OEM platform palette — bright fills that read clearly over the dark depot
// zones (DCFC red / L2 teal / staging amber / wash blue).
const OEM_COLORS: Record<string, string> = {
  waymo: '#5B9BFF', // Waymo blue
  tesla: '#FF453A', // Tesla red
  zoox: '#B06BFF',  // Zoox violet
};
const OEM_STROKE: Record<string, string> = {
  waymo: '#2E6BD6',
  tesla: '#C32B22',
  zoox: '#7E3FCF',
};

function getRotation(v: Vehicle): number {
  // Prefer the kinematic model's true body heading (0 = +x/east). The SVG body
  // is drawn pointing "up", so rotation = heading + 90°.
  if (typeof v.heading === "number") {
    return (v.heading * 180) / Math.PI + 90;
  }
  if (v.targetPosition) {
    const dx = v.targetPosition.x - v.position.x;
    const dy = v.targetPosition.y - v.position.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      return (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    }
  }
  return 0;
}

interface Props {
  vehicle: Vehicle;
}

const VehicleDotInner = ({ vehicle: v }: Props) => {
  const setHoveredVehicle = useVehicleStore((s) => s.setHoveredVehicle);
  const oem = (v.oem || '').toLowerCase();
  const fill = OEM_COLORS[oem] || VEHICLE_COLORS[v.type] || '#87CEEB';
  const stroke = OEM_STROKE[oem] || STROKE_COLORS[v.type] || '#666666';
  const isLowOpacity = v.status === 'queued' || v.status === 'staging';
  const baseOpacity = v.status === 'approaching' ? 0.7 : v.status === 'departing' ? 0.5 : isLowOpacity ? 0.6 : 0.9;
  const rotation = getRotation(v);

  return (
    <g
      data-vid={v.id}
      // Position/rotation are driven IMPERATIVELY from the poseStore by a single
      // rAF in DepotSVG (see there) — never through React state — so 132 moving
      // dots don't re-render the tree each frame. This style is just the initial
      // mount placement; no CSS transition (the physics pose is already smooth).
      style={{
        transform: `translate(${v.position.x}px, ${v.position.y}px)`,
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHoveredVehicle(v.id)}
      onMouseLeave={() => setHoveredVehicle(null)}
    >
      {/* Charging glow ring */}
      {v.status === 'charging' && (
        <circle r={6} fill="none" stroke="#00B4A6" strokeWidth={0.5}>
          <animate attributeName="opacity" values="0.6;0.15;0.6" dur="2s" repeatCount="indefinite" />
          <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Washing ripple rings */}
      {v.status === 'washing' && (
        <>
          <circle r={4} fill="none" stroke="#2196F3" strokeWidth={0.3}>
            <animate attributeName="r" values="4;9;4" dur="2.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite" />
          </circle>
          <circle r={4} fill="none" stroke="#2196F3" strokeWidth={0.3}>
            <animate attributeName="r" values="4;9;4" dur="2.5s" begin="1.25s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" begin="1.25s" repeatCount="indefinite" />
          </circle>
        </>
      )}

      {/* Vehicle body — rotated rounded rect (rotation set imperatively too).
          FOOTPRINT IS LOAD-BEARING, not cosmetic. The plan is drawn to real
          dimensions at 1 unit = 0.4785 m (sitePlan.ts), and two opposing travel
          lanes sit 2 x rightOffset = 4.8 units apart (LaneGraph.ts). The old
          5.0-unit-wide body was WIDER than half that gap, so two cars passing in
          opposite directions overlapped by 0.2 units of body (0.6 with stroke) —
          negative clearance. That is the "they look like they're heading right
          for each other" artefact: the cars were tracking their lanes correctly
          and still colliding, because the paint was honest and the body was not.
          4.2 x 10.2 units = 2.01 m x 4.88 m — a real robotaxi footprint — and
          leaves 0.6 units (0.29 m) of daylight between passing bodies. */}
      <g data-body transform={`rotate(${rotation})`}>
        <rect
          x={-2.1}
          y={-5.1}
          width={4.2}
          height={10.2}
          rx={1.4}
          ry={1.4}
          fill={fill}
          stroke={stroke}
          strokeWidth={0.25}
          opacity={baseOpacity}
        >
          {v.status === 'charging' && (
            <animateTransform
              attributeName="transform"
              type="scale"
              values="1;1.1;1"
              dur="2s"
              repeatCount="indefinite"
            />
          )}
          {v.status === 'approaching' && (
            <animate attributeName="opacity" from="0" to={String(baseOpacity)} dur="0.3s" fill="freeze" />
          )}
        </rect>

        {/* Windshield detail */}
        <rect x={-1.5} y={-3} width={3} height={1.5} rx={0.5} fill={stroke} opacity={0.4} />

        {/* Charging bolt icon */}
        {v.status === 'charging' && (
          <polygon points="0.5,-1.5 -0.5,0.3 0.3,0.3 -0.5,2 0.5,-0.2 -0.3,-0.2" fill="#FFD700" opacity={0.9} />
        )}
      </g>

      {/* Queued clock icon */}
      {v.status === 'queued' && (
        <g transform="translate(3.5, -3.5)">
          <circle r={1.8} fill="#2D2D2D" stroke="#FFFFFF" strokeWidth={0.3} opacity={0.8} />
          <line x1={0} y1={0} x2={0} y2={-1} stroke="#FFFFFF" strokeWidth={0.3} opacity={0.8} />
          <line x1={0} y1={0} x2={0.8} y2={0} stroke="#FFFFFF" strokeWidth={0.3} opacity={0.8} />
        </g>
      )}
    </g>
  );
};

export const VehicleDot = React.memo(VehicleDotInner, (prev, next) => {
  const pv = prev.vehicle;
  const nv = next.vehicle;
  return (
    pv.id === nv.id &&
    pv.position.x === nv.position.x &&
    pv.position.y === nv.position.y &&
    pv.status === nv.status &&
    pv.currentSoC === nv.currentSoC &&
    pv.type === nv.type &&
    pv.oem === nv.oem &&
    pv.targetPosition?.x === nv.targetPosition?.x &&
    pv.targetPosition?.y === nv.targetPosition?.y
  );
});

VehicleDot.displayName = 'VehicleDot';
