// ============================================================================
// THE FUNNEL — every OTTO-Q decision passes through these layers, in order,
// and leaves by exactly one door.
//
//   L3  ADVISORS    cuOpt (GPU assignment), Nemotron (reasoning), deterministic
//                   heuristics. Each independently PROPOSES. None of them can
//                   emit a command; they emit intent, and nothing else.
//        ↓
//   L2  ARBITER     merges every proposal into ONE coherent plan. Resolves
//                   contention (two advisors want the same stall), dedupes,
//                   ranks, and materializes each survivor into a full command
//                   envelope with a window and a chain of custody.
//        ↓
//   L1  SHIELD      admits or removes. Cannot create or modify. (shield.ts)
//        ↓
//   L0  COMMS       one batch, one sequence, one wire. (commandBus.ts)
//        ↓
//                   the twin executes
//
// ── WHY A FUNNEL AND NOT A SWITCH ───────────────────────────────────────────
// The alternative — cuOpt writes some commands, Nemotron writes others, a rule
// engine writes a third set — is how a fleet ends up with two systems telling
// one vehicle two things. With a funnel there is exactly one place where a
// command can be born, one place where it can be vetoed, and one sequence
// number space. If a vehicle received a contradictory instruction, the batch
// that carried it is a single record you can pull up.
//
// ── DETERMINISM ─────────────────────────────────────────────────────────────
// Same run seed + same tick + same advisor set must produce the same batch.
// Advisors are therefore run in a FIXED order, proposals are sorted by a
// total order (score, then advisor id, then target id — never by arrival
// time), and command ids are content-hashed. An advisor that times out is
// recorded as absent rather than silently reordering the result.
// ============================================================================

import {
  CLASS_FOR_INTENT,
  commandId,
  simPlus,
  type CommandAuthority,
  type CommandBatch,
  type CommandIntent,
  type CommandParams,
  type CommandRecord,
  type CommandTarget,
  type OttoQCommand,
  type SuppressedCommand,
  COMMAND_CONTRACT_VERSION,
} from "./commands";
import type { ChannelBundle } from "./contracts";
import { applyShield, shieldHeadline, type ShieldConfig, type ShieldResult } from "./shield";

// ── L3: what an advisor may say ─────────────────────────────────────────────

/**
 * A proposal is an OPINION, not an instruction. It has no id, no sequence, and
 * no place on the wire. Only the arbiter can turn one into a command, and only
 * the shield can let that command out.
 */
export interface Proposal {
  intent: CommandIntent;
  target: CommandTarget;
  params: CommandParams;
  /**
   * Advisor's own ranking, higher = more valuable. Compared ACROSS advisors, so
   * advisors must score on a shared scale: roughly "expected dollars or minutes
   * saved". An advisor that scores everything 100 will win everything, which is
   * a calibration bug worth seeing.
   */
  score: number;
  /** 0..1 — how sure the advisor is. Low confidence lowers effective rank. */
  confidence?: number;
  /** plain-language justification, carried through to the operator */
  rationale: string;
  /** seconds from now the action may begin. "discharge in 20 min" → 1200 */
  start_offset_s?: number;
  /** seconds after start by which it should be done */
  duration_s?: number;
  /** overrides the default authority for this intent */
  authority?: CommandAuthority;
}

export interface Advisor {
  /** stable id — appears in provenance and in the fixed execution order */
  id: string;
  /** what this advisor is for, shown in the operator's decision trace */
  description: string;
  propose: (bundle: ChannelBundle, ctx: AdvisorContext) => Promise<Proposal[]> | Proposal[];
}

export interface AdvisorContext {
  /** commands still in flight, so an advisor does not re-propose what is done */
  openCommands: Map<string, CommandRecord>;
  /** sim clock of the frame being reasoned over */
  simClock: string | null;
}

export interface AdvisorRun {
  advisor: string;
  status: "ok" | "failed" | "timeout" | "skipped";
  proposals: number;
  duration_ms: number;
  detail: string;
}

// ── defaults per intent ─────────────────────────────────────────────────────

/**
 * How long a command stays valid if the advisor does not say. Chosen so a
 * missed command dies rather than surprising the executor much later.
 */
const DEFAULT_TTL_S: Record<string, number> = {
  "vehicle.orchestration": 15 * 60,
  "energy.orchestration": 60 * 60,
  "charger.orchestration": 30 * 60,
  "depot.orchestration": 15 * 60,
};

/**
 * Vehicle moves are ADVISORY by default: a car mid-manoeuvre gets to decline,
 * exactly as a real AV's autonomy stack would. Energy and charger ceilings are
 * DIRECTIVE because the site controller is a cooperative system under our
 * control and a refused curtailment is a compliance event, not a negotiation.
 */
