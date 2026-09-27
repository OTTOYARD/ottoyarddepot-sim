// ============================================================================
// SecondLoopPanel — what OTTO-Q questions about its own decisions, and what it
// is learning, live.
//
// Chase, 2026-09-27: "Make sure any of the additions from a Challenger or
// optimization standpoint are visible both in the twin and pulse app UI's. I
// just want to make sure visually we are still seeing what decisions are being
// made and there is a transparency layer to our brain and how the engine fires."
//
// Two cards, in the order they act on a day:
//   CHALLENGER — beside the funnel, every minute of a live run. The questions it
//     asks, what it has open right now, what it graded in hindsight, and each
//     question's record across runs. It never changes the engine, and the card
//     says so.
//   LEARNER — after the day, overnight. Each dial experiment: the two values it
//     compares, the pairs toward its next look, whether both arms actually read
//     the dial they were given (0533), the verdict as the runner will judge it,
//     and what the promoter did.
//
// Data contract: otto-q-core 0536, ottoq_challenger_board and
// ottoq_learning_board. Formatters in src/lib/secondLoop.ts, shared verbatim
// with PULSE.
// ============================================================================
import { FlaskConical, Loader2, Search } from 'lucide-react';
import { useSecondLoop } from '@/hooks/useSecondLoop';
import {
  clockCT,
  dayClockCT,
  dialReadText,
  dialText,
  episodeText,
  gradeLabel,
  gradeTone,
  hitRateText,
  lastPairText,
  num,
  outcomeLabel,
  outcomeTone,
  pairsProgress,
  realizedText,
  windowText,
  type ChallengerEpisode,
  type LearningExperiment,
  type LoopTone,
} from '@/lib/secondLoop';

const TONE_CLASS: Record<LoopTone, string> = {
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  bad: 'border-brand-red/40 bg-brand-red/10 text-red-300',
  idle: 'border-white/10 bg-white/[0.04] text-ink-faint',
  info: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
};

const Chip = ({ tone, children }: { tone: LoopTone; children: React.ReactNode }) => (
  <span
    className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] ${TONE_CLASS[tone]}`}
  >
    {children}
  </span>
);

const Card = ({
  icon: Icon,
  title,
  subtitle,
  chip,
  children,
}: {
  icon: typeof Search;
  title: string;
  subtitle: string;
  chip?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="rounded border border-white/[0.06] bg-canvas-panel/60 p-2.5">
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-1.5">
        <Icon size={12} className="mt-px shrink-0 text-ink-dim" />
        <div className="min-w-0">
          <div className="text-[11px] font-display uppercase tracking-[0.06em] text-ink">{title}</div>
          <p className="mt-0.5 text-[9px] leading-4 text-ink-dim">{subtitle}</p>
        </div>
      </div>
      {chip}
    </div>
    <div className="mt-2 space-y-2">{children}</div>
  </div>
);

const Episode = ({ ep, graded }: { ep: ChallengerEpisode; graded: boolean }) => (
  <li className="rounded border border-white/[0.05] bg-white/[0.02] p-1.5">
    <div className="flex items-start justify-between gap-2">
      <span className="min-w-0 break-words text-[10px] leading-4 text-ink">
        <span className="mr-1 font-mono text-[9px] text-ink-faint">{ep.tag}</span>
        {episodeText(ep)}
      </span>
      {graded ? <Chip tone={gradeTone(ep.grade)}>{ep.grade ?? 'closed'}</Chip> : <Chip tone="info">open</Chip>}
    </div>
    {ep.claim && <p className="mt-0.5 break-words text-[9px] leading-4 text-ink-dim">claim: {ep.claim}</p>}
    {graded && (realizedText(ep) || ep.grade) && (
      <p className="mt-0.5 break-words text-[9px] leading-4 text-ink-dim">
        {gradeLabel(ep.grade)}
        {realizedText(ep) ? ` — ${realizedText(ep)}` : ''}
      </p>
    )}
    <p className="mt-0.5 font-mono text-[9px] text-ink-faint">
      {[
        clockCT(ep.first_seen_sim),
        graded ? (ep.closed_sim ? `closed ${clockCT(ep.closed_sim)}` : null) : ep.last_seen_sim ? `still true ${clockCT(ep.last_seen_sim)}` : null,
        num(ep.scans_seen) === null ? null : `${ep.scans_seen} scan${ep.scans_seen === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  </li>
);

