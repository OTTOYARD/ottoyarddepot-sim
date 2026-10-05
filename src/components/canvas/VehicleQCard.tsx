// ============================================================================
// VehicleQCard — tap a car, see its OTTO-Q workflow ("Q card").
//
// Chase, 2026-10-01: "each vehicle to be able to be tapped and a Q card to pop up and show its list of completed and
// needed services and time frames for each and any progress meters."
//
// DRAW-ONLY. The card is shaped by `buildQCard` (src/lib/vehicleQCard.ts) from the twin snapshot, ottoq_depot_cards
// and the car's own decisions; nothing here reads a clock, decides a step or fills a gap. A missing number is "—".
// What the car's owner's agent set (otto-q-core 0608) is shaped by `carOwnerView` (src/lib/ownerBoard.ts); a car with
// nothing set shows nothing of it.
//
//   desktop 2D / 3D  anchored over the car and following it (AnchoredQCard), clamped inside the view; above the
//                    car, else beside it, else below — never over the car itself
//   phone            a bottom sheet (QCardSheet): at a phone's live-view size an anchored card covers the car
// ============================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useQCard } from '@/store/qCardStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useTwinStore } from '@/store/twinStore';
import { useOwnerBoardStore } from '@/store/ownerBoardStore';
import { useVehicleQCard } from '@/hooks/useVehicleQCard';
import { CarTrail } from '@/components/tabs/ottoq/CarTrail';
import { DASH, clock, pctText, type QCard, type QStep } from '@/lib/vehicleQCard';
import { carOwnerView, type OwnerCarView } from '@/lib/ownerBoard';

const OK = '#34D399';
const WARN = '#FBBF24';
const TEAL = '#00B4A6';
const OEM_COLORS: Record<string, string> = { waymo: '#5B9BFF', tesla: '#FF453A', zoox: '#B06BFF' };

// ── pieces ──────────────────────────────────────────────────────────────────
function Meter({ value, color = TEAL, mark, label }: { value: number | null; color?: string; mark?: number | null; label: string }) {
  return (
    <div className="relative h-1.5 flex-1 rounded-full bg-white/10" role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={value === null ? DASH : `${Math.round(value)}%`}>
      {value !== null && (
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
      )}
      {mark != null && (
        <span aria-hidden className="absolute -top-[2px] h-[10px] w-px bg-white/80" style={{ left: `${Math.max(0, Math.min(100, mark))}%` }} />
      )}
    </div>
  );
}

const window_ = (s: QStep): string | null => {
  if (!s.from && !s.to) return null;
  const span = `${clock(s.from)}–${clock(s.to)}`;
  return s.windowKind === 'booked' ? `booked ${span}` : `planned ${span}`;
};

