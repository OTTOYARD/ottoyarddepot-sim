// ============================================================================
// TwinPowerTab — the depot's electrical one-line, live. The last tab in the bar (it has no number key).
//
// What it shows: how power reaches a post. The utility's 13.8 kV service, the switchgear, seven transformers (one per
// canopy column of five posts, and one for the battery, the building and the canopy solar), and the thirty posts. Each
// transformer carries its load and its own temperature, stepped by the engine on every tick; each post shows whether it
// is charging, idle or down. A transformer can be tripped from here while a run is live: every post under it goes dark
// at once and OTTO-Q re-queues the cars to finish.
//
// Data contract: otto-q-core 0810, ottoq_power_one_line. Parsing and words in src/lib/powerOneLine.ts; the read in
// src/hooks/usePowerOneLine.ts. This file only draws.
//
// WHAT IT WILL NOT DO. It invents no number: until the engine answers, or before any run is measured, it says so and
// shows the tree alone. And it never reads a rating as a limit: every size is what is installed, at or above everything
// connected under it (otto-q-core CLAUDE.md rule 13), and "this day would have fit on a smaller unit" is one run's
// reading for a person, not a change.
// ============================================================================
import { useMemo, useState } from 'react';
import { Activity, Loader2, Power, Thermometer, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTwinStore } from '@/store/twinStore';
import { isLiveRunStatus } from '@/lib/cockpitLinks';
import { clockCT } from '@/lib/plainWords';
import { twin } from '@/lib/ottoTwin';
import { usePowerOneLine } from '@/hooks/usePowerOneLine';
import {
  DASH, activeTrip, childrenOf, fmtC, fmtKv, fmtKva, fmtKw, fmtMwh, fmtPct, heatOf, lifeWords, loadShares,
  notMeasuredText, postState, postsAskedWords, resilienceWords, rightsizeWords, service, siteNow, transformers,
  type Heat, type OneLine, type PowerNode,
} from '@/lib/powerOneLine';

const PANEL = 'rounded border border-white/[0.06] bg-canvas-panel/60';
const HEAD = 'font-display text-[10px] uppercase tracking-[0.08em] text-ink-dim';
export const TRIP_MINUTES = 90;

