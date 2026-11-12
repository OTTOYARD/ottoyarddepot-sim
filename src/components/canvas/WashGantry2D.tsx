import { useEffect, useMemo, useRef } from 'react';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { WASH_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { washPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { IDLE_WASH } from '@/lib/ottoWash/washSession';
import { WASH_GANTRY as G, WASH_HOME_DY } from '@/lib/ottoWash/washSpec';

/**
 * THE WASH BAYS' TOUCHLESS MACHINES ON THE 2D PLAN (docs/OTTO-WASH.md).
 *
 * Seen from above, as the 3D view draws them: each gantry's portal (its trolleys on the two
 * floor rails and the beam across), the spray arch, the air knives, the two sensor-wipe arms on
 * their cross rail with their pads on the car, the beacon and the stop light. No brush, and no
 * door opens (Chase, 2026-11-11). It reads the same session the 3D view draws
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
  soak: '#ffd9f0', jet: '#9fd2ff', rinse: '#d8f1ff',
};
const STOP_RED = '#ff3b30';
const STOP_GREEN = '#35d07f';

/** Half the portal's width across the bay, plan u: to the trolleys' outer faces. */
const PORTAL_HALF_X = G.legX + G.trolley.w / 2;

/**
 * Write one bay's machine onto its plan group: where the gantry stands along the bay, what the
 * arch sprays and the knives blow, the wipe arms across it with their pads, and the lights.
 */
export function paintWashGantry2D(g: SVGGElement, bayX: number, p: WashPose): void {
  const q = (k: string) => g.querySelector<SVGElement>(`[data-part="${k}"]`);
  q('gantry')?.setAttribute('transform', `translate(0 ${p.dy.toFixed(3)})`);
  const spray = q('spray');
  if (spray) {
    spray.setAttribute('visibility', p.spray === 'none' ? 'hidden' : 'visible');
    if (p.spray !== 'none') spray.setAttribute('fill', SPRAY_FILL[p.spray]);
  }
  q('air')?.setAttribute('visibility', p.air ? 'visible' : 'hidden');
  for (const [k, sgn] of [['knife-w', -1], ['knife-e', 1]] as const) {
    q(k)?.setAttribute('x', (bayX + sgn * (p.dryerSideX + G.dryer.side.w / 2) - G.dryer.side.w / 2).toFixed(3));
  }
  // the wipe arms: a carriage each side on the cross rail, and its pad. The pad shows amber on its way and green
  // while it is pressed on a sensor. Stowed, the pads sit faint at their parking place.
  const armsOut = p.station !== null;
  const padCy = (BAY_STALL_Y + G.wipe.dy + (p.padDy - p.dy - G.wipe.dy)).toFixed(3);
  for (const [k, sgn] of [['arm-w', -1], ['arm-e', 1]] as const) {
    q(k)?.setAttribute('x', (bayX + sgn * p.mastX - G.wipe.carriage.w / 2).toFixed(3));
    const pad = q(`${k}-pad`);
    pad?.setAttribute('cx', (bayX + sgn * p.padX).toFixed(3));
    pad?.setAttribute('cy', padCy);
    pad?.setAttribute('fill', p.wipeEngage > 0.5 ? '#35d07f' : '#ffb020');
    pad?.setAttribute('opacity', armsOut ? '0.95' : '0.3');
  }
  g.setAttribute('data-station', p.station ?? '');
  q('beacon')?.setAttribute('fill', STATUS_FILL[p.status]);
  q('stop')?.setAttribute('fill', p.stop ? STOP_RED : STOP_GREEN);
  g.setAttribute('data-phase', p.status);
}

function WashGantryBay2D({ bayId, bayX }: { bayId: string; bayX: number }) {
  const ref = useRef<SVGGElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const g = ref.current;
      if (g) paintWashGantry2D(g, bayX, washPoseAt(twinMotionDriver.washSessionAt(bayId) ?? IDLE_WASH));
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
        {/* the wipe arms' cross rail, each arm's carriage on it, and its soft pad */}
        <rect x={bayX - G.wipe.parkX - 0.5} y={y0 + G.wipe.dy - 0.09} width={2 * (G.wipe.parkX + 0.5)} height={0.18} fill="#9aa3ad" />
        {(['arm-w', 'arm-e'] as const).map((k, i) => (
          <g key={k}>
            <rect data-part={k} x={bayX + (i ? 1 : -1) * G.wipe.parkX - G.wipe.carriage.w / 2} y={y0 + G.wipe.dy - G.wipe.carriage.d / 2}
              width={G.wipe.carriage.w} height={G.wipe.carriage.d} fill="#3a3f48" rx={0.1} />
            <circle data-part={`${k}-pad`} cx={bayX + (i ? 1 : -1) * (G.wipe.parkX - G.wipe.forearm)} cy={y0 + G.wipe.dy} r={G.wipe.padR}
              fill="#ffb020" stroke="#ffffff" strokeWidth={0.06} opacity={0.3} />
          </g>
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
