// ============================================================================
// secondLoop — the typed shape of OTTO-Q's second loop, and the pure
// formatters the cockpits render it with.
//
// The first loop is the funnel: agent → shield → proposers → kernel → dispatch.
// The second runs beside it and after it, and it is where OTTO-Q gets better:
//   - the CHALLENGER watches a live run every minute and asks whether the depot
//     could do better right now. Each question it raises is graded in hindsight
//     when the episode closes. It never changes the engine;
//   - the LEARNER runs paired experiments on the engine's dials overnight, on
//     the same seed and the same world in both arms. Its verdict is what the
//     promoter acts on.
//
// Data contracts (otto-q-core 0536):
//   public.ottoq_challenger_board(p_sim_run_id uuid)
//   public.ottoq_learning_board()
//
// THE RULE is the Intelligence panel's: render what the engine measured and
// never fill a gap. A missing number is null, never a zero.
//
// This file is carried verbatim by the twin cockpit (ottoyarddepot-sim) and
// PULSE (ottoyard-field-ops). It imports nothing, so it can be.
// ============================================================================

export type LoopTone = 'ok' | 'warn' | 'bad' | 'idle' | 'info';

// ── the challenger ───────────────────────────────────────────────────────────

export interface ChallengerRunStats {
  episodes?: number | null;
  open?: number | null;
  confirmed?: number | null;
  refuted?: number | null;
  inconclusive?: number | null;
  claimed_saving_min?: number | null;
}

export interface ChallengerLifetime {
  runs?: number | null;
  episodes?: number | null;
  graded?: number | null;
  confirmed?: number | null;
  refuted?: number | null;
  hit_rate?: number | null;
}

export interface ChallengerQuestion {
  code: string;
  tag: string;
  asks?: string | null;
  lever?: string | null;
  run?: ChallengerRunStats | null;
  lifetime?: ChallengerLifetime | null;
}

export interface ChallengerEpisode {
  finding_id: number;
  tag: string;
  question: string;
  grade?: string | null;
  stall?: string | null;
  car?: string | null;
  car_soc?: number | null;
  cars_waiting?: number | null;
  longest_wait_min?: number | null;
  peak?: Record<string, unknown> | null;
  claim?: string | null;
  beneficiary?: string | null;
  realized?: Record<string, unknown> | null;
  first_seen_sim?: string | null;
  last_seen_sim?: string | null;
  closed_sim?: string | null;
  scans_seen?: number | null;
}

export interface ChallengerBoard {
  contract?: string;
  run?: {
    sim_run_id?: string | null;
    status?: string | null;
    run_by?: string | null;
    sim_clock?: string | null;
    sim_start?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
  } | null;
  scanner?: { job?: string; cadence?: string; active?: boolean | null; changes_the_engine?: boolean } | null;
  questions?: ChallengerQuestion[] | null;
  open?: ChallengerEpisode[] | null;
  graded?: ChallengerEpisode[] | null;
}

// ── the learner ──────────────────────────────────────────────────────────────

export interface LearningPairs {
  recorded?: number | null;
  counted?: number | null;
  invalid?: number | null;
  stale_engine?: number | null;
}

export interface LearningReads {
  witnessed?: number | null;
  unread?: number | null;
  unmeasured?: number | null;
}

export interface LearningPrimary {
  metric?: string | null;
  better?: string | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  p_treatment?: number | null;
  p_control?: number | null;
  mean_gain_pct?: number | null;
}

export interface LearningLastPair {
  pair_id?: number | null;
  ran_at?: string | null;
  complete?: boolean | null;
  world_identical?: boolean | null;
  both_paid_shield?: boolean | null;
  moved?: string[] | null;
  dial_read_control?: boolean | null;
  dial_read_treatment?: boolean | null;
  control?: number | null;
  treatment?: number | null;
  wall_s?: number | null;
  arm_error?: string | null;
}

export interface LearningExperiment {
  experiment_id: string;
  param_key: string;
  control?: number | null;
  treatment?: number | null;
  scenario?: string | null;
  primary_metric?: string | null;
  primary_better?: string | null;
  first_look_pairs?: number | null;
  final_look_pairs?: number | null;
  status?: string | null;
  run_after?: string | null;
  concluded_at?: string | null;
  hypothesis?: string | null;
  pairs?: LearningPairs | null;
  outcome?: string | null;
  terminal?: boolean | null;
  why?: string | null;
  primary?: LearningPrimary | null;
  dial_reads?: LearningReads | null;
  breached?: string[] | null;
  promotion?: { outcome?: string | null; reason?: string | null; from?: number | null; to?: number | null } | null;
  last_pair?: LearningLastPair | null;
}

export interface LearningPromotion {
  promotion_id: number;
  param_key: string;
  from?: number | null;
  to?: number | null;
  outcome?: string | null;
  reason?: string | null;
  at?: string | null;
}

