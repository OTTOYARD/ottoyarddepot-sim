// ============================================================================
// publicNames — the one place a viewer-facing name for a model, solver or planner is written.
//
// Chase, 2026-10-07: "I want to remove all specific tool naming from our descriptions. So for instance, I don't want to
// specifically name which Nvidia tools or specifically googles CP – SAT. But rather terms like 'leverages Nvidia open
// source model for… ' and '… State of the art lexicographers, in combination with… '". So no screen names a vendor's
// product. Each name says what the thing DOES (orders goals lexicographically, runs on a GPU, follows a heuristic), and a
// vendor appears only as the maker of the hardware or open model underneath.
//
// The engine's keys (forward_lex, cpsat_service, nvidia_cuopt, nvidia_nemotron, ...) are ids, not copy: they stay as the
// engine writes them, and only what is drawn from them changes, here. Every label map in the app reads this table, and
// publicNames.test.ts fails if a product name reaches any string on screen.
//
// That test reads the app's own strings. It cannot see a name that arrives as DATA: a model's id in the activity feed's
// `engine` column, a product named in the agent's own summary, an upstream error. Those reach the screen only through
// proposedBy() and publicText() below. Measured on otto-q-core, 2026-11-10: the feed's `engine` column carries the
// model's id on 5,304 of 9,360 agent decisions, and the agent's own words name a file of ours on 10 of them.
//
// Pure: no React, no stores, no imports. The twin carries it at src/lib/publicNames.ts and OTTO-PULSE and OrchestrAV
// carry it byte for byte at src/lib/twin/publicNames.ts, so no cockpit names a product the twin does not. Change the
// twin's copy first, then copy it.
//
// Provenance for the two vendor phrases the copy uses (checked 2026-10-07):
//   "NVIDIA open model": the agent calls nvidia/nemotron-3-ultra-550b-a55b (edge-functions/ottoq-orchestrator-agent).
//     NVIDIA publishes it with open weights, training data and recipes under the OpenMDW License v1.1:
//     https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/modelcard
//     https://research.nvidia.com/labs/nemotron/Nemotron-3-Ultra/
//   "state-of-the-art" (the lexicographic planner's solver): OR-Tools CP-SAT took gold in the Fixed, Free and Parallel
//     categories of the MiniZinc Challenge 2025: https://www.minizinc.org/challenge/2025/results
// ============================================================================

export interface PublicName {
  /** A label for a chip, a ledger row or a log line: "Lexicographic planner". */
  label: string;
  /** The same name inside a sentence, with its article: "the lexicographic planner". */
  phrase: string;
  /** The short word engraved on the planners plate: "Lexicographic". */
  lane: string;
}

const LEXICOGRAPHIC: PublicName = { label: "Lexicographic planner", phrase: "the lexicographic planner", lane: "Lexicographic" };
const GPU: PublicName = { label: "GPU planner", phrase: "the GPU planner", lane: "GPU" };
const HEURISTIC: PublicName = { label: "Heuristic planner", phrase: "the heuristic planner", lane: "Heuristic" };
const SERVICE_PRIORITY: PublicName = { label: "Service-priority planner", phrase: "the service-priority planner", lane: "Priority" };
const AGENT: PublicName = { label: "Agent", phrase: "the agent", lane: "Agent" };

/**
 * Every engine key a viewer can meet, by the name it is shown under. Two keys that are one planner share one entry:
 * forward_lex is the lexicographic planner's bridge and cpsat_service its service; cuopt, cuopt_fallback and
 * nvidia_cuopt are the GPU planner's three names in the proposals, the precedence table and the call ledger.
 */
export const PUBLIC_NAME: Readonly<Record<string, PublicName>> = {
  // proposal sources (ottoq_external_proposals.source, ottoq_proposal_disposition_ledger.source)
  forward_lex: LEXICOGRAPHIC,
  cuopt: GPU,
  cuopt_fallback: GPU,
  greedy_constrained: HEURISTIC,
  ottoq_service_priority: SERVICE_PRIORITY,
  llm_advisor: AGENT,
  // call-ledger providers (ottoq_model_call_ledger.provider, ottoq_intelligence_ledger.provider)
  cpsat_service: LEXICOGRAPHIC,
  nvidia_cuopt: GPU,
  nvidia_nemotron: AGENT,
  anthropic_advisor: { label: "Advisor", phrase: "the advisor", lane: "Advisor" },
  local_fallback: { label: "local fallback", phrase: "the local fallback", lane: "Fallback" },
  // decision engines (ottoq_decisions.l2_engine): the others a viewer can meet are named above
  nemotron: AGENT,
};

/** The lanes on the planners plate, front to back, when present. */
export const LANE_ORDER: readonly string[] = [LEXICOGRAPHIC.phrase, GPU.phrase, HEURISTIC.phrase, SERVICE_PRIORITY.phrase];

