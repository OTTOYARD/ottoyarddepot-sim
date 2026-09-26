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
//  4. The unflattering findings are rendered, not buried.
//
// CURRENT (added 2026-09-23) is the verbatim payload of
//   SELECT public.ottoq_intelligence_stack('736406cf-05ee-448d-b529-0e04b074eddd', false) - 'frame' - 'review'
// at 2026-09-23 06:26 UTC, after otto-q-core 0451 and 0456 changed the shield, agent and kernel blocks:
// L1 publishes refusals the engine acted on beside failures, L2 publishes fallbacks and advice
// staleness instead of the retracted over-one-tick count, and L4 counts offers apart from abstentions.
// ============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IntelligenceStack } from '@/lib/intelligenceStack';

// The stream view mounts TwinDecisionLogTab, which polls ottoq_activity_feed.
// This panel's tests are about rendering, not about the network, so the client
// is stubbed. A rejecting stub would be caught by the hook and set an error
// banner; an empty page keeps the stream's empty state on screen, which is
// what the default-view test reads.
vi.mock('@/lib/ottoQClient', () => ({
  ottoQ: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
}));

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

const CURRENT: IntelligenceStack = {
  run: {
    tick: 1203, run_by: 'operator_demo', status: 'running', speed_x: 8.0, scenario: 'busy_day',
    sim_clock: '2026-09-23T18:42:47.015448+00:00',
    sim_run_id: '736406cf-05ee-448d-b529-0e04b074eddd',
    started_at: '2026-09-23T05:14:50.054098+00:00',
  },
  arming: {
    run_by: 'operator_demo', missing: [], verdict: 'armed', required: 7, satisfied: 7,
    primary_proposer: {
      fires: 167, failed: 0, declared: 'forward_lex', fell_back: 0, reachable: true,
      last_reason: null, agent_chains: 167, min_chains_to_judge: 3,
    },
  },
  layers: [
    {
      layer: 'L0_INGRESS', name: 'Asset telemetry', status: 'degraded',
      does: 'What the assets pushed. One writer, so a real OEM feed swaps in unchanged.',
      measured_from: 'ottoq_telemetry_packets',
      live: {
        dropped: 482, packets: 15359, integrity: { full: 13083, dropped: 482, partial: 1794 },
        signal_below_50pct: 1749, vehicles_reporting: 77,
      },
    },
    {
      layer: 'L1_SHIELD', name: 'Deterministic rules (L1)', status: 'ok',
      does: 'Defines which actions are FEASIBLE. Blocked counts refusals the engine acted on; a failed advisory rule is recorded, not refused.',
      measured_from: 'ottoq_rule_evaluation_effect (0430)',
      live: {
        failed: 494, blocked: 475, refused: 475, overridden: 0, evaluations: 329790, recorded_only: 19,
        by_probe_point: {
          task_start: 318240, policy_write: 18, redeployment: 1872, bess_dispatch: 244, task_completion: 2520,
          stall_assignment: 1365, bess_state_change: 58, stall_state_change: 2180, charge_session_start: 1320,
          vehicle_state_change: 1973,
        },
        distinct_rules: 26, advisory_failed: 0,
        top_failing_rules: {
          'EN.001.grid_capacity_ceiling (block)': 99,
          'HW.005.vehicle_one_active_task (block)': 161,
          'SLA.004.required_services_complete (block)': 215,
          'HW.006.physical_presence_verification (block)': 19,
        },
        top_blocking_rules: {
          'EN.001.grid_capacity_ceiling': 99,
          'HW.005.vehicle_one_active_task': 161,
          'SLA.004.required_services_complete': 215,
        },
      },
    },
    {
      layer: 'L2_AGENT', name: 'Orchestrator agent', status: 'ok',
      does: 'Reads the frame, picks an objective, writes bounded policy. Proposes; never disposes. Runs beside the tick and never holds it.',
      measured_from: 'ottoq_decisions (resolved_action_context=orchestrator_agent) + ottoq_agent_advice_provenance',
      live: {
        model: 'nvidia/nemotron-3-ultra-550b-a55b', chains: 167,
        handoff: { 'completed -> cp_sat_forward_lex': 167 },
        by_source: { nemotron: 38, deterministic_fallback: 129 },
        objective: 'readiness_first', latest_source: 'nemotron',
        objective_why: '51 vehicles below ready-floor SoC (p10=53%); 10 attention-list assets overdue with SoC 18-99% and deploy deadlines missed by 267-512 min; 23 vehicles waiting for service (p50 wait 568 min); only 7 deployed vs target 48 (gap 41).',
        advice_applied: 167, avg_latency_ms: 23662, max_latency_ms: 77619, model_fallbacks: 129,
        last_model_error: 'HTTP 429: {"status":429,"title":"Too Man',
        last_fallback_reason: null, advice_p95_ticks_late: 22, advice_mean_ticks_late: 6.5,
      },
    },
    {
      layer: 'L3_SOLVER', name: 'Proposers', status: 'ok',
      does: 'Propose stall assignments for the kernel to dispose. CP-SAT is primary inside the site; cuOpt proposes as a fallback. Nondeterministic by nature, which is why L4 exists.',
      measured_from: 'ottoq_model_call_ledger (this run, role=proposer) + ottoq_proposer_fire_log',
      live: {
        providers: {
          cpsat_service: { calls: 167, reached: 167, answered: 9, last_call: '2026-09-23T06:26:07.120304+00:00', proposals: 13 },
        },
        primary_fires: 167, fires_this_run: 167, declared_primary: 'forward_lex', primary_reachable: true,
      },
    },
    {
      layer: 'L4_KERNEL', name: 'Deterministic disposal', status: 'none_enacted',
      does: 'Disposes every proposal. Refusing some is the point: all-enacted is a rubber stamp.',
      measured_from: 'ottoq_external_proposals',
      live: {
        rows: 466, enacted: 0, expired: 0, pending: 0, refused: 4, proposals: 13, superseded: 9, abstentions: 453,
        by_source_status: { 'forward_lex/refused': 4, 'forward_lex/abstained': 453, 'forward_lex/superseded': 9 },
        refusal_rate_pct: 31,
        top_abstain_reasons: {
          'bridge:not_due': 46,
          "outside this tick's batch of 8 most urgent ": 394,
          'the site could not serve this vehicle within its capacity': 13,
        },
        top_refusal_reasons: { stall_occupied: 2, stall_reserved: 2, entity_decided_by_other_proposal: 9 },
      },
    },
  ],
  frame_included: false,
};

