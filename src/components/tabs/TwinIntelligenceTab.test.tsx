// ============================================================================
// TwinIntelligenceTab.test.tsx — the panel renders the real wire shape.
//
// The fixture below is not hand-drawn. It is the verbatim payload of
//   SELECT public.ottoq_intelligence_stack(
//            'dde654cc-b734-4c75-a401-0358f4e02d2d', false)
// on gxdrcyphqjzjsuhxuqtg at 2026-09-19 — the first armed run to reach
// completion after the Twin start door was opened (0344/0345/0347/0348). The
// point of this file is that the PANEL renders what the engine returns, not
// that a mock renders.
//
// What is asserted, and why each one is a defect we have actually shipped
// before somewhere in this codebase:
//
//  1. All five layers draw, in signal order — a stack drawn out of order tells
//     the wrong story about who decides.
//  2. The amber states stay amber. This run is armed 7/7 AND its rank-0
//     proposer never fired; a panel that renders that green is the 0349 bug in
//     a new surface.
//  3. Provenance is on screen. Every card names the table it was measured from,
//     because a number an auditor cannot trace is a number they will not accept.
//  4. The unflattering findings are rendered, not buried: 55 of 166 agent calls
//     over one tick, 20 of 45 proposals refused.
// ============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { IntelligenceStack } from '@/lib/intelligenceStack';

// The hook talks to Supabase; the panel under test does not need to.
const state = {
  stack: null as IntelligenceStack | null,
  frame: null as Record<string, unknown> | null,
  error: null as string | null,
  loading: false,
  frameLoading: false,
  loadFrame: vi.fn(),
  simRunId: null as string | null,
};
vi.mock('@/hooks/useIntelligenceStack', () => ({
  useIntelligenceStack: () => state,
}));

const { TwinIntelligenceTab } = await import('./TwinIntelligenceTab');

// --- captured verbatim from ottoq_intelligence_stack, run dde654cc ----------
const LIVE: IntelligenceStack = {
  run: {
    tick: 1112,
    run_by: 'operator_demo',
    status: 'completed',
    speed_x: 8.0,
    scenario: 'busy_day',
    sim_clock: '2026-09-19T22:56:14.524648+00:00',
    sim_run_id: 'dde654cc-b734-4c75-a401-0358f4e02d2d',
    started_at: '2026-09-19T17:09:00.099332+00:00',
  },
  frame: null,
  frame_included: false,
  arming: {
    run_by: 'operator_demo',
    missing: [],
    verdict: 'armed_primary_unreachable',
    required: 7,
    satisfied: 7,
    primary_proposer: {
      fires: 0,
      failed: 0,
      declared: 'forward_lex',
      fell_back: 166,
      reachable: false,
      last_reason: 'CP-SAT service is not configured',
      agent_chains: 166,
      min_chains_to_judge: 3,
    },
  },
  layers: [
    {
      layer: 'L0_INGRESS',
      name: 'Asset telemetry',
      does: 'What the assets pushed. One writer, so a real OEM feed swaps in unchanged.',
      measured_from: 'ottoq_telemetry_packets',
      status: 'degraded',
      live: {
        dropped: 523,
        packets: 16771,
        integrity: { full: 14243, dropped: 523, partial: 2005 },
        signal_below_50pct: 1920,
        vehicles_reporting: 112,
      },
    },
    {
      layer: 'L1_SHIELD',
      name: 'Deterministic rules (L1)',
      does: 'Defines which actions are FEASIBLE. Not part of the policy; part of the problem.',
      measured_from: 'ottoq_rule_evaluations',
      status: 'ok',
      live: {
        blocked: 1533,
        overridden: 0,
        evaluations: 177179,
        by_probe_point: {
          task_start: 167518,
          redeployment: 7140,
          bess_dispatch: 401,
          stall_assignment: 2120,
        },
        distinct_rules: 20,
        top_blocking_rules: {
          'HW.005.vehicle_one_active_task': 479,
          'SLA.004.required_services_complete': 1054,
        },
      },
    },
    {
      layer: 'L2_AGENT',
      name: 'Orchestrator agent',
      does: 'Reads the frame, picks an objective, writes bounded policy. Proposes; never disposes.',
      measured_from: 'ottoq_decisions (resolved_action_context=orchestrator_agent)',
      status: 'ok',
      live: {
        model: 'nvidia/nemotron-3-ultra-550b-a55b',
        chains: 166,
        handoff: { 'fallback -> cuopt': 166 },
        by_source: { nemotron: 164, deterministic_fallback: 2 },
        objective: 'readiness_first',
        objective_why:
          '105 readiness_check + 65 charge atoms dominate pending work; 21 immediate_dispatch visits need rapid service; BESS at 14.2% SoC requires energy conservation',
        over_one_tick: 55,
        avg_latency_ms: 27179,
        max_latency_ms: 117719,
        last_fallback_reason: 'CP-SAT service is not configured',
      },
    },
    {
      layer: 'L3_SOLVER',
      name: 'Proposers',
      does: 'CP-SAT inside the site, cuOpt between sites. Nondeterministic by nature, which is why L4 exists.',
      measured_from: 'ottoq_intelligence_ledger (evidence class) + ottoq_proposer_fire_log',
      status: 'primary_unreachable',
      live: {
        providers: {
          nvidia_cuopt: { calls: 532, last_call: '2026-09-19T18:12:34.437521+00:00', proposals: 2781 },
          cpsat_service: { calls: 41, last_call: '2026-09-14T09:23:39.789+00:00', proposals: 0 },
          nvidia_nemotron: { calls: 1284, last_call: '2026-09-19T18:19:57.227973+00:00', proposals: 0 },
        },
        primary_fires: 0,
        fires_this_run: 0,
        declared_primary: 'forward_lex',
        primary_reachable: false,
      },
    },
    {
      layer: 'L4_KERNEL',
      name: 'Deterministic disposal',
      does: 'Disposes every proposal. Refusing some is the point: all-enacted is a rubber stamp.',
      measured_from: 'ottoq_external_proposals',
      status: 'ok',
      live: {
        enacted: 21,
        expired: 0,
        refused: 20,
        proposals: 45,
        superseded: 4,
        by_source_status: {
          'cuopt/enacted': 21,
          'cuopt/refused': 20,
          'cuopt/superseded': 2,
          'ottoq_service_priority/superseded': 2,
        },
        refusal_rate_pct: 44,
        top_refusal_reasons: {
          stall_occupied: 4,
          stall_reserved: 16,
          newer_proposal_same_entity: 1,
          entity_decided_by_other_proposal: 3,
        },
      },
    },
  ],
};