const DEFAULT_AUTHORITY: Record<string, CommandAuthority> = {
  "vehicle.orchestration": "advisory",
  "energy.orchestration": "directive",
  "charger.orchestration": "directive",
  "depot.orchestration": "advisory",
};

// ── L2: the arbiter ─────────────────────────────────────────────────────────

/** Effective rank: an unconfident high score loses to a confident lower one. */
const effectiveScore = (p: Proposal) => p.score * (p.confidence ?? 1);

/**
 * Total order over proposals. Deterministic by construction — no ties are
 * broken by arrival order, because arrival order depends on network latency and
 * would make replays diverge.
 */
function compareProposals(a: ScoredProposal, b: ScoredProposal): number {
  const d = effectiveScore(b.proposal) - effectiveScore(a.proposal);
  if (d !== 0) return d;
  if (a.advisor !== b.advisor) return a.advisor.localeCompare(b.advisor);
  const at = `${a.proposal.target.kind}:${a.proposal.target.id}`;
  const bt = `${b.proposal.target.kind}:${b.proposal.target.id}`;
  if (at !== bt) return at.localeCompare(bt);
  return a.proposal.intent.localeCompare(b.proposal.intent);
}

interface ScoredProposal {
  advisor: string;
  proposal: Proposal;
}

export interface ArbiterResult {
  candidates: OttoQCommand[];
  /** proposals the arbiter dropped before the shield ever saw them */
  dropped: SuppressedCommand[];
}

/**
 * Merge every advisor's proposals into one plan.
 *
 * The arbiter resolves CONTENTION (who gets what) and only that. It does not
 * check safety — that is the shield's job, and keeping the two separate is what
 * lets the shield stay small enough to trust.
 */
export function arbitrate(
  scored: ScoredProposal[],
  bundle: ChannelBundle,
  sequenceStart: number,
): ArbiterResult {
  const ordered = [...scored].sort(compareProposals);
  const dropped: SuppressedCommand[] = [];

  // One intent per (target, intent) pair, and one assignment per stall. First
  // in the total order wins; the rest are recorded as displaced.
  const takenTargetIntent = new Set<string>();
  const takenStalls = new Map<string, string>();
  const kept: ScoredProposal[] = [];

  for (const sp of ordered) {
    const { proposal: p } = sp;
    const tiKey = `${p.target.kind}:${p.target.id}|${p.intent}`;
    if (takenTargetIntent.has(tiKey)) {
      dropped.push({
        intent: p.intent, target: p.target, advisor: sp.advisor,
        rule: "arbiter:duplicate_intent",
        detail: "a higher-ranked proposal already covers this target and intent",
      });
      continue;
    }

    const stallId = (p.params as { stall_id?: string }).stall_id;
    if (p.intent === "assign_stall" && stallId) {
      const holder = takenStalls.get(stallId);
      if (holder && holder !== p.target.id) {
        dropped.push({
          intent: p.intent, target: p.target, advisor: sp.advisor,
          rule: "arbiter:stall_contention",
          detail: `stall ${stallId} went to a higher-ranked proposal for ${holder}`,
        });
        continue;
      }
      takenStalls.set(stallId, p.target.id);
    }

    takenTargetIntent.add(tiKey);
    kept.push(sp);
  }

  const candidates = kept.map((sp, i) =>
    materialize(sp.proposal, sp.advisor, bundle, sequenceStart + i),
  );
  return { candidates, dropped };
}

/** Turn a proposal into a full command envelope. Only the arbiter does this. */
function materialize(
  p: Proposal,
  advisor: string,
  bundle: ChannelBundle,
  sequence: number,
): OttoQCommand {
  const cls = CLASS_FOR_INTENT[p.intent];
  const clock = bundle.sim_clock;
  const start = p.start_offset_s ? simPlus(clock, p.start_offset_s) : clock;
  const end = p.duration_s ? simPlus(start, p.duration_s) : null;
  const ttl = DEFAULT_TTL_S[cls] ?? 15 * 60;
  // Expiry must outlast the window, or a valid command dies before its own
  // deadline. Take the later of (start + ttl) and the window end.
  const expiryFromStart = simPlus(start, ttl) ?? simPlus(clock, ttl);
  const expires =
    end && expiryFromStart && Date.parse(end) > Date.parse(expiryFromStart)
      ? end
      : (expiryFromStart ?? new Date(Date.now() + ttl * 1000).toISOString());

  return {
    command_id: commandId(bundle.sim_run_id, bundle.tick, p.target, p.intent),
    contract_version: COMMAND_CONTRACT_VERSION,
    command_class: cls,
    intent: p.intent,
    authority: p.authority ?? DEFAULT_AUTHORITY[cls] ?? "advisory",
    sim_run_id: bundle.sim_run_id,
    tick: bundle.tick,
    issued_sim: clock ?? "",
    issued_at: bundle.emitted_at,
    sequence,
    target: p.target,
    window: { not_before_sim: start, not_after_sim: end, expires_sim: expires },
    params: p.params,
    priority: Math.round(effectiveScore(p)),
    correlation_id: `plan_${bundle.sim_run_id.slice(0, 8)}_t${bundle.tick}`,
    provenance: {
      advisor,
      layers: [`L3:${advisor}`, "L2:arbiter", "L1:shield"],
      input_tick: bundle.tick,
      input_contract_version: bundle.contract_version,
      input_bundle_status: bundle.status,
      rationale: p.rationale,
      confidence: p.confidence ?? null,
    },
    ack_required: true,
  };
}

