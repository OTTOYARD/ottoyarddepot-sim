// ============================================================================
// intelligenceStack.test.ts — the Intelligence panel's formatters.
//
// Every test here defends the same property: THE PANEL NEVER INVENTS. A missing
// measurement must render as missing, a warning state must never read green,
// and a provider the engine did not name must never acquire a name.
//
// The regression this file descends from is otto-q-core 0346: the Decisions
// strip COALESCEd its solver label onto a hardcoded "CP-SAT" literal, so it
// asserted CP-SAT on every line it ever rendered while CP-SAT had submitted
// nothing for five days. A panel shown to auditors is only as good as its
// refusal to fill a gap.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { PROVIDER_LABEL } from '@/components/tabs/TwinDecisionLogTab';
import {
  STACK_PROVIDER_LABEL,
  armingTone,
  formatClockCT,
  formatCount,
  formatMs,
  formatPct,
  hasRun,
  humanize,
  layerCaveats,
  layerHeadline,
  num,
  providerLabel,
  statusTone,
  topEntries,
  type StackLayer,
} from './intelligenceStack';

const layer = (overrides: Partial<StackLayer>): StackLayer => ({
  layer: 'L1_SHIELD',
  name: 'Deterministic rules (L1)',
  does: 'Defines which actions are FEASIBLE.',
  measured_from: 'ottoq_rule_evaluations',
  status: 'ok',
  live: {},
  ...overrides,
});

describe('scalar formatters return null rather than a placeholder', () => {
  it('num rejects everything that is not a finite number', () => {
    expect(num(42)).toBe(42);
    expect(num('42')).toBe(42);
    expect(num(0)).toBe(0);
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('')).toBeNull();
    expect(num('  ')).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
    expect(num({})).toBeNull();
  });

  it('formatCount groups thousands and refuses absent values', () => {
    expect(formatCount(177179)).toBe('177,179');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBeNull();
    expect(formatCount(undefined)).toBeNull();
  });

  // A real zero and an absent value must be distinguishable on screen. If
  // formatCount(null) ever returns '0' an auditor cannot tell "the shield
  // blocked nothing" from "we did not measure the shield".
  it('distinguishes a measured zero from no measurement', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).not.toBe('0');
  });

  it('formatMs scales the way an operator reads latency', () => {
    expect(formatMs(840)).toBe('840ms');
    expect(formatMs(27179)).toBe('27.2s');
    expect(formatMs(117719)).toBe('118s');
    expect(formatMs(null)).toBeNull();
  });

  it('formatPct keeps the engine digits', () => {
    expect(formatPct(44)).toBe('44%');
    expect(formatPct(44.4, 1)).toBe('44.4%');
    expect(formatPct(null)).toBeNull();
  });

  it('humanize only unscores — it never retitles', () => {
    expect(humanize('armed_primary_unreachable')).toBe('armed primary unreachable');
    expect(humanize('')).toBeNull();
    expect(humanize(null)).toBeNull();
  });

  it('formatClockCT reports Chase local time and rejects a bad stamp', () => {
    // 22:56 UTC on 2026-09-19 is 5:56 PM CT (CDT, UTC-5).
    expect(formatClockCT('2026-09-19T22:56:14.524648+00:00')).toBe('5:56 PM CT');
    expect(formatClockCT('not a date')).toBeNull();
    expect(formatClockCT(null)).toBeNull();
  });
});

describe('status tone never paints a warning green', () => {
  it('maps the states the engine actually emits', () => {
    expect(statusTone('ok')).toBe('ok');
    expect(statusTone('degraded')).toBe('warn');
    expect(statusTone('unarmed')).toBe('bad');
  });

  // THE 0349 REGRESSION. A run reported "armed, 7 of 7" while its rank-0
  // proposer had fired zero times. primary_unreachable is a warning, always.
  it('treats primary_unreachable as a warning, not a pass', () => {
    expect(statusTone('primary_unreachable')).toBe('warn');
    expect(statusTone('primary_unreachable')).not.toBe('ok');
    expect(armingTone('armed_primary_unreachable')).toBe('warn');
    expect(armingTone('armed_primary_unreachable')).not.toBe('ok');
    expect(armingTone('armed')).toBe('ok');
  });

  it('an unrecognised status is idle, never ok', () => {
    expect(statusTone('some_new_state')).toBe('idle');
    expect(statusTone(undefined)).toBe('idle');
    expect(armingTone('cert_excluded')).toBe('idle');
  });
});

