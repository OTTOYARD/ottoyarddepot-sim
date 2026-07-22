// ============================================================================
// ReservationGlow — on-canvas overlay that lights up the stalls OTTO-Q has
// RESERVED, straight from the live appointment seam (appointmentStore, fed by
// the RPC `ottoq_twin_appointments`). The hero case is a stall held EMPTY for a
// vehicle still en route ("held for a reason, not waste"): a gently pulsing ring
// in the OTTOYARD accent red. Reserved-and-occupied / staging holds get a
// calmer, desaturated ring so the held-for-inbound stalls stand out.
//
// HONEST: renders ONLY stalls present in the live reservation data — nothing
// when there is no active run or nothing is reserved (never a fabricated glow).
//
// Stall matching mirrors TwinMotionDriver.setTwinStallMap so the glow can never
// drift from where OTTO-Q actually parks cars: a reservation's stall_type → the
// renderer prefix, its stall_code's trailing number → the padded index, e.g.
// { stall_type:'dcfc', stall_code:'NASH-DCFC-STALL-05' } → renderer stall 'DCFC-05'.
// ============================================================================
import { useMemo } from 'react';
import { useDepotStore, type StallState } from '@/store/depotStore';
import { useAppointmentStore, type ApptReservation } from '@/store/appointmentStore';

const OTTO_RED = '#C8102E'; // OTTOYARD accent — the held-for-inbound hero ring
const CALM = '#9AA3B2';     // desaturated steel — reserved / occupied holds

// reservation stall_type → renderer stall-id prefix (the SAME map the motion
// driver uses to place cars on OTTO-Q's exact stalls, so the two can't diverge).
const PREFIX: Record<string, string> = {
  dcfc: 'DCFC', l2: 'L2', wash_bay: 'WASH', service_bay: 'SVC', staging: 'STAGE',
};

/** { stall_type, stall_code } → renderer stall id (e.g. 'DCFC-05'), or null. */
function rendererStallId(type: string, code: string | null): string | null {
  const p = PREFIX[String(type ?? '').toLowerCase()];
  const m = /(\d+)\s*$/.exec(code ?? '');
  if (!p || !m) return null;
  return `${p}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
}

// stall outline — mirrors Stall.tsx so the ring traces the EXACT stall polygon
// (charging stalls are skewed parallelograms; staging/bays are rectangles).
function stallOutline(stall: StallState): { points: string; cx: number; topY: number } {
  const isWash = stall.type === 'wash';
  const w = isWash ? 12 : stall.type === 'dcfc' ? 10 : 8;
  const h = isWash ? 14 : 16;
  const angleDeg = stall.position.angle;
  const skew = angleDeg === 0 ? 0 : h * Math.cos((angleDeg * Math.PI) / 180);
  const pts: [number, number][] = angleDeg === 0
    ? [[0, 0], [w, 0], [w, h], [0, h]]
    : [[0, h], [w, h], [w + skew, 0], [skew, 0]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    points: pts.map((p) => `${p[0]},${p[1]}`).join(' '),
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    topY: Math.min(...ys),
  };
}

type GlowKind = 'held' | 'calm';

/**
 * Subtle glow layer drawn between the stalls and the vehicle dots, so a ring
 * traces the reserved stall's outline without obscuring the car or its number.
 */
export const ReservationGlow = () => {
  const stalls = useDepotStore((s) => s.stalls);
  const data = useAppointmentStore((s) => s.data);

  const byId = useMemo(() => {
    const m = new Map<string, StallState>();
    for (const s of stalls) m.set(s.id, s);
    return m;
  }, [stalls]);

  // Resolve each reservation to a renderer stall + its glow kind. `held` wins on
  // any (rare) collision so a hero hold is never downgraded to a calm ring.
  const glows = useMemo(() => {
    const res: ApptReservation[] = data?.reservations ?? [];
    const out = new Map<string, { kind: GlowKind; r: ApptReservation }>();
    for (const r of res) {
      const id = rendererStallId(r.stall_type, r.stall_code);
      if (!id || !byId.has(id)) continue;
      const kind: GlowKind = r.inbound && !r.occupied ? 'held' : 'calm';
      const prev = out.get(id);
      if (!prev || (kind === 'held' && prev.kind !== 'held')) out.set(id, { kind, r });
    }
    return out;
  }, [data, byId]);

  // Honesty: no run / nothing reserved → render nothing (no fake glow).
  if (glows.size === 0) return null;

  return (
    <g pointerEvents="none">
      <defs>
        <filter id="resGlowBlur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.15" />
        </filter>
      </defs>
      {[...glows.entries()].map(([id, g]) => {
        const stall = byId.get(id)!;
        const o = stallOutline(stall);
        const { x, y } = stall.position;
        const held = g.kind === 'held';
        const color = held ? OTTO_RED : CALM;
        return (
          <g key={id} transform={`translate(${x}, ${y})`}>
            {/* rings — pulse (held) or steady (calm). Grouped so the pulse eases
                the whole halo+ring together while the HELD tag stays legible. */}
            <g className={held ? 'reservation-hold-glow' : undefined}>
              {held && (
                <polygon
                  points={o.points}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.4}
                  strokeLinejoin="round"
                  opacity={0.5}
                  filter="url(#resGlowBlur)"
                />
              )}
              <polygon
                points={o.points}
                fill="none"
                stroke={color}
                strokeWidth={held ? 1 : 0.55}
                strokeLinejoin="round"
                opacity={held ? 0.95 : 0.4}
              />
            </g>
            {held && (
              // hero tag: this stall sits empty ON PURPOSE for an arriving car —
              // the "held for a reason, not waste" story, right on the map.
              <g transform={`translate(${o.cx}, ${o.topY - 3})`}>
                <rect x={-6} y={-3.4} width={12} height={4.3} rx={0.9} fill={OTTO_RED} opacity={0.92} />
                <text x={0} y={-0.3} textAnchor="middle" fontSize={2.7} fill="#ffffff" fontWeight="bold" letterSpacing="0.15">
                  HELD
                </text>
                <title>{`Held empty for inbound ${g.r.av_id ?? 'AV'}`}</title>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
};

ReservationGlow.displayName = 'ReservationGlow';
