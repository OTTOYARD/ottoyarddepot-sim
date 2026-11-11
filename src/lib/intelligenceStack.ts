// ============================================================================
// intelligenceStack — the typed shape of otto-q-core's ottoq_intelligence_stack.
//
// Data contract: otto-q-core migration
//   0351_the_intelligence_layers_are_real_and_nothing_assembles_them_into_a_stack.sql
//     public.ottoq_intelligence_stack(p_sim_run_id uuid,
//                                     p_include_frame boolean DEFAULT true)
//
// Five layers in SIGNAL ORDER:
//
//   L0_INGRESS  what the assets pushed          ottoq_telemetry_packets
//   L1_SHIELD   which actions are feasible      ottoq_rule_evaluations
//   L2_AGENT    reads frame, picks objective    ottoq_decisions
//   L3_SOLVER   proposes                        ottoq_model_call_ledger (this run)
//   L4_KERNEL   disposes                        ottoq_external_proposals
//
// Types only. useIntelligenceStack polls the function, and the OTTO-Q tab and the Agent tab read what they need from
// `layers[].live`. This file also held the old Intelligence panel's formatters (headlines, caveats, status tones). No
// screen has drawn that panel since 2026-09-30, and they were removed with its source on 2026-11-10 (the last commit
// that holds them is cdaaf24).
//
// `live` is the engine's own block per layer, with the engine's own keys: a model's id in `live.model`, solver keys in
// `live.by_source`, `live.handoff` and `live.providers`. Never draw one as it comes. Name it through
// src/lib/publicNames.ts (no vendor product on screen, Chase 2026-10-07).
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
