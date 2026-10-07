// StackSwatch — a legend mark drawn in the shape and colour of the object it names on the OTTO-Q stack: an orb, a
// pill, a tile, a block, a car or a light. Colours come from stackLegend's HUE, the same table the 3D scene reads.
import { useId } from "react";
import { HUE, type Hue, type Shape } from "./stackLegend";

export function StackSwatch({ hue, shape, size = 10, className = "" }: { hue: Hue; shape: Shape; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const { fill, glow } = HUE[hue];
  const common = { className: `inline-block shrink-0 align-middle ${className}`, "aria-hidden": true } as const;
  if (shape === "orb") {
    return (
      <svg {...common} width={size} height={size} viewBox="0 0 10 10">
        <defs>
          <radialGradient id={`o${id}`} cx="38%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="35%" stopColor={glow} />
            <stop offset="100%" stopColor={fill} />
          </radialGradient>
        </defs>
        <circle cx="5" cy="5" r="4.2" fill={`url(#o${id})`} />
      </svg>
    );
  }
  if (shape === "pill") {
    const w = Math.round(size * 1.7);
    return (
      <svg {...common} width={w} height={size} viewBox="0 0 17 10">
        <rect x="0.5" y="2" width="16" height="6" rx="3" fill={fill} />
        <rect x="3.5" y="3.4" width="10" height="1.4" rx="0.7" fill={glow} opacity="0.95" />
      </svg>
    );
  }
  if (shape === "tile" || shape === "block") {
    return (
      <svg {...common} width={size} height={size} viewBox="0 0 10 10">
        <rect x="0.8" y="0.8" width="8.4" height="8.4" rx={shape === "tile" ? 2 : 0.9} fill={fill} />
        <rect x="2.6" y="2.6" width="4.8" height="4.8" rx={shape === "tile" ? 1.2 : 0.5} fill={glow} opacity="0.9" />
      </svg>
    );
  }
  if (shape === "car") {
    const w = Math.round(size * 1.5);
    return (
      <svg {...common} width={w} height={size} viewBox="0 0 15 10">
        <rect x="0.5" y="2" width="14" height="6.4" rx="2.4" fill={fill} />
        <rect x="4" y="3.6" width="7" height="3.2" rx="1.2" fill={glow} opacity="0.95" />
      </svg>
    );
  }
  // beam: a falling light with its trail
  return (
    <svg {...common} width={size} height={Math.round(size * 1.4)} viewBox="0 0 10 14">
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={glow} stopOpacity="0" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect x="4" y="0" width="2" height="10" rx="1" fill={`url(#b${id})`} />
      <circle cx="5" cy="10.5" r="2.6" fill="#ffffff" />
      <circle cx="5" cy="10.5" r="3.4" fill={glow} opacity="0.35" />
    </svg>
  );
}