describe('provider labels', () => {
  it('names the providers the evidence ledger records', () => {
    expect(providerLabel('nvidia_cuopt')).toBe('cuOpt');
    expect(providerLabel('cpsat_service')).toBe('CP-SAT');
    expect(providerLabel('nvidia_nemotron')).toBe('Nemotron');
  });

  it('passes an unknown provider through rather than guessing', () => {
    expect(providerLabel('some_new_solver')).toBe('some_new_solver');
    expect(providerLabel('some_new_solver')).not.toContain('CP-SAT');
  });

  // Two maps in one app drift. This fails the build instead of the demo.
  it('agrees with the Decisions strip map key for key', () => {
    expect(STACK_PROVIDER_LABEL).toEqual(PROVIDER_LABEL);
  });
});

describe('topEntries ranks what is there and fabricates nothing', () => {
  it('sorts descending and truncates', () => {
    expect(topEntries({ a: 1, b: 9, c: 5 }, 2)).toEqual([
      { key: 'b', count: 9 },
      { key: 'c', count: 5 },
    ]);
  });

  it('breaks ties on key so the panel does not reshuffle between polls', () => {
    expect(topEntries({ zeta: 4, alpha: 4 }, 2)).toEqual([
      { key: 'alpha', count: 4 },
      { key: 'zeta', count: 4 },
    ]);
  });

  it('drops non-numeric values instead of coercing them', () => {
    expect(topEntries({ a: 3, b: null, c: 'x' })).toEqual([{ key: 'a', count: 3 }]);
  });

  it('returns empty for anything that is not a counter object', () => {
    expect(topEntries(null)).toEqual([]);
    expect(topEntries([1, 2, 3])).toEqual([]);
    expect(topEntries('nope')).toEqual([]);
  });
});

describe('layer headlines are assembled only from measured keys', () => {
  it('reads the ingress layer', () => {
    expect(
      layerHeadline(
        layer({ layer: 'L0_INGRESS', live: { packets: 16771, vehicles_reporting: 112, dropped: 523 } }),
      ),
    ).toBe('16,771 packets · 112 assets reporting · 523 dropped');
  });

  it('reads the shield layer', () => {
    expect(
      layerHeadline(
        layer({ layer: 'L1_SHIELD', live: { evaluations: 177179, blocked: 1533, distinct_rules: 20 } }),
      ),
    ).toBe('177,179 evaluations · 1,533 blocked · 20 rules');
  });

  it('reads the agent layer including the over-a-tick count', () => {
    expect(
      layerHeadline(
        layer({ layer: 'L2_AGENT', live: { chains: 166, avg_latency_ms: 27179, over_one_tick: 55 } }),
      ),
    ).toBe('166 chains · avg 27.2s · 55 of 166 over one tick');
  });

  it('reads the solver layer from the providers it was given', () => {
    expect(
      layerHeadline(
        layer({
          layer: 'L3_SOLVER',
          live: {
            providers: { nvidia_cuopt: { calls: 532 }, cpsat_service: { calls: 41 } },
            declared_primary: 'forward_lex',
            primary_reachable: false,
          },
        }),
      ),
    ).toBe('cuOpt 532, CP-SAT 41 · primary forward lex unreachable');
  });

  it('reads the kernel layer', () => {
    expect(
      layerHeadline(
        layer({
          layer: 'L4_KERNEL',
          live: { proposals: 45, enacted: 21, refused: 20, refusal_rate_pct: 44 },
        }),
      ),
    ).toBe('45 proposals · 21 enacted · 20 refused · 44% refusal');
  });

  // THE CORE PROPERTY. No payload, no sentence. Not "0 packets", not "healthy".
  it('says no measurement rather than manufacturing zeros', () => {
    expect(layerHeadline(layer({ layer: 'L0_INGRESS', live: null }))).toBe('no measurement');
    expect(layerHeadline(layer({ layer: 'L0_INGRESS', live: {} }))).toBe('no measurement');
    expect(layerHeadline(layer({ layer: 'L4_KERNEL', live: {} }))).toBe('no measurement');
    expect(layerHeadline(layer({ layer: 'L0_INGRESS', live: {} }))).not.toContain('0');
  });

  it('omits the clauses whose keys are absent instead of zero-filling them', () => {
    expect(layerHeadline(layer({ layer: 'L1_SHIELD', live: { evaluations: 10 } }))).toBe(
      '10 evaluations',
    );
  });

  it('reports a measured zero when the engine measured zero', () => {
    expect(
      layerHeadline(layer({ layer: 'L4_KERNEL', live: { proposals: 45, refused: 0 } })),
    ).toBe('45 proposals · 0 refused');
  });

  it('a layer name it does not know gets no invented headline', () => {
    expect(layerHeadline(layer({ layer: 'L9_FUTURE', live: { anything: 1 } }))).toBe(
      'no measurement',
    );
  });
});