export interface LearningBoard {
  contract?: string;
  dial_floor?: string | null;
  runner?: {
    enabled?: boolean | null;
    cadence?: string | null;
    window_jobs?: { job: string; schedule_utc: string; active: boolean }[] | null;
  } | null;
  experiments?: LearningExperiment[] | null;
  promotions?: LearningPromotion[] | null;
}

// ── small, honest helpers ────────────────────────────────────────────────────

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const human = (s: string | null | undefined): string => (s ? s.replace(/_/g, ' ') : '');

/** A sim or wall timestamp as Central time, e.g. "2:05 PM CT". Null in, null out. */
export function clockCT(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })} CT`;
}

/** A timestamp with its day, for anything that may not be today, e.g. "Sep 28, 7:00 PM CT". */
export function dayClockCT(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT`;
}

const minutes = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : `${Math.round(n)} min`;
};

// ── challenger formatters ────────────────────────────────────────────────────

/** A graded claim, from the operator's side: CONFIRMED means the challenger was right and the depot left something on
 *  the table, so it is the one that warns. REFUTED means the engine's decision held up. */
export function gradeTone(grade: string | null | undefined): LoopTone {
  if (grade === 'confirmed') return 'warn';
  if (grade === 'refuted') return 'ok';
  if (grade === 'inconclusive') return 'idle';
  return 'info';
}

export function gradeLabel(grade: string | null | undefined): string {
  if (grade === 'confirmed') return 'confirmed: a real gain missed';
  if (grade === 'refuted') return 'refuted: the engine was right';
  if (grade === 'inconclusive') return 'inconclusive';
  return 'open';
}

/** One episode in words: what the challenger saw when it raised the question. */
export function episodeText(ep: ChallengerEpisode): string {
  const stall = ep.stall ?? 'a charger';
  const waiting = num(ep.cars_waiting);
  const longest = minutes(ep.longest_wait_min);
  const waitClause =
    waiting === null ? '' : ` while ${waiting} car${waiting === 1 ? ' waits' : 's wait'}${longest ? ` (longest ${longest})` : ''}`;
  if (ep.question === 'charging_above_floor_while_cars_wait') {
    const soc = num(ep.car_soc);
    return `${ep.car ?? 'A car'} still charging on ${stall}${soc === null ? '' : ` at ${Math.round(soc)}%`}, past the deploy floor,${waitClause}`;
  }
  if (ep.question === 'charger_offerable_while_cars_wait') {
    return `${stall} free by every gate${ep.beneficiary ? ` while ${ep.beneficiary} waits` : ''}${
      waiting === null ? '' : ` (${waiting} waiting${longest ? `, longest ${longest}` : ''})`
    }`;
  }
  if (ep.question === 'charger_faulted_while_cars_wait') {
    return `${stall} faulted${waitClause}`;
  }
  return `${human(ep.question)} on ${stall}`;
}

