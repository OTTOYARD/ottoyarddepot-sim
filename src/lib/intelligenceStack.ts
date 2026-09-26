// ============================================================================
// intelligenceStack — the typed shape of otto-q-core's ottoq_intelligence_stack
// plus the pure formatters the Intelligence panel renders it with.
//
// Data contract: otto-q-core migration
//   0351_the_intelligence_layers_are_real_and_nothing_assembles_them_into_a_stack.sql
//     public.ottoq_intelligence_stack(p_sim_run_id uuid,
//                                     p_include_frame boolean DEFAULT true)
//
// Five layers in SIGNAL ORDER, which is the order the panel draws them:
//
//   L0_INGRESS  what the assets pushed          ottoq_telemetry_packets
//   L1_SHIELD   which actions are feasible      ottoq_rule_evaluations
//   L2_AGENT    reads frame, picks objective    ottoq_decisions
//   L3_SOLVER   proposes                        ottoq_model_call_ledger (this run)
//   L4_KERNEL   disposes                        ottoq_external_proposals
//
// THE ONE RULE IN THIS FILE, and it is the same rule otto-q-core 0346 taught
// the Decisions strip: render what the engine measured, and never fill a gap
// with a name or a zero. A missing metric renders as missing. That is why every
// formatter here returns `null` rather than a placeholder, and why
// layerHeadline() on an empty payload says "no measurement" instead of "0".
// A panel that invents a zero is indistinguishable from one reporting a real
// zero, and an auditor cannot tell them apart either.
// ============================================================================
import { modelErrorText } from "@/lib/decisionText";

/** One layer of the stack, exactly as the RPC returns it. */
export interface StackLayer {
  layer: string;
  name: string;
  does: string;
  measured_from: string;
  status: string;
  live: Record<string, unknown> | null;
}

export interface StackArmingPrimary {
  declared?: string | null;
  reachable?: boolean | null;
  fires?: number | null;
  fell_back?: number | null;
  failed?: number | null;
  agent_chains?: number | null;
  min_chains_to_judge?: number | null;
  last_reason?: string | null;
  judged_on?: string | null;
}

export interface StackArming {
  verdict?: string | null;
  required?: number | null;
  satisfied?: number | null;
  missing?: string[] | null;
  run_by?: string | null;
  primary_proposer?: StackArmingPrimary | null;
}

export interface StackRun {
  sim_run_id?: string | null;
  scenario?: string | null;
  status?: string | null;
  tick?: number | null;
  speed_x?: number | null;
  run_by?: string | null;
  sim_clock?: string | null;
  started_at?: string | null;
}

export interface StackReview {
  verdict?: string | null;
  now_tick?: number | null;
  since_tick?: number | null;
  chains_examined?: number | null;
  totals?: Record<string, number> | null;
  chains?: unknown[] | null;
}

export interface IntelligenceStack {
  run?: StackRun | null;
  arming?: StackArming | null;
  review?: StackReview | null;
  layers?: StackLayer[] | null;
  frame?: Record<string, unknown> | null;
  frame_included?: boolean | null;
}

// ---------------------------------------------------------------------------
// Provider names. Shared with the Decisions strip via PROVIDER_LABEL there —
// intelligenceStack.test.ts asserts the two maps agree so they cannot drift.
// ---------------------------------------------------------------------------
export const STACK_PROVIDER_LABEL: Record<string, string> = {
  nvidia_cuopt: 'cuOpt',
  nvidia_nemotron: 'Nemotron',
  cpsat_service: 'CP-SAT',
  anthropic_advisor: 'Advisor',
  local_fallback: 'local fallback',
};

/** A provider key we have no display name for renders as itself, never as a guess. */
export function providerLabel(key: string): string {
  return STACK_PROVIDER_LABEL[key] ?? key;
}

// ---------------------------------------------------------------------------
// Status tone. `primary_unreachable` is deliberately a WARNING and not an ok:
// otto-q-core 0349 exists because a run reported "armed, 7 of 7" while its
// rank-0 proposer had never once fired. Green on that state is the bug.
//
// THE LIST IS THE COMPLETE SET THE CURRENT FUNCTION EMITS (otto-q-core 0451 +
// 0456), taken from its CASE expressions, and every one is classified
// deliberately. A status missing from this map once rendered `permissive` grey:
//
//   degraded            L0  dropped packets                              WARN
//   model_unavailable   L2  the latest agent pass fell back (G188)       WARN
//   primary_unreachable L3  rank-0 proposer measured unreachable         WARN
//   refusing_all        L4  every offer the kernel saw, it refused       WARN
//   none_enacted        L4  offers, none enacted (refused or superseded) WARN
//   abstaining          L4  the proposer declined everything, offered 0  idle
//   primary_idle        L3  no fires yet, reachability still unknown     idle
//   inactive            L*  the layer has no activity at all             idle
//
// RETIRED, still classified so an older payload renders sanely:
//   degraded_latency  (0451: the tick never waits on the agent, 0332)
//   permissive        (0451: L1 counts refusals from the effect view)
//
// `abstaining`, `primary_idle` and `inactive` stay neutral on purpose: each
// means "nothing to judge yet", which is 0349's three-valued lesson. An UNKNOWN
// status also stays neutral rather than amber, and the card prints its raw
// text either way. intelligenceStack.test.ts asserts this map covers the list.
// ---------------------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