describe('caveats surface the findings that flatter us least', () => {
  // G62: Nemotron's mean latency exceeds the 30-second beat, which is the
  // mechanism behind every deterministic_fallback sitting beside it.
  it('says when the agent is running behind the tick', () => {
    const out = layerCaveats(
      layer({ layer: 'L2_AGENT', live: { chains: 166, over_one_tick: 55 } }),
    );
    expect(out.join(' ')).toContain('55 of 166 agent calls took longer than one tick');
  });

  it('counts the chains that fell back to the deterministic path', () => {
    const out = layerCaveats(
      layer({ layer: 'L2_AGENT', live: { chains: 166, by_source: { deterministic_fallback: 2 } } }),
    );
    expect(out.join(' ')).toContain('2 chains fell back');
  });

  it('names an unreachable rank-0 proposer on the solver card', () => {
    const out = layerCaveats(
      layer({
        layer: 'L3_SOLVER',
        live: { declared_primary: 'forward_lex', primary_reachable: false, primary_fires: 0 },
      }),
    );
    expect(out.join(' ')).toContain('forward lex is declared primary and has fired 0 times');
  });

  it('calls a kernel that refused nothing a rubber stamp', () => {
    const out = layerCaveats(layer({ layer: 'L4_KERNEL', live: { proposals: 30, refused: 0 } }));
    expect(out.join(' ')).toContain('rubber stamp');
  });

  it('stays silent when the measurement does not support a caveat', () => {
    expect(layerCaveats(layer({ layer: 'L2_AGENT', live: { chains: 166, over_one_tick: 0 } }))).toEqual([]);
    expect(layerCaveats(layer({ layer: 'L3_SOLVER', live: { primary_reachable: true } }))).toEqual([]);
    expect(layerCaveats(layer({ layer: 'L4_KERNEL', live: { proposals: 45, refused: 20 } }))).toEqual([]);
    expect(layerCaveats(layer({ layer: 'L2_AGENT', live: null }))).toEqual([]);
  });

  // reachable is three-valued in 0349: NULL means "too few chains to judge".
  // Unknown is not the same as reachable, and it is not the same as broken —
  // neither state may produce the unreachable caveat.
  it('does not claim unreachable when reachability is unknown', () => {
    expect(
      layerCaveats(layer({ layer: 'L3_SOLVER', live: { declared_primary: 'forward_lex', primary_reachable: null } })),
    ).toEqual([]);
    expect(layerCaveats(layer({ layer: 'L3_SOLVER', live: { declared_primary: 'forward_lex' } }))).toEqual([]);
  });
});

describe('hasRun gates the whole panel', () => {
  it('is false without a run id', () => {
    expect(hasRun(null)).toBe(false);
    expect(hasRun({})).toBe(false);
    expect(hasRun({ run: {} })).toBe(false);
  });

  it('is true once the stack names a run', () => {
    expect(hasRun({ run: { sim_run_id: 'dde654cc-b734-4c75-a401-0358f4e02d2d' } })).toBe(true);
  });
});