/** What happened, read when the episode closed. Only the measured fields, in words. */
export function realizedText(ep: ChallengerEpisode): string | null {
  const r = ep.realized ?? null;
  if (!r) return null;
  if (ep.question === 'charging_above_floor_while_cars_wait') {
    const ran = minutes(r.minutes_charged_after_first_sight);
    const saving = minutes(r.saving_min);
    const parts = [
      ran ? `charged ${ran} more` : null,
      r.beneficiary_still_waiting === true ? 'the next car was still waiting' : minutes(r.beneficiary_waited_after_min) ? `the next car waited ${minutes(r.beneficiary_waited_after_min)} more` : null,
      saving ? `claimed saving ${saving}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }
  if (ep.question === 'charger_offerable_while_cars_wait') {
    const free = minutes(r.free_for_min_at_least);
    const after = minutes(r.beneficiary_waited_after_min);
    const parts = [free ? `free at least ${free}` : null, after ? `the car waited ${after} more` : null].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }
  const faulted = minutes(r.faulted_while_waiting_min_at_least);
  return faulted ? `faulted at least ${faulted} while cars waited` : null;
}

/** A question's record across every run it has been asked of. */
export function hitRateText(l: ChallengerLifetime | null | undefined): string | null {
  const graded = num(l?.confirmed) !== null && num(l?.refuted) !== null ? (l!.confirmed as number) + (l!.refuted as number) : null;
  if (!l || graded === null || graded === 0) return null;
  const rate = num(l.hit_rate);
  return `right ${l.confirmed} of ${graded} graded${rate === null ? '' : ` (${Math.round(rate * 100)}%)`} across ${num(l.runs) ?? 0} run${num(l.runs) === 1 ? '' : 's'}`;
}

// ── learner formatters ───────────────────────────────────────────────────────

const OUTCOME: Record<string, { label: string; tone: LoopTone }> = {
  collecting: { label: 'collecting pairs', tone: 'info' },
  treatment_wins: { label: 'treatment wins', tone: 'ok' },
  control_holds: { label: 'control holds', tone: 'idle' },
  no_effect: { label: 'no effect', tone: 'idle' },
  negligible_effect: { label: 'negligible effect', tone: 'idle' },
  inconclusive: { label: 'inconclusive', tone: 'idle' },
  guardrail_breach: { label: 'wins, but breaches a guardrail', tone: 'warn' },
  safety_regression: { label: 'safety regression', tone: 'bad' },
  dial_not_read: { label: 'dial not read', tone: 'bad' },
  engine_error: { label: 'engine error in an arm', tone: 'bad' },
  abandoned_uninformative: { label: 'abandoned: uninformative', tone: 'idle' },
};

export function outcomeLabel(outcome: string | null | undefined): string {
  return (outcome && OUTCOME[outcome]?.label) || human(outcome) || 'unknown';
}

export function outcomeTone(outcome: string | null | undefined): LoopTone {
  return (outcome && OUTCOME[outcome]?.tone) || 'idle';
}

/** Progress to the next look: counted pairs against the first look, then the final one. */
export function pairsProgress(e: LearningExperiment): { counted: number; needed: number; pct: number; label: string } {
  const counted = num(e.pairs?.counted) ?? 0;
  const first = num(e.first_look_pairs) ?? 6;
  const final = num(e.final_look_pairs) ?? 12;
  const needed = counted < first ? first : final;
  const pct = Math.max(0, Math.min(100, Math.round((counted / needed) * 100)));
  return { counted, needed, pct, label: `${counted} of ${needed} pairs for the ${counted < first ? 'first' : 'final'} look` };
}

/** The read witness (0533): whether both arms actually read the dial they were given. */
export function dialReadText(r: LearningReads | null | undefined): { text: string; tone: LoopTone } | null {
  if (!r) return null;
  const w = num(r.witnessed) ?? 0;
  const u = num(r.unread) ?? 0;
  const m = num(r.unmeasured) ?? 0;
  if (w + u + m === 0) return null;
  if (u > 0) return { text: `the arms never read the dial in ${u} pair${u === 1 ? '' : 's'}`, tone: 'bad' };
  if (w > 0) return { text: `both arms read the dial in ${w} of ${w + m} pair${w + m === 1 ? '' : 's'}`, tone: 'ok' };
  return { text: `${m} pair${m === 1 ? '' : 's'} ran before the read witness`, tone: 'idle' };
}

export function dialText(e: LearningExperiment): string {
  return `${human(e.param_key)}: ${num(e.control) ?? '?'} → ${num(e.treatment) ?? '?'}`;
}

/** The primary metric's last pair, control against treatment, as measured. A pair run before the dial floor (the
 *  engine's last change, board.dial_floor) is still shown, and said not to count: the verdict ignores it. */
export function lastPairText(e: LearningExperiment, floor?: string | null): string | null {
  const p = e.last_pair;
  if (!p) return null;
  const stale = floor && p.ran_at && Date.parse(p.ran_at) < Date.parse(floor) ? ' · before the engine last changed, not counted' : '';
  if (p.arm_error) return `last pair failed in an arm: ${p.arm_error}${stale}`;
  const c = num(p.control);
  const t = num(p.treatment);
  if (c === null || t === null) return null;
  const moved = Array.isArray(p.moved) ? p.moved.length : null;
  return `last pair: ${human(e.primary_metric)} ${c} control vs ${t} treatment${moved === null ? '' : moved === 0 ? ' · arms identical' : ` · ${moved} atoms moved`}${stale}`;
}

/** The next time a cron schedule of the two shapes the window uses fires: "M H * * *" daily, "M H D Mo *" once. UTC. */
export function nextCronUTC(schedule: string, now: Date = new Date()): Date | null {
  const f = schedule.trim().split(/\s+/);
  if (f.length !== 5 || f[4] !== '*') return null;
  const [mi, hr, dom, mon] = [Number(f[0]), Number(f[1]), f[2], f[3]];
  if (!Number.isInteger(mi) || !Number.isInteger(hr)) return null;
  if (dom === '*' && mon === '*') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hr, mi));
    if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const day = Number(dom);
  const month = Number(mon);
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, month - 1, day, hr, mi));
    if (d.getTime() > now.getTime()) return d;
  }
  return null;
}

/** When the experiments next run, in Central time, from the window's own cron jobs. */
export function windowText(board: LearningBoard | null | undefined, now: Date = new Date()): string | null {
  const jobs = board?.runner?.window_jobs ?? [];
  if (board?.runner?.enabled) return 'running now: one pair every 10 minutes between runs';
  const opens = jobs
    .filter((j) => j.active && j.job.includes('open'))
    .map((j) => nextCronUTC(j.schedule_utc, now))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const close = jobs.find((j) => j.active && j.job.includes('close'));
  const closeAt = close ? nextCronUTC(close.schedule_utc, opens[0] ?? now) : null;
  if (opens.length === 0) return 'no window scheduled';
  return `next window ${clockCT(opens[0].toISOString())}${closeAt ? ` – ${clockCT(closeAt.toISOString())}` : ''}`;
}