const LINE = 'rgba(255,255,255,0.55)';
const GO = '#6EE7B7';
const WARN = '#FCD34D';
const CRIT = '#FF8A80';
const HEAT_STROKE: Record<Heat, string> = { cool: LINE, warm: WARN, hot: CRIT, unknown: 'rgba(255,255,255,0.3)' };

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded bg-white/[0.03] px-2 py-1.5 min-w-0">
      <div className={HEAD}>{label}</div>
      <div className={`font-mono text-[13px] tabular-nums truncate ${tone ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[10px] leading-4 text-ink-dim truncate">{sub}</div>}
    </div>
  );
}

// ── the diagram ──────────────────────────────────────────────────────────────
const W = 420;
const BUS_Y = 46;
const colX = (i: number, n: number) => 32 + (i * (W - 64)) / Math.max(1, n - 1);

function PostDot({ x, y, node }: { x: number; y: number; node: PowerNode }) {
  const st = postState(node);
  const pu = Math.min(1, Math.max(0, node.now?.load_pu ?? 0));
  const label = `${node.title}: ${st === 'down' ? 'down' : st === 'charging' ? `charging at ${fmtKw(node.now?.kw_dc)}` : 'idle'}`;
  return (
    <g data-testid={`power-post-${node.code}`} data-state={st}>
      <title>{label}</title>
      {st === 'down' ? (
        <>
          <circle cx={x} cy={y} r={5} fill="none" stroke={CRIT} strokeWidth={1.2} />
          <path d={`M${x - 2.6} ${y - 2.6}L${x + 2.6} ${y + 2.6}M${x + 2.6} ${y - 2.6}L${x - 2.6} ${y + 2.6}`} stroke={CRIT} strokeWidth={1.2} />
        </>
      ) : st === 'charging' ? (
        <circle cx={x} cy={y} r={5} fill={GO} fillOpacity={0.35 + 0.65 * pu} stroke={GO} strokeWidth={1} />
      ) : (
        <circle cx={x} cy={y} r={5} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
      )}
    </g>
  );
}

function OneLineDiagram({ o, selected, onSelect }: { o: OneLine; selected: string | null; onSelect: (code: string) => void }) {
  const tx = transformers(o);
  const svc = service(o);
  return (
    <svg viewBox={`0 0 ${W} 262`} className="w-full h-auto" role="group" aria-label="The depot's electrical one-line" data-testid="power-diagram">
      {/* the utility service and the primary bus */}
      <text x={24} y={14} className="fill-white font-display" fontSize={9} letterSpacing="0.08em">
        UTILITY SERVICE · {fmtKv(svc?.voltage_v)}
      </text>
      <text x={W - 24} y={14} textAnchor="end" className="fill-white font-mono" fontSize={9}>
        {svc?.now?.kva !== null && svc?.now?.kva !== undefined ? `${fmtKva(svc.now.kva)} of ` : ''}{fmtKva(svc?.rated_kva)}
      </text>
      <line x1={W / 2} y1={20} x2={W / 2} y2={BUS_Y} stroke={LINE} strokeWidth={1.5} />
      <line x1={24} y1={BUS_Y} x2={W - 24} y2={BUS_Y} stroke={LINE} strokeWidth={2.5} strokeLinecap="round" />

      {tx.map((t, i) => {
        const x = colX(i, tx.length);
        const trip = activeTrip(o, t.code);
        const heat = heatOf(t.now?.hot_spot_c);
        const stroke = trip ? CRIT : HEAT_STROKE[heat];
        const kids = childrenOf(o, t.code);
        const posts = kids.filter((k) => k.kind === 'post');
        const others = kids.filter((k) => k.kind !== 'post');
        const isSel = selected === t.code;
        const pu = t.now?.load_pu ?? null;
        return (
          <g key={t.code} role="button" tabIndex={0} aria-pressed={isSel} aria-label={`${t.title}${trip ? ', tripped' : ''}`}
            data-testid={`power-tx-${t.code}`} data-tripped={trip ? 'true' : undefined} data-heat={heat}
            onClick={() => onSelect(t.code)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t.code); } }}
            className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-white/60">
            <rect x={x - 26} y={52} width={52} height={204} rx={4}
              fill={isSel ? 'rgba(255,255,255,0.05)' : 'transparent'} stroke={isSel ? 'rgba(255,255,255,0.25)' : 'transparent'} />
            {/* feeder and its breaker: closed in line, open and red when tripped */}
            <line x1={x} y1={BUS_Y} x2={x} y2={58} stroke={LINE} strokeWidth={1.2} />
            {trip
              ? <path d={`M${x} 58L${x + 7} 66`} stroke={CRIT} strokeWidth={1.6} strokeLinecap="round" />
              : <line x1={x} y1={58} x2={x} y2={68} stroke={LINE} strokeWidth={1.2} />}
            <rect x={x - 2.5} y={55.5} width={5} height={5} fill={trip ? CRIT : '#111317'} stroke={trip ? CRIT : LINE} strokeWidth={1} />
            <line x1={x} y1={68} x2={x} y2={72} stroke={LINE} strokeWidth={1.2} />
            {/* the transformer: two windings */}
            <circle cx={x} cy={80} r={8} fill="none" stroke={stroke} strokeWidth={1.5} />
            <circle cx={x} cy={91} r={8} fill="none" stroke={stroke} strokeWidth={1.5} />
            <text x={x} y={113} textAnchor="middle" className="fill-white font-mono" fontSize={9}>{trip ? 'OPEN' : fmtPct(pu)}</text>
            <text x={x} y={124} textAnchor="middle" fontSize={8.5} className="font-mono" fill={heat === 'cool' || heat === 'unknown' ? 'rgba(255,255,255,0.75)' : HEAT_STROKE[heat]}>
              {fmtC(t.now?.hot_spot_c)}
            </text>
            <line x1={x} y1={99} x2={x} y2={103} stroke={LINE} strokeWidth={1.2} />
            <line x1={x} y1={128} x2={x} y2={posts.length ? 222 : 208} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            {posts.map((p, k) => <PostDot key={p.code} x={x} y={142 + k * 19} node={p} />)}
            {others.map((n, k) => {
              const kw = n.now?.kw_ac ?? null;
              const tag = n.kind === 'bess' ? 'BATT' : n.kind === 'solar' ? 'SOLAR' : 'BLDG';
              const flowing = kw !== null && Math.abs(kw) > 0.5;
              return (
                <g key={n.code} data-testid={`power-leaf-${n.code}`}>
                  <title>{`${n.title}: ${kw === null ? 'no reading' : kw < 0 ? `supplying ${fmtKw(-kw)}` : `drawing ${fmtKw(kw)}`}`}</title>
                  <rect x={x - 17} y={137 + k * 26} width={34} height={20} rx={3} fill="none"
                    stroke={flowing ? (kw! < 0 ? GO : LINE) : 'rgba(255,255,255,0.3)'} strokeWidth={1} />
                  <text x={x} y={145 + k * 26} textAnchor="middle" className="fill-white font-display" fontSize={6.5} letterSpacing="0.06em">{tag}</text>
                  <text x={x} y={153.5 + k * 26} textAnchor="middle" className="fill-white font-mono" fontSize={7}>
                    {kw === null ? DASH : `${kw < 0 ? '+' : ''}${Math.round(Math.abs(kw))}`}
                  </text>
                </g>
              );
            })}
            <text x={x} y={248} textAnchor="middle" className="fill-white font-display" fontSize={9} letterSpacing="0.06em">
              {t.code.replace(/^TX-/, '')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-4 text-ink-dim" data-testid="power-legend">
      <span className="inline-flex items-center gap-1"><svg width={10} height={10}><circle cx={5} cy={5} r={4} fill={GO} /></svg>charging</span>
      <span className="inline-flex items-center gap-1"><svg width={10} height={10}><circle cx={5} cy={5} r={4} fill="none" stroke="rgba(255,255,255,0.5)" /></svg>idle</span>
      <span className="inline-flex items-center gap-1"><svg width={10} height={10}><circle cx={5} cy={5} r={4} fill="none" stroke={CRIT} /><path d="M3 3L7 7M7 3L3 7" stroke={CRIT} /></svg>down</span>
      <span>% is load against the unit's rating; °C is its winding hot spot.</span>
    </div>
  );
}

// ── one transformer, in full ─────────────────────────────────────────────────
function LoadBars({ node }: { node: PowerNode }) {
  const shares = loadShares(node.study);
  const any = shares.some((s) => s > 0);
  const top = Math.max(...shares, 0.0001);
  return (
    <div data-testid="power-load-bars">
      <div className={HEAD}>Share of the day at each load</div>
      {any ? (
        <>
          <div className="mt-1 flex items-end gap-[3px] h-12" aria-hidden>
            {shares.map((s, i) => (
              <div key={i} className="flex-1 rounded-t-[2px]" title={`${i === 10 ? '100% or more' : `${i * 10}-${i * 10 + 10}%`} of rating: ${fmtPct(s, 1)} of the time`}
                style={{ height: `${Math.max(s > 0 ? 4 : 1, (s / top) * 100)}%`, background: i === 10 ? CRIT : i >= 8 ? WARN : 'rgba(255,255,255,0.55)', opacity: s > 0 ? 1 : 0.25 }} />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-ink-dim"><span>0%</span><span>50%</span><span>100% of rating</span></div>
          <p className="sr-only">
            {shares.map((s, i) => `${i === 10 ? '100% or more' : `${i * 10} to ${i * 10 + 10}%`}: ${fmtPct(s, 1)}`).join('; ')}
          </p>
        </>
      ) : <p className="mt-1 text-[11px] text-ink-dim">Nothing measured yet.</p>}
    </div>
  );
}

function TransformerCard({ o, node, live }: { o: OneLine; node: PowerNode; live: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const trip = activeTrip(o, node.code);
  const s = node.study;
  const posts = childrenOf(o, node.code).filter((k) => k.kind === 'post');
  const size = rightsizeWords(node);
  const ride = resilienceWords(node, clockCT);
  const canTrip = live && !!o.sim_run_id && posts.length > 0 && !trip;

  const doTrip = async () => {
    if (!o.sim_run_id) return;
    setBusy(true);
    try {
      const r = (await twin.injectFault(o.sim_run_id, { kind: 'power_zone', target_id: node.code, payload: { repair_minutes: TRIP_MINUTES } })) as
        { posts_faulted?: number; cars_on_posts?: number } | null;
      toast.success(`${node.code} tripped`, {
        description: `${r?.posts_faulted ?? posts.length} posts are dark for ${TRIP_MINUTES} sim minutes. ${r?.cars_on_posts ?? 0} cars were charging; OTTO-Q re-queues them to finish.`,
      });
    } catch (e: unknown) {
      toast.error(`${node.code} was not tripped`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <section className={`${PANEL} p-2.5 flex flex-col gap-2`} data-testid="power-tx-card" data-node={node.code}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-[12px] uppercase tracking-[0.06em] text-ink">{node.code}</h3>
        <span className="font-mono text-[10px] text-ink-dim">{fmtKva(node.rated_kva)} · {fmtKv(13800)} to {fmtKv(node.voltage_v)}</span>
      </div>
      <p className="text-[11px] leading-4 text-ink-dim">{node.title}</p>
      {trip && (
        <p role="status" data-testid="power-trip-note" className="rounded border border-[#FF8A80]/40 bg-[#FF8A80]/[0.08] px-2 py-1.5 text-[11px] leading-4 text-ink">
          Tripped at {clockCT(trip.tripped_at_sim)}. Power returns at {clockCT(trip.recovers_at_sim)}. {trip.posts_faulted} posts went dark together
          {trip.cars_on_posts > 0 ? `, ${trip.cars_on_posts} with a car charging. OTTO-Q re-queued ${trip.cars_on_posts === 1 ? 'it' : 'them'} to finish.` : '.'}
        </p>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Load now" value={fmtPct(node.now?.load_pu)} sub={fmtKva(node.now?.kva)} />
        <Stat label="Hot spot now" value={fmtC(node.now?.hot_spot_c)} sub={`oil ${fmtC(node.now?.top_oil_c)}`}
          tone={heatOf(node.now?.hot_spot_c) === 'hot' ? 'text-[#FF8A80]' : heatOf(node.now?.hot_spot_c) === 'warm' ? 'text-amber-300' : undefined} />
        <Stat label="Air" value={fmtC(node.now?.ambient_c)} sub="the twin's weather" />
        <Stat label="Peak" value={fmtKva(s?.peak_kva)} sub={s?.peak_at ? `at ${clockCT(s.peak_at)}` : undefined} />
        <Stat label="Busiest half hour" value={fmtKva(s?.peak_30min_kva)} sub={s?.peak_load_pu !== null && s?.peak_load_pu !== undefined ? `peak ${fmtPct(s.peak_load_pu)} of rating` : undefined} />
        <Stat label="Hottest" value={fmtC(s?.max_hot_spot_c)} sub={s?.max_hot_spot_at ? `at ${clockCT(s.max_hot_spot_at)}` : undefined} />
        <Stat label="Energy through" value={fmtMwh(s?.energy_kwh_ac)} sub={s?.hours !== null && s?.hours !== undefined ? `over ${s.hours.toFixed(1)} h` : undefined} />
        <Stat label="Lost in the unit" value={fmtMwh(s?.loss_kwh)} sub="core and windings" />
        <Stat label="Life used" value={lifeWords(s ?? null)} sub="at 110 °C: hour for hour" />
      </div>
      <LoadBars node={node} />
      {size && (
        <p className="text-[11px] leading-4 text-ink" data-testid="power-rightsize">
          {size} <span className="text-ink-dim">One run's reading, for a person. It changes nothing: the depot's ceiling is set after the build, from what the cars drew.</span>
        </p>
      )}
      {ride && <p className="text-[11px] leading-4 text-ink" data-testid="power-resilience">{ride}</p>}
      {posts.length > 0 && (
        canTrip ? (
          <div className="flex items-center gap-2">
            {!armed ? (
              <button type="button" data-testid="power-trip-arm" onClick={() => setArmed(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-white/[0.1] px-2.5 text-[11px] text-ink-dim hover:text-ink hover:bg-white/[0.05]">
                <Power size={12} aria-hidden /> Trip this transformer
              </button>
            ) : (
              <>
                <button type="button" data-testid="power-trip-confirm" disabled={busy} onClick={() => void doTrip()}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#FF8A80]/60 bg-[#FF8A80]/15 px-2.5 text-[11px] text-ink disabled:opacity-60">
                  {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Power size={12} aria-hidden />}
                  Confirm: {posts.length} posts go dark for {TRIP_MINUTES} sim min
                </button>
                <button type="button" onClick={() => setArmed(false)} disabled={busy} className="h-8 px-2 text-[11px] text-ink-dim hover:text-ink">Cancel</button>
              </>
            )}
          </div>
        ) : (
          <p className="text-[10px] leading-4 text-ink-dim" data-testid="power-trip-why-not">
            {trip ? 'This transformer is open.' : 'A transformer can be tripped while a run is live.'}
          </p>
        )
      )}
    </section>
  );
}

// ── the tab ──────────────────────────────────────────────────────────────────
export const TwinPowerTab = () => {
  const activeSimRunId = useTwinStore((st) => st.activeSimRunId);
  const run = useTwinStore((st) => st.snapshot?.run);
  const live = !!run && run.sim_run_id === activeSimRunId && isLiveRunStatus(run.status);
  const { oneLine, error, loading } = usePowerOneLine(live ? activeSimRunId : null, live);
  const [picked, setPicked] = useState<string | null>(null);

  const tx = useMemo(() => (oneLine ? transformers(oneLine) : []), [oneLine]);
  const now = useMemo(() => (oneLine ? siteNow(oneLine) : null), [oneLine]);
  const selected = tx.find((t) => t.code === picked) ?? now?.hottest ?? tx[0] ?? null;
  const svc = oneLine ? service(oneLine) : null;
  const measured = !!oneLine?.as_of_sim;
  const s = svc?.study ?? null;

  return (
    <ScrollArea className="h-full" data-testid="power-tab">
      <div className="flex flex-col gap-2.5 p-3">
        <div role="note" data-testid="power-banner" className="flex items-start gap-2 rounded border border-dashed border-emerald-300/40 bg-emerald-300/[0.05] px-2.5 py-2">
          <Zap size={14} aria-hidden className="mt-0.5 shrink-0 text-emerald-300" />
          <p className="min-w-0 text-[11.5px] leading-5 text-ink">
            <span className="font-semibold text-emerald-200">How power reaches a post.</span>{' '}
            Every size here is what is installed, at or above everything connected under it. Nothing on this page limits a car.
            {measured && <> Read at {clockCT(oneLine!.as_of_sim)} depot time{live ? ', live' : ', from the last run measured'}.</>}
          </p>
        </div>

        {loading && !oneLine && (
          <div className={`${PANEL} p-4 flex items-center gap-2 text-[12px] text-ink-dim`}><Loader2 size={14} className="animate-spin" aria-hidden /> Reading the one-line.</div>
        )}
        {!loading && !oneLine && (
          <div className={`${PANEL} p-4 text-[12px] leading-5 text-ink`} data-testid="power-empty">
            {notMeasuredText(null)}
            {error && <span className="block mt-1 font-mono text-[10px] text-ink-dim break-words">{error}</span>}
          </div>
        )}

        {oneLine && (
          <>
            <div className="grid grid-cols-2 gap-1.5" data-testid="power-now">
              <Stat label="Grid side now" value={fmtKw(now?.gridKw)} sub="what a primary meter would read" />
              <Stat label="Reaching the cars" value={fmtKw(now?.carsKw)} sub={`${now?.postsCharging ?? 0} of ${now?.posts ?? 0} posts charging`} />
              <Stat label="Lost on the way" value={fmtKw(now?.lostKw)} sub={now?.lostPct !== null && now?.lostPct !== undefined ? `${now.lostPct.toFixed(1)}% of what the charging draws` : 'chargers and transformers'} />
              <Stat label="Warmest transformer" value={now?.hottest ? fmtC(now.hottest.now?.hot_spot_c) : DASH} sub={now?.hottest ? now.hottest.code : undefined}
                tone={heatOf(now?.hottest?.now?.hot_spot_c) === 'hot' ? 'text-[#FF8A80]' : heatOf(now?.hottest?.now?.hot_spot_c) === 'warm' ? 'text-amber-300' : undefined} />
            </div>

            <section className={`${PANEL} p-2`}>
              <OneLineDiagram o={oneLine} selected={selected?.code ?? null} onSelect={setPicked} />
              <div className="px-1 pb-1"><Legend /></div>
            </section>

            {!measured && <div className={`${PANEL} p-3 text-[12px] leading-5 text-ink`} data-testid="power-unmeasured">{notMeasuredText(oneLine)}</div>}

            {selected && <TransformerCard key={selected.code} o={oneLine} node={selected} live={live} />}

            {measured && (
              <section className={`${PANEL} p-2.5 flex flex-col gap-2`} data-testid="power-utility">
                <h3 className={`${HEAD} inline-flex items-center gap-1.5`}><Activity size={11} aria-hidden /> What the utility would see, this run</h3>
                <div className="grid grid-cols-3 gap-1.5">
                  <Stat label="Installed" value={fmtKva(svc?.rated_kva)} sub={`${tx.length} transformers`} />
                  <Stat label="Peak" value={fmtKva(s?.peak_kva)} sub={s?.peak_at ? `at ${clockCT(s.peak_at)}` : undefined} />
                  <Stat label="Busiest half hour" value={fmtKva(s?.peak_30min_kva)}
                    sub={s?.peak_30min_kva !== null && s?.peak_30min_kva !== undefined && svc?.rated_kva ? `${fmtPct(s.peak_30min_kva / svc.rated_kva, 1)} of installed` : undefined} />
                  <Stat label="From the grid, net" value={fmtMwh(s?.energy_kwh_ac)} sub="after solar and battery" />
                  <Stat label="Into the cars" value={fmtMwh(s?.energy_kwh_dc)} />
                  <Stat label="Transformer losses" value={fmtMwh(s?.loss_kwh)} sub="every unit, all day" />
                </div>
                <p className="text-[10.5px] leading-4 text-ink-dim inline-flex items-start gap-1.5">
                  <Thermometer size={11} aria-hidden className="mt-0.5 shrink-0" />
                  <span>A transformer's limit is its temperature, not the sum of the nameplates under it. That is why each one carries its own, and why the depot's ceiling is set from a measured day.</span>
                </p>
                {postsAskedWords(oneLine) && <p className="text-[11px] leading-4 text-ink" data-testid="power-posts-asked">{postsAskedWords(oneLine)}</p>}
                {oneLine.sim_run_id && <p className="font-mono text-[9px] text-ink-dim break-all" data-testid="power-run-id">run {oneLine.sim_run_id}</p>}
              </section>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
};
