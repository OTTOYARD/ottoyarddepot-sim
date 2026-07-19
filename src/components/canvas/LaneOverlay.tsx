// ============================================================================
// LaneOverlay (2D) — RAILS P2. Paints the depot's right-of-way from the SAME
// directed LaneGraph the cars route on, so what you SEE is what they DRIVE.
//
// Legend:
//   • dashed amber centre stripe  = two-way divided road (opposing streams are
//     offset to their own side; cars pass BESIDE each other, never head-on)
//   • teal chevrons               = one-way lane (charging gaps run NORTHBOUND;
//     the rear apron runs EASTBOUND out of the pull-through bays)
//   • grey chevrons               = travel direction on a two-way side
//   • white stop bars             = lane mouths where a one-way lane meets a
//     collector — the yield point
// Rendered UNDER the vehicles so cars always read on top.
// ============================================================================
import { useMemo } from "react";
import { buildDepotLanes } from "@/engine/motion/LaneGraph";
import { paintLanes, LANE_PAINT_WIDTH } from "@/engine/motion/lanePaint";

const ROAD = "#11161f";        // asphalt band
const STRIPE = "#F5B942";      // two-way divider (amber)
const ONEWAY = "#2BD9C4";      // one-way direction (teal)
const TWOWAY_ARROW = "#7A8699"; // two-way direction (muted)
const STOPBAR = "#E7EAF0";

function polyline(pts: { x: number; y: number }[]) {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

export const LaneOverlay = ({ show = true }: { show?: boolean }) => {
  // graph + paint are static geometry — build once
  const paint = useMemo(() => paintLanes(buildDepotLanes()), []);
  if (!show) return null;
  const half = LANE_PAINT_WIDTH / 2;

  return (
    <g className="lane-overlay" pointerEvents="none">
      {/* 1. asphalt: every drivable lane, drawn wide + soft */}
      <g opacity={0.55}>
        {paint.lanes.map((l) => (
          <polyline
            key={`road-${l.id}`}
            points={polyline(l.driveLine)}
            fill="none"
            stroke={ROAD}
            strokeWidth={LANE_PAINT_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>

      {/* 2. two-way divider: one dashed stripe per road pair */}
      <g opacity={0.5}>
        {paint.stripes.map((s, i) => (
          <polyline
            key={`stripe-${i}`}
            points={polyline(s.pts)}
            fill="none"
            stroke={STRIPE}
            strokeWidth={0.35}
            strokeDasharray="3 3"
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* 3. one-way lane tint — makes the northbound gaps + rear apron obvious */}
      <g opacity={0.16}>
        {paint.lanes.filter((l) => l.oneWay && l.kind !== "gate").map((l) => (
          <polyline
            key={`ow-${l.id}`}
            points={polyline(l.driveLine)}
            fill="none"
            stroke={ONEWAY}
            strokeWidth={LANE_PAINT_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>

      {/* 4. travel-direction chevrons, painted IN the lane a car drives */}
      <g>
        {paint.arrows.map((a, i) => (
          <path
            key={`arw-${i}`}
            d="M -1.5 -1.5 L 1.6 0 L -1.5 1.5"
            fill="none"
            stroke={a.oneWay ? ONEWAY : TWOWAY_ARROW}
            strokeWidth={a.oneWay ? 0.62 : 0.42}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={a.oneWay ? 0.9 : 0.55}
            transform={`translate(${a.x.toFixed(2)} ${a.y.toFixed(2)}) rotate(${((a.angle * 180) / Math.PI).toFixed(1)})`}
          />
        ))}
      </g>

      {/* 5. stop bars at one-way mouths (the yield point) */}
      <g opacity={0.8}>
        {paint.stopBars.map((b, i) => (
          <line
            key={`stop-${i}`}
            x1={-half} y1={0} x2={half} y2={0}
            stroke={STOPBAR}
            strokeWidth={0.7}
            strokeLinecap="butt"
            transform={`translate(${b.x.toFixed(2)} ${b.y.toFixed(2)}) rotate(${(((b.angle * 180) / Math.PI) + 90).toFixed(1)})`}
          />
        ))}
      </g>
    </g>
  );
};