const mount = (over: Partial<typeof state> = {}) => {
  Object.assign(state, {
    stack: null,
    frame: null,
    error: null,
    loading: false,
    frameLoading: false,
    simRunId: null,
    ...over,
  });
  return render(<TwinIntelligenceTab />);
};

afterEach(cleanup);

describe('TwinIntelligenceTab with no run', () => {
  it('says no run instead of drawing five empty cards', () => {
    mount();
    expect(screen.getByText(/No simulation is active/i)).toBeTruthy();
    expect(screen.queryByText('Asset telemetry')).toBeNull();
  });

  it('shows a spinner while the first read is in flight', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, loading: true });
    expect(screen.getByText(/Reading the intelligence stack/i)).toBeTruthy();
  });
});

describe('TwinIntelligenceTab on the live run dde654cc', () => {
  it('draws all five layers in signal order', () => {
    const { container } = mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE });
    const codes = Array.from(container.querySelectorAll('span'))
      .map((n) => n.textContent ?? '')
      .filter((t) => /^L\d_[A-Z]+$/.test(t));
    expect(codes).toEqual(['L0_INGRESS', 'L1_SHIELD', 'L2_AGENT', 'L3_SOLVER', 'L4_KERNEL']);
  });

  it('names the table behind every card', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE });
    for (const table of [
      'ottoq_telemetry_packets',
      'ottoq_rule_evaluations',
      'ottoq_external_proposals',
    ]) {
      expect(screen.getByText(new RegExp(`measured from ${table}`))).toBeTruthy();
    }
  });

  it('renders the headline figures the migration re-derives', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE });
    expect(screen.getByText(/177,179 evaluations · 1,533 blocked · 20 rules/)).toBeTruthy();
    expect(screen.getByText(/16,771 packets · 112 assets reporting · 523 dropped/)).toBeTruthy();
    expect(screen.getByText(/45 proposals · 21 enacted · 20 refused · 44% refusal/)).toBeTruthy();
  });

  it('shows the agent reasoning in the agent’s own words', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE });
    expect(screen.getByText(/BESS at 14\.2% SoC requires energy conservation/)).toBeTruthy();
    expect(screen.getByText('nvidia/nemotron-3-ultra-550b-a55b')).toBeTruthy();
  });

  // THE 0349 REGRESSION, in the UI. This run is armed 7 of 7 and its rank-0
  // proposer never fired once. Both facts must be on screen together.
  it('prints the unreachable primary beside the armed verdict', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE });
    expect(screen.getByText('armed primary unreachable')).toBeTruthy();
    expect(screen.getByText(/arming 7\/7 dials set/)).toBeTruthy();
    expect(screen.getByText(/is unreachable: 0 fires against 166 fall-backs over 166 chains/)).toBeTruthy();
    expect(screen.getByText(/CP-SAT service is not configured/)).toBeTruthy();
  });

  it('does not bury the agent running behind the tick', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE });
    expect(
      screen.getByText(/55 of 166 agent calls took longer than one tick/),
    ).toBeTruthy();
    expect(screen.getByText(/2 chains fell back to the deterministic path/)).toBeTruthy();
  });

  it('labels each provider from the evidence ledger without renaming one', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE });
    expect(screen.getByText('cuOpt')).toBeTruthy();
    expect(screen.getByText('CP-SAT')).toBeTruthy();
    expect(screen.getByText('Nemotron')).toBeTruthy();
    expect(screen.getByText(/532 calls · 2,781 proposals/)).toBeTruthy();
    // CP-SAT made 41 calls and returned nothing. "41 calls" alone, never a
    // proposal count it did not produce.
    expect(screen.getByText(/^41 calls · last/)).toBeTruthy();
  });

  it('surfaces a read failure rather than showing stale numbers as current', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE, error: 'statement timeout' });
    expect(screen.getByText(/stack read failed: statement timeout/)).toBeTruthy();
  });
});

describe('TwinIntelligenceTab with a partial payload', () => {
  it('draws a layer whose live block is absent without inventing zeros', () => {
    const thin: IntelligenceStack = {
      run: LIVE.run,
      arming: null,
      layers: [{ ...LIVE.layers![0], status: 'unknown', live: null }],
    };
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: thin });
    expect(screen.getByText('Asset telemetry')).toBeTruthy();
    expect(screen.getByText('no measurement')).toBeTruthy();
    // The provenance line still names its table — that is the point of it. What
    // must be absent is any METRIC: no row labels, and no digits standing in for
    // a count the engine did not return.
    expect(screen.queryByText('packets')).toBeNull();
    expect(screen.queryByText('assets reporting')).toBeNull();
    expect(screen.queryByText('dropped')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('says so when the stack returns no layers at all', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: { run: LIVE.run, layers: [] } });
    expect(screen.getByText(/returned no layers for this run/i)).toBeTruthy();
  });
});