const Experiment = ({ e, floor }: { e: LearningExperiment; floor?: string | null }) => {
  const progress = pairsProgress(e);
  const reads = dialReadText(e.dial_reads);
  const last = lastPairText(e, floor);
  const waitsUntil = e.run_after && new Date(e.run_after).getTime() > Date.now() ? e.run_after : null;
  return (
    <li className="rounded border border-white/[0.05] bg-white/[0.02] p-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words font-mono text-[10px] text-ink">{dialText(e)}</span>
        <Chip tone={outcomeTone(e.outcome)}>{outcomeLabel(e.outcome)}</Chip>
      </div>
      <p className="mt-0.5 break-words text-[9px] leading-4 text-ink-dim">
        judged on {(e.primary_metric ?? 'its primary').replace(/_/g, ' ')} ({e.primary_better ?? '?'} is better)
        {waitsUntil ? ` · waiting until ${dayClockCT(waitsUntil)}` : ''}
      </p>
      {e.status === 'active' && (
        <div className="mt-1">
          <div className="h-1 w-full overflow-hidden rounded bg-white/[0.06]">
            <div className="h-full rounded bg-sky-400/70" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="mt-0.5 font-mono text-[9px] text-ink-faint">
            {progress.label}
            {num(e.pairs?.invalid) ? ` · ${e.pairs?.invalid} invalid` : ''}
          </p>
        </div>
      )}
      {reads && (
        <p className={`mt-0.5 text-[9px] leading-4 ${reads.tone === 'bad' ? 'text-red-300' : 'text-ink-dim'}`}>{reads.text}</p>
      )}
      {last && <p className="mt-0.5 break-words text-[9px] leading-4 text-ink-dim">{last}</p>}
      {e.why && e.outcome !== 'collecting' && <p className="mt-0.5 break-words text-[9px] leading-4 text-ink-dim">{e.why}</p>}
      {e.promotion?.outcome && (
        <p className="mt-0.5 break-words text-[9px] leading-4 text-ink-dim">
          promoter: {e.promotion.outcome}
          {e.promotion.reason ? ` — ${e.promotion.reason.replace(/_/g, ' ')}` : ''}
        </p>
      )}
    </li>
  );
};

