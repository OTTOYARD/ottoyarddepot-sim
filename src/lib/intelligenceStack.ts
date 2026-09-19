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
//   L3_SOLVER   proposes                        ottoq_intelligence_ledger
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
// THIS MAP WAS INCOMPLETE WHEN FIRST SHIPPED, and a live run found it rather
// than review. `ottoq_intelligence_stack` can emit seven statuses besides `ok`;
// the first version of this function named two of them, so FOUR rendered as
// neutral grey — including `permissive`, which means the shield evaluated rules
// and blocked NOTHING. A shield that never blocks is the most important thing
// this panel can say, and it was being drawn the same colour as "no data".
//
// The list below is the complete set, taken from the CASE expressions in
// otto-q-core migration 0351. Every one is classified deliberately:
//
//   permissive         L1  evaluations > 0 and blocked = 0          WARN
//   degraded           L0  dropped packets / low signal              WARN
//   degraded_latency   L2  over half the agent chains exceed a tick  WARN
//   primary_unreachable L3 rank-0 proposer measured unreachable      WARN
//   refusing_all       L4  proposals > 0 and enacted = 0             WARN
//   primary_idle       L3  no fires yet, reachability still unknown  idle
//   inactive           L*  the layer has no activity at all          idle
//
// `primary_idle` and `inactive` stay neutral on purpose: both mean "nothing
// measured yet", which is 0349's three-valued lesson — a run that has not had
// an agent pass is never accused. An UNKNOWN status also stays neutral rather
// than amber: crying wolf on a status a future migration adds would be its own
// defect, and the card prints the raw status text either way, so an
// unclassified state is still legible. intelligenceStack.test.ts asserts this
// map covers every status in the list above, so the gap cannot recur silently.
// ---------------------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

/** Every status `ottoq_intelligence_stack` can emit, per otto-q-core 0351. */
export const STACK_STATUSES = [
  'ok',
  'degraded',
  'degraded_latency',
  'permissive',
  'primary_unreachable',
  'primary_idle',
  'refusing_all',
  'inactive',
] as const;

export function statusTone(status: string | null | undefined): Tone {
  switch ((status ?? '').trim()) {
    case 'ok':
      return 'ok';
    case 'degraded':
    case 'degraded_latency':
    case 'permissive':
    case 'primary_unreachable':
    case 'refusing_all':
    case 'partial':
      return 'warn';
    case 'unreachable':
    case 'failed':
    case 'unarmed':
      return 'bad';
    // 'primary_idle' and 'inactive' fall through to idle deliberately — see above.
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
      return join([
        c('evaluations') && `${c('evaluations')} evaluations`,
        c('blocked') && `${c('blocked')} blocked`,
        c('distinct_rules') && `${c('distinct_rules')} rules`,
      ]);
    case 'L2_AGENT':
      return join([
        c('chains') && `${c('chains')} chains`,
        formatMs(live.avg_latency_ms) && `avg ${formatMs(live.avg_latency_ms)}`,
        num(live.over_one_tick) !== null && num(live.chains) !== null
          ? `${c('over_one_tick')} of ${c('chains')} over one tick`
          : null,
      ]);
    case 'L3_SOLVER': {
      const providers = topEntries(
        Object.fromEntries(
          Object.entries(
            (live.providers as Record<string, { calls?: unknown }> | null) ?? {},
          ).map(([k, v]) => [k, v?.calls]),
        ),
        3,
      );
      return join([
        providers.length
          ? providers.map((p) => `${providerLabel(p.key)} ${p.count}`).join(', ')
          : null,
        live.primary_reachable === false
          ? `primary ${humanize(String(live.declared_primary ?? 'proposer'))} unreachable`
          : null,
      ]);
    }
    case 'L4_KERNEL':
      return join([
        c('proposals') && `${c('proposals')} proposals`,
        c('enacted') && `${c('enacted')} enacted`,
        num(live.refused) !== null ? `${c('refused')} refused` : null,
        formatPct(live.refusal_rate_pct) && `${formatPct(live.refusal_rate_pct)} refusal`,
      ]);
    default:
      return NO_MEASUREMENT;
  }
}

/**
 * The findings a panel must not bury. Each returns a sentence only when the
 * measurement supports it — there is no "all clear" string to fabricate.
 *
 *  - L2, G62: the advisory agent is on average a tick late, which is the
 *    mechanism behind every deterministic_fallback beside it.
 *  - L2, G64: an agent call carrying zero L1 rule evaluations is the one path
 *    where an AI changes engine state without the shield in front of it.
 *  - L3, 0349: a declared rank-0 proposer that has never fired.
 *  - L4: a 0% refusal rate is a rubber stamp, not a clean run.
 */
export function layerCaveats(layer: Pick<StackLayer, 'layer' | 'live'>): string[] {
  const live = layer.live;
  if (!live || typeof live !== 'object') return [];
  const out: string[] = [];

  if (layer.layer === 'L0_INGRESS') {
    const below = num(live.signal_below_50pct);
    if (below) out.push(`${formatCount(below)} packets arrived below 50% signal`);
  }

  if (layer.layer === 'L2_AGENT') {
    const over = num(live.over_one_tick);
    const chains = num(live.chains);
    if (over && chains) {
      out.push(
        `${formatCount(over)} of ${formatCount(chains)} agent calls took longer than one tick — ` +
          `an advisory agent cannot be a synchronous dependency of the beat`,
      );
    }
    const fallback = num((live.by_source as Record<string, unknown> | null)?.deterministic_fallback);
    if (fallback) {
      out.push(`${formatCount(fallback)} chains fell back to the deterministic path`);
    }
  }

  if (layer.layer === 'L3_SOLVER' && live.primary_reachable === false) {
    const declared = humanize(String(live.declared_primary ?? '')) ?? 'the rank-0 proposer';
    out.push(`${declared} is declared primary and has fired ${formatCount(live.primary_fires) ?? '0'} times this run`);
  }

  if (layer.layer === 'L4_KERNEL') {
    const proposals = num(live.proposals);
    const refused = num(live.refused);
    if (proposals && refused === 0) {
      out.push('every proposal was enacted — a kernel that refuses nothing is a rubber stamp');
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