function StepRow({ s }: { s: QStep }) {
  const done = s.state === 'done';
  const cur = s.state === 'current';
  return (
    <li className="flex gap-2" data-testid="qcard-step" data-state={s.state}>
      <span aria-hidden className="mt-[3px] inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border text-[8px] font-bold"
        style={done ? { background: OK, borderColor: OK, color: '#06070A' } : cur ? { borderColor: TEAL } : { borderColor: 'rgba(255,255,255,0.25)' }}>
        {done ? '✓' : cur ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: TEAL }} /> : ''}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className={`truncate text-[11px] ${done ? 'text-ink-dim' : cur ? 'text-ink font-medium' : 'text-ink'}`}>{s.label}</span>
          {s.place && <span className="truncate text-[10px] text-ink-faint">· {s.place}</span>}
          <span className="flex-1" />
          <span className="shrink-0 font-mono text-[9px] text-ink-faint">
            {done ? clock(s.doneAt) : cur ? (s.progress !== null ? `${Math.round(s.progress)}%` : DASH) : ''}
          </span>
        </div>
        {cur && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <Meter value={s.progress} label={`${s.label} progress`} />
            <span className="shrink-0 font-mono text-[9px] text-ink-dim">in progress · ends {clock(s.eta)}</span>
          </div>
        )}
        {!done && (
          <div className="flex flex-wrap gap-x-1.5 text-[9px] leading-[13px] text-ink-faint">
            {s.enRoute && <span style={{ color: TEAL }}>on the way</span>}
            {!cur && window_(s) && <span className="font-mono">{window_(s)}</span>}
            {s.overdueMin !== null && s.overdueMin > 0 && <span style={{ color: WARN }}>start {s.overdueMin} min behind plan</span>}
            {cur && s.overPlanMin !== null && s.overPlanMin > 0 && <span style={{ color: WARN }}>{s.overPlanMin} min over plan</span>}
            {s.reassigned && (
              <span style={{ color: '#7DD3FC' }} data-testid="qcard-reassigned">
                ↺ re-assigned{s.reassigned.was ? ` (was ${s.reassigned.was})` : ''}{s.reassigned.at ? ` ${clock(s.reassigned.at)}` : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** An owner's agent's colour, as OrchestrAV draws it: the same on the chips, the Agent tab's lines and the car's marker. */
const AGENT_TONE = 'border-violet-500/40 bg-violet-500/10 text-violet-200';

/** What the car's owner's agent set: a charge limit, service orders, a hold, and the codes OTTO-Q confirmed them with. */
function OwnerAgentBlock({ v }: { v: OwnerCarView }) {
  return (
    <section className="mt-1.5 rounded border border-violet-500/30 bg-violet-500/[0.06] px-2 py-1.5" aria-label="Set by its owner's agent" data-testid="qcard-owner">
      <div className="mb-1 inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.08em] text-violet-300">
        <Bot size={10} aria-hidden />Set by its owner's agent
      </div>
      <ul className="flex flex-wrap gap-1">
        {v.chips.map((c) => (
          <li key={c.key} title={c.title} data-kind={c.kind} data-testid="qcard-owner-chip"
            className={`rounded border px-1.5 py-[1px] text-[10px] ${AGENT_TONE}`}>
            {c.label}
          </li>
        ))}
      </ul>
      {v.waitingForTick && (
        <div className="mt-1 text-[9px] text-amber-200" title="OTTO-Q applies a new setting at its next tick" data-testid="qcard-owner-waiting">
          applies at OTTO-Q's next tick
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] text-ink-dim">
        {v.receipts.map((r) => (
          <span key={r.agent} className="inline-flex flex-wrap items-center gap-1">
            <span>{r.agent}</span>
            {r.codes.map((c) => (
              <code key={c.code} title={c.title} data-testid="qcard-owner-code"
                className="rounded border border-violet-400/30 bg-black/30 px-1 font-mono text-[9.5px] text-violet-100">
                {c.code}
              </code>
            ))}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[9px] text-ink-faint" title={v.resets ?? undefined}>Everything an agent sets lasts until the demo run ends.</p>
    </section>
  );
}

const Section = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section className="mt-2 border-t border-white/[0.08] pt-1.5">
    <div className="mb-1 flex items-center justify-between">
      <span className="text-[9px] uppercase tracking-[0.08em] text-ink-faint">{title}</span>
      {right}
    </div>
    {children}
  </section>
);

// ── the card body ───────────────────────────────────────────────────────────
export function QCardBody({ card, oem, onClose, cardsStatus, owner }: {
  card: QCard; oem?: string | null; onClose: () => void; cardsStatus: 'waiting' | 'ok' | 'other_run';
  /** What the car's owner's agent set on this run (carOwnerView), or null when it set nothing. */
  owner?: OwnerCarView | null;
}) {
  const [trail, setTrail] = useState(false);
  useEffect(() => setTrail(false), [card.vehicleId]);
  const b = card.battery;
  const oemColor = OEM_COLORS[(oem ?? '').toLowerCase()] ?? '#FFFFFF';
  const stepsNote = cardsStatus === 'waiting' ? 'Waiting for the depot cards…'
    : cardsStatus === 'other_run' ? 'The depot cards describe another run.'
    : `${DASH} no plan steps published for this car`;

  return (
    <div className="text-ink" data-testid="vehicle-qcard" data-vehicle={card.vehicleId}>
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: oemColor }} />
        <span className="min-w-0 truncate font-mono text-[12px] font-bold">{card.name}</span>
        <span className="text-[9px] uppercase tracking-[0.08em] text-brand-hot">Q card</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} aria-label="Close Q card"
          className="-my-1 -mr-1 inline-flex h-7 w-7 items-center justify-center rounded text-ink-faint hover:bg-white/10 hover:text-ink [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10">
          <X size={14} />
        </button>
      </div>
      <div className="text-[11px] text-ink-dim" data-testid="qcard-state">{card.state.words}</div>

      {/* battery now vs target */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="w-12 shrink-0 text-[10px] text-ink-faint">Battery</span>
        <Meter value={b.now} mark={b.target} color={b.ofTarget !== null && b.ofTarget >= 100 ? OK : TEAL} label="Battery" />
        <span className="shrink-0 font-mono text-[10px]" data-testid="qcard-battery">{pctText(b.now)} / {pctText(b.target)}</span>
      </div>
      {b.onArrival !== null && <div className="pl-[54px] font-mono text-[9px] text-ink-faint">arrived on {pctText(b.onArrival)}</div>}

      {/* where it is and what is happening there */}
      <div className="mt-1.5 rounded border border-white/[0.06] bg-white/[0.03] px-2 py-1.5" data-testid="qcard-now">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[9px] uppercase tracking-[0.08em] text-ink-faint">Now</span>
          <span className="min-w-0 truncate text-[11px] font-medium">{card.now.what}</span>
          <span className="min-w-0 truncate text-[10px] text-ink-faint">{card.now.place ? `· ${card.now.place}` : ''}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <Meter value={card.now.progress} label="Current station progress" />
          <span className="shrink-0 font-mono text-[9px] text-ink-dim">
            {card.now.progress !== null ? `${Math.round(card.now.progress)}%` : DASH} · ends {clock(card.now.eta)}
          </span>
        </div>
        {(card.now.etaSource || card.now.arm) && (
          <div className="mt-0.5 text-[9px] text-ink-faint">
            {[card.now.etaSource ? `end time from the ${card.now.etaSource}` : null, card.now.arm].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {card.hold && (
        <div className="mt-1.5 rounded border px-2 py-1 text-[10px]" style={{ borderColor: 'rgba(251,191,36,0.35)', color: WARN, background: 'rgba(251,191,36,0.06)' }} data-testid="qcard-hold">
          {card.hold.words}{card.hold.place ? ` · ${card.hold.place}` : ''}{card.hold.until ? ` · until ${clock(card.hold.until)}` : ''}
        </div>
      )}

      {owner && <OwnerAgentBlock v={owner} />}

      {/* the workflow, in order */}
      <Section title="OTTO-Q workflow" right={card.next ? <span className="truncate text-[9px] text-ink-dim">next: {card.next.label.toLowerCase()}</span> : null}>
        {card.steps.items.length ? (
          <ol className="space-y-1" aria-label={`${card.name} workflow`}>
            {card.steps.items.map((s) => <StepRow key={s.key} s={s} />)}
          </ol>
        ) : (
          <div className="text-[10px] text-ink-faint" data-testid="qcard-no-steps">{card.steps.published ? `${DASH} no stations on the plan` : stepsNote}</div>
        )}
        {card.steps.earlierHidden && <div className="mt-0.5 text-[9px] text-ink-faint">Earlier steps: see the full trail.</div>}
      </Section>

      {/* the services this visit is for */}
      <Section title="Services">
        {card.needs.published ? (
          card.needs.items.length ? (
            <ul className="flex flex-wrap gap-1" data-testid="qcard-needs">
              {card.needs.items.map((n, i) => (
                <li key={`${n.svc}-${i}`} data-state={n.state} title={n.note ?? undefined}
                  className="rounded border px-1.5 py-[1px] text-[10px]"
                  style={n.state === 'done' ? { borderColor: 'rgba(52,211,153,0.4)', color: OK }
                    : n.state === 'active' ? { borderColor: TEAL, color: '#E7EAF0' }
                    : n.state === 'dropped' || n.state === 'deferred' ? { borderColor: 'rgba(255,255,255,0.12)', color: '#FFFFFF' }
                    : { borderColor: 'rgba(255,255,255,0.2)', color: '#FFFFFF' }}>
                  {n.state === 'done' ? '✓ ' : n.state === 'active' ? '◐ ' : ''}
                  <span style={{ textDecoration: n.state === 'dropped' ? 'line-through' : undefined }}>{n.label}</span>
                  <span className="ml-1 font-mono text-[9px]">
                    {n.state === 'done' ? clock(n.doneAt) : n.estMin !== null ? `~${n.estMin}m` : ''}
                  </span>
                  {n.note && <span className="ml-1 text-[9px]">({n.note})</span>}
                </li>
              ))}
            </ul>
          ) : <div className="text-[10px] text-ink-faint">Visit open · no services assigned</div>
        ) : <div className="text-[10px] text-ink-faint">{DASH} no services published for this car</div>}
      </Section>

      {card.changes.length > 0 && (
        <Section title="Plan changes">
          <ul className="space-y-0.5">
            {card.changes.slice(0, 3).map((c, i) => (
              <li key={i} className="flex gap-1.5 text-[10px] text-ink-dim"><span className="text-[#7DD3FC]">↺</span>{c.words}<span className="flex-1" />{c.at && <span className="font-mono text-[9px] text-ink-faint">{clock(c.at)}</span>}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* rule 9 */}
      <div className="mt-2 rounded px-2 py-1 text-[10px]" data-testid="qcard-leave" data-cleared={String(card.leave.cleared)}
        style={card.leave.cleared === true ? { background: 'rgba(52,211,153,0.12)', color: OK }
          : card.leave.cleared === false ? { background: 'rgba(255,255,255,0.04)', color: '#FFFFFF' }
          : { background: 'rgba(255,255,255,0.03)', color: '#FFFFFF' }}>
        {card.leave.words}
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[9px] text-ink-faint">
        <span className="font-mono">due {clock(card.dueAt)}</span>
        {card.urgency && <span>· {card.urgency.replace(/_/g, ' ')}</span>}
        <span className="flex-1" />
        <button type="button" onClick={() => setTrail((t) => !t)} aria-expanded={trail}
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-ink-dim hover:bg-white/10 hover:text-ink">
          {trail ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Full trail
        </button>
      </div>
      {trail && <div className="mt-1 rounded border border-white/[0.06]"><CarTrail car={{ id: card.vehicleId, name: card.name }} /></div>}
    </div>
  );
}

/** The open car's card, or null. Closes itself when the car leaves the roster; Escape closes it. */
function useOpenCard() {
  const openId = useQCard((s) => s.openId);
  const close = useQCard((s) => s.close);
  const present = useVehicleStore((s) => (openId ? s.vehicles.some((v) => v.id === openId) : true));
  const oem = useVehicleStore((s) => (openId ? s.vehicles.find((v) => v.id === openId)?.oem ?? null : null));
  useEffect(() => { if (!present) close(); }, [present, close]);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, close]);
  const data = useVehicleQCard(openId);
  // what its owner's agent set, read by useOwnerBoard for the whole cockpit (otto-q-core 0608)
  const board = useOwnerBoardStore((s) => s.board);
  const runId = useTwinStore((s) => s.activeSimRunId);
  const owner = useMemo(() => carOwnerView(board, openId, runId), [board, openId, runId]);
  return { openId, close, oem, owner, ...data };
}

const CARD_W = 292;
const GAP = 18;
const EDGE = 8;

/**
 * The card anchored over a car. `getAnchor` returns the car's middle in CLIENT pixels and its on-screen radius `r` (or
 * null when it is off screen);
 * one rAF places the card from it inside its positioned parent, imperatively, so a moving car is followed without
 * re-rendering anything.
 */
export function AnchoredQCard({ getAnchor }: { getAnchor: (id: string) => { x: number; y: number; r: number } | null }) {
  const { openId, close, oem, owner, card, cardsStatus } = useOpenCard();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      const parent = el?.offsetParent as HTMLElement | null;
      if (el && parent) {
        const c = getAnchor(openId);
        const pr = parent.getBoundingClientRect();
        const a = c ? { x: c.x - pr.left, y: c.y - pr.top, r: c.r } : null;
        const W = parent.clientWidth, H = parent.clientHeight;
        const w = el.offsetWidth, h = el.offsetHeight;
        if (!a) { el.style.visibility = 'hidden'; }
        else {
          // Above the car if it fits, else beside it (right, then left), else below: never over the car itself.
          const clear = a.r + GAP;
          const clampX = (x: number) => Math.max(EDGE, Math.min(W - w - EDGE, x));
          const clampY = (y: number) => Math.max(EDGE, Math.min(H - h - EDGE, y));
          let left: number, top: number;
          if (a.y - clear - h >= EDGE) { left = clampX(a.x - w / 2); top = a.y - clear - h; }
          else if (a.x + clear + w <= W - EDGE) { left = a.x + clear; top = clampY(a.y - h / 2); }
          else if (a.x - clear - w >= EDGE) { left = a.x - clear - w; top = clampY(a.y - h / 2); }
          else { left = clampX(a.x - w / 2); top = clampY(a.y + clear); }
          el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
          el.style.visibility = 'visible';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [openId, getAnchor]);

  if (!openId || !card) return null;
  return (
    <div ref={ref}
      className="absolute left-0 top-0 z-40 overflow-y-auto rounded-md border border-white/15 bg-canvas-panel/95 px-3 py-2 shadow-2xl backdrop-blur"
      style={{ width: CARD_W, maxHeight: 'min(440px, calc(100% - 16px))', visibility: 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <QCardBody card={card} oem={oem} onClose={close} cardsStatus={cardsStatus} owner={owner} />
    </div>
  );
}

/** The phone's card: a bottom sheet over the cockpit. */
export function QCardSheet() {
  const { openId, close, oem, owner, card, cardsStatus } = useOpenCard();
  if (!openId || !card) return null;
  return (
    <div role="dialog" aria-label={`${card.name} Q card`}
      className="fixed inset-x-0 bottom-0 z-50 overflow-y-auto rounded-t-xl border-t border-white/15 bg-canvas-panel/95 px-4 pt-2 shadow-2xl backdrop-blur"
      style={{ maxHeight: '62dvh', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 16px)', paddingRight: 'calc(env(safe-area-inset-right, 0px) + 16px)' }}>
      <div aria-hidden className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-white/20" />
      <QCardBody card={card} oem={oem} onClose={close} cardsStatus={cardsStatus} owner={owner} />
    </div>
  );
}
