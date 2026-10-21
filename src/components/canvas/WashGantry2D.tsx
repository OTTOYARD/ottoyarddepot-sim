import { useEffect, useMemo, useRef } from 'react';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { WASH_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { washPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { IDLE_WASH } from '@/lib/ottoWash/washSession';
import { BRUSH_SPIN_RAD_S, WASH_GANTRY as G, WASH_HOME_DY } from '@/lib/ottoWash/washSpec';

/**
 * THE WASH BAYS' ROLLOVER MACHINES ON THE 2D PLAN (docs/OTTO-WASH.md).
 *
 * Seen from above, as the 3D view draws them: each gantry's portal (its trolleys on the two
 * floor rails and the beam across), the spray arch, the top brush, the two side brushes closing
 * in on the car and turning, the air knives, the two vacuum wands of a detail seat, the beacon
 * and the stop light. It reads the same session the 3D view draws
 * (TwinMotionDriver.washSessionAt) through the same pose (washPoseAt), so the plan and the 3D
 * view show the machine in the same place doing the same thing.
 *
 * Drawn over the cars, as a machine over a car is from above: the portal is an open frame, so the
 * car under it still shows. Driven imperatively once a frame, like the cars' dots: a React render
 * a frame for three machines would be waste. Clicks go through to the stalls and cars.
 */
export const STATUS_FILL: Record<WashPose['status'], string> = {
  home: '#00e5ff', working: '#35d07f', moving: '#ffb020', finishing: '#ffb020',
};
/** The 3D view's spray colours (WashGantry.tsx SPRAY_COLOR). */
export const SPRAY_FILL: Record<Exclude<WashPose['spray'], 'none'>, string> = {
  soak: '#ffd9f0', foam: '#9fd2ff', rinse: '#d8f1ff',
};
const STOP_RED = '#ff3b30';
const STOP_GREEN = '#35d07f';

/** Half the portal's width across the bay, plan u: to the trolleys' outer faces. */
const PORTAL_HALF_X = G.legX + G.trolley.w / 2;

/**
 * Write one bay's machine onto its plan group: where the gantry stands along the bay, the side
 * brushes across it, what the arch sprays and the knives blow, the wands, and the lights.
 * `spinDeg` turns the side brushes' bristle marks while they spin.
 */
export function paintWashGantry2D(g: SVGGElement, bayX: number, p: WashPose, spinDeg = 0): void {
  const q = (k: string) => g.querySelector<SVGElement>(`[data-part="${k}"]`);
  q('gantry')?.setAttribute('transform', `translate(0 ${p.dy.toFixed(3)})`);
  const y = BAY_STALL_Y + G.sideBrush.dy;
  // west is plan -x (the 3D view's blue brush), east plan +x (red); they turn opposite ways
  for (const [k, sgn] of [['brush-w', -1], ['brush-e', 1]] as const) {
    const cx = (bayX + sgn * p.sideBrushX).toFixed(3);
    const b = q(k);
    b?.setAttribute('cx', cx);
    q(`${k}-marks`)?.setAttribute('cx', cx);
    q(`${k}-marks`)?.setAttribute('transform', `rotate(${(-sgn * spinDeg).toFixed(1)} ${cx} ${y})`);
  }
  q('top-brush')?.setAttribute('opacity', (0.35 + 0.55 * p.brushEngage).toFixed(2));
  const spray = q('spray');
  if (spray) {
    spray.setAttribute('visibility', p.spray === 'none' ? 'hidden' : 'visible');
    if (p.spray !== 'none') spray.setAttribute('fill', SPRAY_FILL[p.spray]);
  }
  q('air')?.setAttribute('visibility', p.air ? 'visible' : 'hidden');
  for (const [k, sgn] of [['knife-w', -1], ['knife-e', 1]] as const) {
    q(k)?.setAttribute('x', (bayX + sgn * (p.dryerSideX + G.dryer.side.w / 2) - G.dryer.side.w / 2).toFixed(3));
  }
  // the wands: seen from above only while down in the car's doorway, reaching in toward the cabin
  const tip = G.wand.x + (G.wand.reachX - G.wand.x) * p.wandReach;
  const wandsShow = p.wandDrop > 0.02 ? 'visible' : 'hidden';
  for (const [k, sgn] of [['wand-w', -1], ['wand-e', 1]] as const) {
    const w = q(k);
    if (!w) continue;
    w.setAttribute('visibility', wandsShow);
    w.setAttribute('x1', (bayX + sgn * G.wand.x).toFixed(3));
    w.setAttribute('x2', (bayX + sgn * tip).toFixed(3));
    q(`${k}-head`)?.setAttribute('visibility', wandsShow);
    q(`${k}-head`)?.setAttribute('cx', (bayX + sgn * tip).toFixed(3));
  }
  q('beacon')?.setAttribute('fill', STATUS_FILL[p.status]);
  q('stop')?.setAttribute('fill', p.stop ? STOP_RED : STOP_GREEN);
  g.setAttribute('data-phase', p.status);
}

function WashGantryBay2D({ bayId, bayX }: { bayId: string; bayX: number }) {
  const ref = useRef<SVGGElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let spin = 0;
    const step = (now: number) => {
      const g = ref.current;
      if (g) {
        const p = washPoseAt(twinMotionDriver.washSessionAt(bayId) ?? IDLE_WASH);
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        if (p.spinning) spin = (spin + dt * BRUSH_SPIN_RAD_S * (180 / Math.PI)) % 360;
        paintWashGantry2D(g, bayX, p, spin);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [bayId, bayX]);

  const y0 = BAY_STALL_Y;
  const yellow = '#f0b90b';
  return (
    <g ref={ref} data-wash-gantry={bayId}>
      {/* the two floor rails: fixed, the machine rides them */}
      {[-1, 1].map((sgn) => (
        <line key={sgn} x1={bayX + sgn * G.legX} y1={y0 + G.rail.from} x2={bayX + sgn * G.legX} y2={y0 + G.rail.to}
          stroke="#8a93a3" strokeWidth={G.rail.w} opacity={0.8} />
      ))}
      <g data-part="gantry" transform={`translate(0 ${WASH_HOME_DY})`}>
        {/* the portal: an open frame, so the car under it shows */}
        <rect x={bayX - PORTAL_HALF_X} y={y0 + G.beam.dy0} width={2 * PORTAL_HALF_X} height={G.beam.dy1 - G.beam.dy0}
          fill={yellow} opacity={0.1} />
        {[G.beam.dy0, G.beam.dy1].map((dy) => (
          <rect key={dy} x={bayX - PORTAL_HALF_X} y={y0 + dy - 0.2} width={2 * PORTAL_HALF_X} height={0.4} fill={yellow} />
        ))}
        {/* each rail's trolley, and the yellow leg standing on it */}
        {[-1, 1].map((sgn) => (
          <g key={sgn}>
            <rect x={bayX + sgn * G.legX - G.trolley.w / 2} y={y0 + G.leg.dy - G.trolley.d / 2}
              width={G.trolley.w} height={G.trolley.d} fill="#3a3f48" rx={0.15} />
            <rect x={bayX + sgn * G.legX - G.leg.w / 2} y={y0 + G.leg.dy - G.leg.d / 2}
              width={G.leg.w} height={G.leg.d} fill={yellow} />
          </g>
        ))}
        {/* the spray arch, and its spray while it runs */}
        <rect x={bayX - G.arch.x} y={y0 + G.arch.dy - 0.15} width={2 * G.arch.x} height={0.3} fill="#9aa3ad" />
        <rect data-part="spray" x={bayX - G.arch.x} y={y0 + G.arch.dy - 0.9} width={2 * G.arch.x} height={1.8}
          fill={SPRAY_FILL.soak} opacity={0.6} visibility="hidden" rx={0.4} />
        {/* the top brush: faint up in the beam, solid on the car */}
        <rect data-part="top-brush" x={bayX - G.topBrush.halfLen} y={y0 + G.topBrush.dy - G.topBrush.r}
          width={2 * G.topBrush.halfLen} height={2 * G.topBrush.r} fill="#2a6fd6" opacity={0.35} rx={G.topBrush.r} />
        {/* the side brushes, with bristle marks that turn while they spin */}
        <circle data-part="brush-w" cx={bayX - G.sideBrush.retractX} cy={y0 + G.sideBrush.dy} r={G.sideBrush.r} fill="#2a6fd6" />
        <circle data-part="brush-e" cx={bayX + G.sideBrush.retractX} cy={y0 + G.sideBrush.dy} r={G.sideBrush.r} fill="#c8313f" />
        {(['brush-w', 'brush-e'] as const).map((k, i) => (
          <circle key={k} data-part={`${k}-marks`} cx={bayX + (i ? 1 : -1) * G.sideBrush.retractX} cy={y0 + G.sideBrush.dy}
            r={G.sideBrush.r * 0.72} fill="none" stroke="#ffffff" strokeWidth={0.18} strokeDasharray="0.5 0.42" opacity={0.75} />
        ))}
        {/* the air knives, and their blast while they blow */}
        <rect data-part="air" x={bayX - G.dryer.top.halfLen - 0.6} y={y0 + G.dryer.dy - 0.8}
          width={2 * G.dryer.top.halfLen + 1.2} height={1.6} fill="#eef6ff" opacity={0.45} visibility="hidden" rx={0.4} />
        <rect x={bayX - G.dryer.top.halfLen} y={y0 + G.dryer.dy - G.dryer.top.d / 2} width={2 * G.dryer.top.halfLen}
          height={G.dryer.top.d} fill="#5d6673" />
        {(['knife-w', 'knife-e'] as const).map((k, i) => (
          <rect key={k} data-part={k}
            x={bayX + (i ? 1 : -1) * (G.dryer.side.retractX + G.dryer.side.w / 2) - G.dryer.side.w / 2}
            y={y0 + G.dryer.dy - G.dryer.side.d / 2} width={G.dryer.side.w} height={G.dryer.side.d} fill="#5d6673" />
        ))}
        {/* a detail seat's vacuum wands, in through the doors */}
        {(['wand-w', 'wand-e'] as const).map((k, i) => (
          <g key={k}>
            <line data-part={k} x1={bayX + (i ? 1 : -1) * G.wand.x} y1={y0 + G.wand.dy} x2={bayX + (i ? 1 : -1) * G.wand.x}
              y2={y0 + G.wand.dy} stroke="#d0d6de" strokeWidth={2 * G.wand.r + 0.1} strokeLinecap="round" visibility="hidden" />
            <circle data-part={`${k}-head`} cx={bayX + (i ? 1 : -1) * G.wand.x} cy={y0 + G.wand.dy} r={0.32} fill="#ffb020"
              visibility="hidden" />
          </g>
        ))}
        {/* the beacon (the 3D view's, east of the beam) and the stop light on the beam's south face */}
        <circle data-part="beacon" cx={bayX + 3.6} cy={y0 + G.dryer.dy} r={0.45} fill={STATUS_FILL.home} />
        <circle data-part="stop" cx={bayX} cy={y0 + G.beam.dy1 + 0.45} r={0.4} fill={STOP_GREEN} />
      </g>
    </g>
  );
}

/** One machine per wash bay the depot has (the 3D view's count). */
export function WashGantries2D({ count }: { count: number }) {
  const bays = useMemo(() => WASH_SHELL.bays.slice(0, Math.max(0, count)), [count]);
  return (
    <g aria-label="Wash machines" pointerEvents="none">
      {bays.map((b) => <WashGantryBay2D key={b.id} bayId={b.id} bayX={b.x} />)}
    </g>
  );
}