/**
 * Product names that no string on screen may carry (publicNames.test.ts scans every literal and JSX text in src). Case
 * matters on purpose: a product is written in its own case ("cuOpt", "CP-SAT"), and an engine key is lower case
 * ("nvidia_cuopt", "cpsat_service"), so the scan finds the first and never the second.
 */
export const PRODUCT_NAMES: readonly RegExp[] = [
  /Nemotron/, /cuOpt/, /CP-SAT/, /OR-Tools/, /\bOR Tools\b/, /Isaac Sim/, /Omniverse/, /\bGurobi\b/, /\bHiGHS\b/,
  /\bPuLP\b/, /\bClaude\b/, /\bAnthropic\b/, /\bGPT-\d/, /\bOpenAI\b/, /\bGemini\b/, /\bLlama\b/,
];

/** Capital first letter, for a phrase that starts a sentence. */
export const sentenceCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A key's label, or the key itself in words when the app has no name for it: never a guess, never a product. */
export function publicLabel(key: string | null | undefined): string {
  if (!key) return "";
  return PUBLIC_NAME[key]?.label ?? key.replace(/_/g, " ");
}

/** A key's name inside a sentence ("the GPU planner"), or null when the app has no name for it. */
export function publicPhrase(key: string | null | undefined): string | null {
  return (key && PUBLIC_NAME[key]?.phrase) || null;
}

/**
 * Who proposed a decision, from the activity feed's `engine` column, in public names. The engine writes one key there
 * ("forward_lex", "deterministic_v1"), or, for an agent pass, the model's id, an arrow and the providers that took the
 * hand-off ("nvidia/nemotron-3-ultra-550b-a55b -> cpsat_service+nvidia_cuopt"). A model's id is never drawn: it reads
 * "Agent". Null when the column names no model or planner this table has a name for (the decide path's own branches,
 * the challenger): the row's words already say what was decided, and an engine key is not copy.
 */
export function proposedBy(engine: string | null | undefined): string | null {
  if (!engine) return null;
  const sides = engine.split(/\s*->\s*/).map((side) => {
    const names = side.split("+").map((part) => {
      const key = part.trim();
      return key.includes("/") ? AGENT.label : PUBLIC_NAME[key]?.label ?? null; // "vendor/model" is a model's id
    }).filter((n): n is string => !!n);
    return [...new Set(names)].join(" + ");
  }).filter(Boolean);
  return sides.length ? sides.join(" → ") : null;
}

/**
 * Free text the app does not write (a model's review, an upstream error) with each product name and engine key put in
 * its public name. Ordered longest match first, so "NVIDIA cuOpt" is one replacement and not two. It names; it does not
 * rephrase, so the text around a name stays the model's own.
 */
const PUBLIC_TEXT: readonly [RegExp, string][] = [
  [/\bnvidia\/nemotron[\w./-]*/gi, "the agent model"],
  [/\b(?:NVIDIA\s+)?Nemotron(?:[\s-]*\d+)?(?:[\s-]*(?:Ultra|Super|Nano))?(?:[\s-]*\d+B(?:[\s-]*A\d+B)?)?\b/gi, "the agent model"],
  [/\bnvidia_nemotron\b/gi, "the agent model"],
  [/\s*\((?:Google\s+)?OR-Tools\)/gi, ""],
  [/\b(?:Google\s+)?(?:OR-Tools\s+)?CP-SAT\b/gi, "the lexicographic planner"],
  [/\b(?:Google\s+)?OR-Tools\b/gi, "the lexicographic planner"],
  [/\b(?:cpsat_service|forward_lex|cpsat)\b/gi, "the lexicographic planner"],
  [/\b(?:NVIDIA\s+)?cuOpt\b/gi, "the GPU planner"],
  [/\b(?:nvidia_cuopt|cuopt_fallback|cuopt)\b/gi, "the GPU planner"],
  // The agent has quoted the build brief by its file name ("per CLAUDE.md rule 9"): the rule is OTTO-Q's, the file is ours.
  [/\bCLAUDE\.md\s+(?=rule\b)/gi, ""],
  [/\bCLAUDE\.md\b/gi, "the build brief"],
];
const NAMED = "agent model|lexicographic planner|GPU planner|build brief";
export function publicText(text: string): string {
  let out = text;
  for (const [re, name] of PUBLIC_TEXT) out = out.replace(re, name);
  // "the the GPU planner" when the source text already had its own article, and a capital where a name starts a sentence
  return out.replace(/\b(the|The)\s+the\s+/g, "$1 ").replace(new RegExp(`(^|[.!?:]\\s+|\\n\\s*)the (${NAMED})\\b`, "g"), "$1The $2");
}

/** The same, for text drawn inside a sentence of ours ("…, because <text>"): a name that starts it keeps a small letter. */
export function publicTextInline(text: string): string {
  const named = publicText(text);
  return new RegExp(`^The (${NAMED})\\b`).test(named) && !/^The /.test(text) ? `t${named.slice(1)}` : named;
}