// ── the full pass ───────────────────────────────────────────────────────────

export interface PipelineOptions {
  advisors: Advisor[];
  bundle: ChannelBundle;
  openCommands: Map<string, CommandRecord>;
  sequenceStart: number;
  shieldConfig?: Partial<ShieldConfig>;
  /** per-advisor budget; an advisor over budget is recorded as a timeout */
  advisorTimeoutMs?: number;
}

export interface PipelineResult {
  batch: CommandBatch;
  advisorRuns: AdvisorRun[];
  shield: ShieldResult;
  /** operator-readable trace of what each layer did */
  trace: string[];
}

const DEFAULT_ADVISOR_TIMEOUT_MS = 4000;

/** Race a promise against a timeout without leaving the loser unhandled. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`advisor exceeded ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Run one full decision pass. Produces a batch that is ready to transmit —
 * possibly an empty one, which is a legitimate and common outcome.
 */
export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const {
    advisors, bundle, openCommands, sequenceStart,
    shieldConfig, advisorTimeoutMs = DEFAULT_ADVISOR_TIMEOUT_MS,
  } = opts;

  const trace: string[] = [];
  const advisorRuns: AdvisorRun[] = [];
  const scored: ScoredProposal[] = [];
  const ctx: AdvisorContext = { openCommands, simClock: bundle.sim_clock };

  // ── L3 ── fixed order, isolated failures. One advisor going down must never
  // take the plan with it — that is the entire point of having several.
  for (const advisor of advisors) {
    const t0 = Date.now();
    try {
      const out = await withTimeout(Promise.resolve(advisor.propose(bundle, ctx)), advisorTimeoutMs);
      const proposals = Array.isArray(out) ? out : [];
      for (const p of proposals) scored.push({ advisor: advisor.id, proposal: p });
      advisorRuns.push({
        advisor: advisor.id, status: "ok", proposals: proposals.length,
        duration_ms: Date.now() - t0, detail: advisor.description,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      advisorRuns.push({
        advisor: advisor.id,
        status: msg.includes("exceeded") ? "timeout" : "failed",
        proposals: 0, duration_ms: Date.now() - t0, detail: msg,
      });
    }
  }
  trace.push(
    `L3 advisors: ${advisorRuns.map((r) => `${r.advisor}=${r.status}(${r.proposals})`).join(" ")}`,
  );

  // ── L2 ──
  const { candidates, dropped } = arbitrate(scored, bundle, sequenceStart);
  trace.push(
    `L2 arbiter: ${scored.length} proposal(s) → ${candidates.length} candidate(s), ${dropped.length} displaced`,
  );

  // ── L1 ──
  const shield = applyShield(candidates, { bundle, openCommands, config: shieldConfig });
  trace.push(`L1 ${shieldHeadline(shield)}`);

  // ── L0 ── assemble. Suppressions from BOTH layers ride along, so the batch
  // is a complete account of the decision, not just its survivors.
  const batch: CommandBatch = {
    batch_id: `batch_${bundle.sim_run_id.slice(0, 8)}_t${bundle.tick}`,
    contract_version: COMMAND_CONTRACT_VERSION,
    sim_run_id: bundle.sim_run_id,
    tick: bundle.tick,
    issued_sim: bundle.sim_clock ?? "",
    issued_at: bundle.emitted_at,
    sequence_start: sequenceStart,
    commands: shield.admitted,
    suppressed: [...dropped, ...shield.suppressed],
    input: {
      tick: bundle.tick,
      contract_version: bundle.contract_version,
      bundle_status: bundle.status,
      sim_clock: bundle.sim_clock,
    },
  };
  trace.push(`L0 batch ${batch.batch_id}: ${batch.commands.length} command(s) on the wire`);

  return { batch, advisorRuns, shield, trace };
}