// The panel now opens on the LIVE STREAM (Chase, 2026-09-21), so every
// assertion below about the layered analysis has to select that view first.
// mount() does it, rather than each test remembering to: the subject of these
// tests is what the layers render, not which tab is default, and that is
// asserted separately in "default view" below.
const mount = (over: Partial<typeof state> = {}, view: 'stream' | 'layers' = 'layers') => {
  Object.assign(state, {
    stack: null,
    frame: null,
    error: null,
    loading: false,
    frameLoading: false,
    simRunId: null,
    ...over,
  });
  const result = render(<TwinIntelligenceTab />);
  if (view === 'layers') {
    // Absent when there is no run (the panel short-circuits before the toggle).
    const toggle = screen.queryByText('Layers');
    if (toggle) fireEvent.click(toggle);
  }
  return result;
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

  // The 0351 payload above predates 0451/0456, so its shield and kernel blocks are the old shape.
  // Headlines are asserted against CURRENT, the payload the function returns today.
  it('renders the headline figures the current function derives', () => {
    mount({ simRunId: CURRENT.run!.sim_run_id!, stack: CURRENT });
    expect(screen.getByText(/329,790 evaluations · 475 refused · 494 failed · 26 rules/)).toBeTruthy();
    expect(screen.getByText(/15,359 packets · 77 assets reporting · 482 dropped/)).toBeTruthy();
    expect(screen.getByText(/13 offers · 0 enacted · 4 refused · 9 superseded · 453 abstentions/)).toBeTruthy();
    expect(screen.getByText(/167 passes · 38 answered by the model · 129 fell back/)).toBeTruthy();
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

  // The unflattering findings, current shape: fallbacks with the endpoint's own error, how stale applied
  // advice is, and a kernel that enacted none of its offers. The retracted claim that a slow agent holds
  // the tick (otto-q-core 0332) must not come back.
  it('does not bury fallbacks, staleness, or a kernel that enacted nothing', () => {
    mount({ simRunId: CURRENT.run!.sim_run_id!, stack: CURRENT });
    expect(screen.getByText(/129 of 167 passes fell back to the deterministic path/)).toBeTruthy();
    expect(screen.getByText(/advice is applied a mean of 6\.5 ticks after it was computed \(p95 22\)/)).toBeTruthy();
    expect(screen.getByText(/none of 13 offers was enacted: 9 superseded by the decide path, 4 refused/)).toBeTruthy();
    expect(screen.queryByText(/longer than one tick/)).toBeNull();
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

// ============================================================================
// The live stream. Chase, 2026-09-21: "I want more of a real time feed of
// OTTO-Q solvers almost like a live stream of comments and decisions that are
// coming through and being proposed or enacted."
//
// These assert the two things that request actually turns into: the panel opens
// on the stream rather than on grouped sections, and the layered analysis is
// still reachable rather than deleted. The layered view carries the arming
// verdict and the rank-0-proposer warning, which are measured findings — losing
// them to satisfy a layout preference would be a regression dressed as a fix.
// ============================================================================
describe('TwinIntelligenceTab default view', () => {
  it('opens on the live stream, not on the grouped layer cards', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE }, 'stream');
    expect(screen.getByText('Decisions')).toBeTruthy();
    // The layer cards are the thing that used to greet a viewer first.
    expect(screen.queryByText('Asset telemetry')).toBeNull();
  });

  it('keeps the layered analysis reachable, so no measured finding is lost', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE }, 'stream');
    expect(screen.queryByText('Asset telemetry')).toBeNull();
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.getByText('Asset telemetry')).toBeTruthy();
  });

  it('offers both views whenever a run is present', () => {
    mount({ simRunId: LIVE.run!.sim_run_id!, stack: LIVE }, 'stream');
    expect(screen.getByText('Live stream')).toBeTruthy();
    expect(screen.getByText('Layers')).toBeTruthy();
  });

  it('draws no toggle at all when there is no run to stream', () => {
    mount({}, 'stream');
    expect(screen.getByText(/No simulation is active/i)).toBeTruthy();
    expect(screen.queryByText('Live stream')).toBeNull();
  });
});