/** Every status `ottoq_intelligence_stack` can emit, per otto-q-core 0451 and 0456. */
export const STACK_STATUSES = [
  'ok',
  'degraded',
  'model_unavailable',
  'primary_unreachable',
  'primary_idle',
  'refusing_all',
  'none_enacted',
  'abstaining',
  'inactive',
] as const;

export function statusTone(status: string | null | undefined): Tone {
  switch ((status ?? '').trim()) {
    case 'ok':
      return 'ok';
    case 'degraded':
    case 'model_unavailable':
    case 'primary_unreachable':
    case 'refusing_all':
    case 'none_enacted':
    case 'partial':
    case 'degraded_latency': // retired by 0451; kept so an old payload does not render as "no data"
    case 'permissive': // retired by 0451; same
      return 'warn';
    case 'unreachable':
    case 'failed':
    case 'unarmed':
      return 'bad';
    // 'abstaining', 'primary_idle' and 'inactive' fall through to idle deliberately — see above.
    default:
      return 'idle';
  }
}

export function armingTone(verdict: string | null | undefined): Tone {
  switch ((verdict ?? '').trim()) {
    case 'armed':
      return 'ok';
    case 'armed_primary_unreachable':
    case 'partial':
      return 'warn';
    case 'unarmed':
      return 'bad';
    default:
      return 'idle';
  }
}

/** Underscored engine vocabulary, made readable without changing a word of it. */
export function humanize(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  return raw ? raw.replace(/_/g, ' ') : null;
}

// ---------------------------------------------------------------------------
// Scalar formatters. Every one returns null for an absent value so a caller
// cannot accidentally print "0" or "NaN" where the engine measured nothing.
// ---------------------------------------------------------------------------
export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatCount(value: unknown): string | null {
  const n = num(value);
  return n === null ? null : n.toLocaleString('en-US');
}