export function SecondLoopPanel() {
  const { challenger, learning, error, loading } = useSecondLoop(true);

  if (!challenger && !learning && loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-4 text-ink-faint">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-[11px]">Reading the challenger and the learner…</span>
      </div>
    );
  }

  const questions = challenger?.questions ?? [];
  const open = challenger?.open ?? [];
  const graded = challenger?.graded ?? [];
  const run = challenger?.run ?? null;
  const experiments = learning?.experiments ?? [];
  const active = experiments.filter((e) => e.status === 'active');
  const ended = experiments.filter((e) => e.status !== 'active');
  const promotions = learning?.promotions ?? [];

  return (
    <div className="space-y-2">
      <Card
        icon={Search}
        title="Challenger"
        subtitle="Beside the funnel, every minute of a live run: could the depot do better right now? Each question is graded in hindsight when it closes. It never changes the engine."
        chip={
          <Chip tone={challenger?.scanner?.active ? (run?.status === 'running' ? 'ok' : 'idle') : 'bad'}>
            {challenger?.scanner?.active ? (run?.status === 'running' ? 'watching' : 'idle') : 'off'}
          </Chip>
        }
      >
        <p className="font-mono text-[9px] text-ink-faint">
          {run?.sim_run_id
            ? [`run ${run.sim_run_id.slice(0, 8)}`, run.status, clockCT(run.sim_clock)].filter(Boolean).join(' · ')
            : 'no operator run yet'}
        </p>
        <ul className="space-y-1">
          {questions.map((q) => (
            <li key={q.code} className="rounded border border-white/[0.05] bg-white/[0.02] p-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words text-[10px] leading-4 text-ink">
                  <span className="mr-1 font-mono text-[9px] text-ink-faint">{q.tag}</span>
                  {q.asks}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-ink">
                  {num(q.run?.open) ?? 0} open · {num(q.run?.episodes) ?? 0} this run
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[9px] text-ink-faint">
                {[
                  num(q.run?.confirmed) ? `${q.run?.confirmed} confirmed` : null,
                  num(q.run?.refuted) ? `${q.run?.refuted} refuted` : null,
                  num(q.run?.inconclusive) ? `${q.run?.inconclusive} inconclusive` : null,
                  hitRateText(q.lifetime),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'nothing graded yet'}
              </p>
              {q.lever && <p className="mt-0.5 break-words text-[9px] leading-4 text-ink-dim">lever: {q.lever}</p>}
            </li>
          ))}
        </ul>
        {open.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.06em] text-ink-faint">Open now</div>
            <ul className="mt-1 space-y-1">
              {open.slice(0, 8).map((ep) => (
                <Episode key={ep.finding_id} ep={ep} graded={false} />
              ))}
            </ul>
          </div>
        )}
        {graded.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.06em] text-ink-faint">Graded in hindsight</div>
            <ul className="mt-1 space-y-1">
              {graded.slice(0, 8).map((ep) => (
                <Episode key={ep.finding_id} ep={ep} graded />
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card
        icon={FlaskConical}
        title="Learner"
        subtitle="After the day, overnight: each dial is tested in paired runs on the same seed and the same world, one value against another. The verdict decides what is promoted."
        chip={<Chip tone={learning?.runner?.enabled ? 'ok' : 'idle'}>{learning?.runner?.enabled ? 'pairing' : 'between windows'}</Chip>}
      >
        <p className="font-mono text-[9px] text-ink-faint">{windowText(learning) ?? ''}</p>
        {active.length === 0 ? (
          <p className="text-[10px] text-ink-faint">No experiment is active.</p>
        ) : (
          <ul className="space-y-1">
            {active.map((e) => (
              <Experiment key={e.experiment_id} e={e} floor={learning?.dial_floor} />
            ))}
          </ul>
        )}
        {ended.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.06em] text-ink-faint">Ended this week</div>
            <ul className="mt-1 space-y-1">
              {ended.map((e) => (
                <Experiment key={e.experiment_id} e={e} floor={learning?.dial_floor} />
              ))}
            </ul>
          </div>
        )}
        {promotions.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.06em] text-ink-faint">Promotions</div>
            <ul className="mt-1 space-y-0.5">
              {promotions.slice(0, 5).map((p) => (
                <li key={p.promotion_id} className="flex items-baseline justify-between gap-2 font-mono text-[9px]">
                  <span className="min-w-0 truncate text-ink-dim">
                    {p.param_key.replace(/_/g, ' ')} {num(p.from) ?? '?'} → {num(p.to) ?? '?'}
                  </span>
                  <span className="shrink-0 text-ink">{p.outcome}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {error && <p className="break-words px-1 font-mono text-[9px] text-red-300">read failed: {error}</p>}
      <p className="px-1 pb-1 text-[9px] leading-4 text-ink-faint">
        Read from <span className="font-mono">ottoq_challenger_board</span> and{' '}
        <span className="font-mono">ottoq_learning_board</span>. The verdicts are the dial runner's own, not recomputed here.
      </p>
    </div>
  );
}

export default SecondLoopPanel;