/** Milliseconds as an operator reads them: 840ms, 27.2s, 118s. */
export function formatMs(value: unknown): string | null {
  const ms = num(value);
  if (ms === null) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 100 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function formatPct(value: unknown, digits = 0): string | null {
  const n = num(value);
  return n === null ? null : `${n.toFixed(digits)}%`;
}

/** UTC timestamp -> Chase's clock. Reporting only; storage stays UTC. */
export function formatClockCT(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  })} CT`;
}

/**
 * The n largest entries of a counter object, descending. Ties break on key so
 * the panel is stable between polls rather than reshuffling under the eye.
 */
export function topEntries(
  value: unknown,
  limit = 3,
): Array<{ key: string; count: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => ({ key, count: num(raw) }))
    .filter((e): e is { key: string; count: number } => e.count !== null)
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Headlines. One line per layer, the sentence an operator or an auditor reads
// first. Each is assembled ONLY from keys the payload actually carries; a layer
// with no recognised metric says so.
// ---------------------------------------------------------------------------
const NO_MEASUREMENT = 'no measurement';

function join(parts: Array<string | null>): string {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? kept.join(' · ') : NO_MEASUREMENT;
}

export function layerHeadline(layer: Pick<StackLayer, 'layer' | 'live'>): string {
  const live = layer.live;
  if (!live || typeof live !== 'object') return NO_MEASUREMENT;
  const c = (key: string) => formatCount(live[key]);

  switch (layer.layer) {
    case 'L0_INGRESS':
      return join([
        c('packets') && `${c('packets')} packets`,
        c('vehicles_reporting') && `${c('vehicles_reporting')} assets reporting`,
        num(live.dropped) ? `${c('dropped')} dropped` : null,
      ]);
    case 'L1_SHIELD':
      // 0451: `blocked` is what the engine REFUSED (0430's effect view). A failed advisory
      // verdict is recorded, not refused, so the two are printed apart.
      return join([
        c('evaluations') && `${c('evaluations')} evaluations`,
        // `refused` only: the 0351 payload's `blocked` counted FAILURES, so reading it as refusals would
        // repeat the exact mislabel 0451 removed.
        c('refused') && `${c('refused')} refused`,
        c('failed') && `${c('failed')} failed`,
        c('distinct_rules') && `${c('distinct_rules')} rules`,
      ]);
    case 'L2_AGENT': {
      const answered = num((live.by_source as Record<string, unknown> | null)?.nemotron);
      return join([
        c('chains') && `${c('chains')} passes`,
        answered !== null ? `${formatCount(answered)} answered by the model` : null,
        num(live.model_fallbacks) ? `${c('model_fallbacks')} fell back` : null,
      ]);
    }
    case 'L3_SOLVER': {
      const providers = Object.entries(
        (live.providers as Record<string, Record<string, unknown>> | null) ?? {},
      ).sort(([a], [b]) => a.localeCompare(b));
      return join([
        providers.length
          ? providers
              .map(([k, p]) =>
                [
                  `${providerLabel(k)} ${formatCount(p?.calls) ?? '—'} calls`,
                  num(p?.answered) !== null ? `${formatCount(p?.answered)} answered` : null,
                ].filter(Boolean).join(', '))
              .join(' · ')
          : null,
        live.primary_reachable === false
          ? `primary ${humanize(String(live.declared_primary ?? 'proposer'))} unreachable`
          : null,
      ]);
    }
    case 'L4_KERNEL':
      // 0456: proposals are OFFERS; the proposer's abstentions are counted apart.
      return join([
        c('proposals') && `${c('proposals')} offers`,
        c('enacted') && `${c('enacted')} enacted`,
        num(live.refused) !== null ? `${c('refused')} refused` : null,
        num(live.superseded) ? `${c('superseded')} superseded` : null,
        num(live.abstentions) ? `${c('abstentions')} abstentions` : null,
      ]);
    default:
      return NO_MEASUREMENT;
  }
}

/**
 * The findings a panel must not bury. Each returns a sentence only when the
 * measurement supports it — there is no "all clear" string to fabricate.
 *
 *  - L1: a would-block verdict an advisory caller ignored is recorded, not refused (0430).
 *  - L2: fallbacks with the endpoint's own error (G188), and how stale applied advice is.
 *    The old "N calls took longer than one tick" line is RETRACTED: the tick fires the
 *    agent with pg_net and never waits for it (otto-q-core 0332).
 *  - L3, 0349: a declared rank-0 proposer that has never fired.
 *  - L4: offers none of which were enacted, and what the proposer declined (0456).
 */
export function layerCaveats(layer: Pick<StackLayer, 'layer' | 'live'>): string[] {
  const live = layer.live;
  if (!live || typeof live !== 'object') return [];
  const out: string[] = [];

  if (layer.layer === 'L0_INGRESS') {
    const below = num(live.signal_below_50pct);
    if (below) out.push(`${formatCount(below)} packets arrived below 50% signal`);
  }

  if (layer.layer === 'L1_SHIELD') {
    const recorded = num(live.recorded_only);
    if (recorded) {
      out.push(`${formatCount(recorded)} would-block verdicts came from advisory checkpoints: recorded, not refused`);
    }
  }

  if (layer.layer === 'L2_AGENT') {
    const fallbacks = num(live.model_fallbacks);
    const chains = num(live.chains);
    if (fallbacks && chains) {
      const lastErr = modelErrorText(live.last_model_error);
      const err = lastErr ? ` Last model error: ${lastErr}.` : '';
      out.push(`${formatCount(fallbacks)} of ${formatCount(chains)} passes fell back to the deterministic path.${err}`);
    }
    const mean = num(live.advice_mean_ticks_late);
    if (mean !== null && num(live.advice_applied)) {
      const p95 = num(live.advice_p95_ticks_late);
      out.push(
        `advice is applied a mean of ${mean} ticks after it was computed` +
          (p95 !== null ? ` (p95 ${p95})` : '') +
          ' — the tick never waits for it',
      );
    }
  }

  if (layer.layer === 'L3_SOLVER' && live.primary_reachable === false) {
    const declared = humanize(String(live.declared_primary ?? '')) ?? 'the rank-0 proposer';
    out.push(`${declared} is declared primary and has fired ${formatCount(live.primary_fires) ?? '0'} times this run`);
  }

  if (layer.layer === 'L4_KERNEL') {
    const offers = num(live.proposals);
    const enacted = num(live.enacted);
    const refused = num(live.refused);
    const superseded = num(live.superseded);
    if (offers && refused === 0 && enacted === offers) {
      out.push('every offer was enacted — a kernel that refuses nothing is a rubber stamp');
    }
    if (offers && enacted === 0) {
      out.push(
        `none of ${formatCount(offers)} offers was enacted: ` +
          `${formatCount(superseded) ?? '0'} superseded by the decide path, ${formatCount(refused) ?? '0'} refused`,
      );
    }
    const top = topEntries(live.top_abstain_reasons, 1)[0];
    if (num(live.abstentions) && top) {
      out.push(`${formatCount(live.abstentions)} abstentions; most often “${top.key.trim()}” (${formatCount(top.count)})`);
    }
  }

  return out;
}

/**
 * Whether the stack is describing a run at all. Called before anything is
 * rendered so the panel says "no run" rather than drawing five empty cards.
 */
export function hasRun(stack: IntelligenceStack | null): boolean {
  return !!stack?.run?.sim_run_id;
}
