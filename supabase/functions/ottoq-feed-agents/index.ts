// ============================================================================
// ottoq-feed-agents — the twin's GENETIC variable layer, run-activation pass.
//
// One feed-agent per registered simulation variable. At run activation each
// agent (NVIDIA Nemotron 3 Ultra) reviews its variable's EVIDENCE DOSSIER —
// the fitted real-world corpus stats PLUS the realized outcomes its previous
// plan produced in the world (a self-calibration loop) — and either keeps or
// adjusts its SAMPLING PLAN. The deterministic card engine then executes the
// plan under run-seed CRN.
//
// SAFETY DOCTRINE (mirrors the OTTO-Q shield philosophy):
//   • The model proposes; SQL disposes. Adjustments are only accepted on a
//     whitelisted set of plan paths, clamped to the plan's own hard bounds,
//     AND limited to ±30% relative drift per activation.
//   • Any failure (API down, malformed JSON, clamp violation) → deterministic
//     fallback: the current plan activates unchanged. Runs NEVER block.
//   • Every activation is recorded (ottoq_feed_activations) with the agent's
//     rationale — the provenance trail is the product.
//
// Routes:
//   POST /activate {sim_run_id, dry_run?}  → run all agents for this run
//   GET  ?sim_run_id=...                   → activations for a run (cockpit)
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const NIM = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const MAX_REL_DRIFT = 0.30; // one activation may move a numeric param at most ±30%

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function nvidiaKeys(): [string, string][] {
  const c: [string, string | undefined][] = [
    ["NEMOTRON", Deno.env.get("NVIDIA_API_KEY_NEMOTRON")],
    ["CUOPT", Deno.env.get("NVIDIA_API_KEY_CUOPT")],
    ["GENERIC", Deno.env.get("NVIDIA_API_KEY")],
  ];
  return c.filter(([, v]) => v) as [string, string][];
}

// Reasoning models wrap output in thinking text; extract the LAST parseable
// balanced-brace JSON block (strip <think> sections first).
function extractJson(content: string): any | null {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const found: any[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) {
      try { found.push(JSON.parse(cleaned.slice(start, i + 1))); } catch { /* skip */ }
      start = -1;
    } }
  }
  return found.length ? found[found.length - 1] : null;
}

// ── per-variable adjustment whitelist: path → clamp source ──
const WHITELIST: Record<string, Record<string, [number, number] | "clamp_in_plan">> = {
  charger_fault_repair: {
    "base_session_fault_p": "clamp_in_plan",
    "repair.depot_staffed_factor": "clamp_in_plan",
    "repair.mode_multipliers.fault.communication_dropout": [0.01, 2.0],
    "repair.mode_multipliers.fault.connector_cable": [0.1, 3.0],
    "repair.mode_multipliers.fault.station_hardware": [0.5, 5.0],
    "repair.mode_multipliers.fault.ground_fault_safety": [0.5, 4.0],
    "repair.mode_multipliers.fault.thermal_emergency": [0.5, 4.0],
    "repair.mode_multipliers.fault.session_aborted_other": [0.05, 2.0],
  },
};

function getPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj; let i = 0;
  while (i < parts.length) {
    if (cur == null) return undefined;
    let matched = false;
    for (let j = parts.length; j > i; j--) {
      const key = parts.slice(i, j).join(".");
      if (typeof cur === "object" && key in cur) { cur = cur[key]; i = j; matched = true; break; }
    }
    if (!matched) return undefined;
  }
  return cur;
}

function setPath(obj: any, path: string, value: number): boolean {
  const parts = path.split(".");
  let cur = obj; let i = 0;
  while (i < parts.length) {
    let matched = false;
    for (let j = parts.length; j > i; j--) {
      const key = parts.slice(i, j).join(".");
      if (typeof cur === "object" && cur != null && key in cur) {
        if (j === parts.length) { cur[key] = value; return true; }
        cur = cur[key]; i = j; matched = true; break;
      }
    }
    if (!matched) return false;
  }
  return false;
}

function clampFor(plan: any, varKey: string, path: string): [number, number] | null {
  const rule = WHITELIST[varKey]?.[path];
  if (!rule) return null;
  if (rule !== "clamp_in_plan") return rule;
  if (path === "base_session_fault_p") {
    const c = plan.base_clamp; return [Number(c?.[0] ?? 0.01), Number(c?.[1] ?? 0.3)];
  }
  if (path === "repair.depot_staffed_factor") {
    const c = plan.repair?.staffed_factor_clamp; return [Number(c?.[0] ?? 0.005), Number(c?.[1] ?? 1.0)];
  }
  return null;
}

// ── evidence dossiers: what each agent SEES (corpus truth + realized outcomes)
async function evidenceFor(sb: any, varKey: string): Promise<any> {
  if (varKey === "charger_fault_repair") {
    const [{ data: dists }, { data: sessions }, { count: downNow }] = await Promise.all([
      sb.from("ottoq_calibration_distributions")
        .select("variable_name, sample_count, mean_value, median_value, min_value, max_value, units")
        .eq("dataset_code", "charger_reliability"),
      sb.from("ocpp_sessions").select("status")
        .gt("started_at", new Date(Date.now() - 3 * 864e5).toISOString())
        .like("id_token", "TWIN-%").limit(1000),
      sb.from("ottoq_ocpp_chargers").select("charger_id", { count: "exact", head: true })
        .eq("station_state", "Faulted"),
    ]);
    const total = sessions?.length ?? 0;
    const f = (sessions ?? []).filter((s: any) => s.status === "faulted").length;
    return {
      fitted_corpus: dists ?? [],
      realized_last_3d: { sessions: total, faulted_sessions: f,
        realized_fault_rate: total ? Number((f / total).toFixed(4)) : null },
      chargers_down_now: downNow ?? 0,
    };
  }
  return {};
}

const SYS = `You are a FEED-AGENT in OTTO-TWIN, the digital twin of an autonomous-vehicle depot. You own exactly ONE simulation variable. Your job at run activation: review the fitted real-world corpus statistics and the realized outcomes your current sampling plan produced, then decide whether to keep the plan or make small, well-justified numeric adjustments.

Hard rules you operate under (enforced downstream — violations are discarded):
• You may ONLY adjust the whitelisted parameters given to you. Structural changes are not yours to make.
• Every adjustment is clamped to declared bounds and limited to ±30% drift per activation. Prefer SMALL moves with strong evidence; keeping the plan unchanged is a perfectly good decision.
• You never draw runtime randomness — the deterministic card engine executes your plan under common-random-number discipline.
Respond with STRICT JSON only, no prose outside the JSON.`;

async function runAgent(sb: any, keys: [string, string][], run: any, planRow: any, dryRun: boolean) {
  const varKey = planRow.var_key;
  const t0 = Date.now();
  const evidence = await evidenceFor(sb, varKey);
  const whitelist = Object.keys(WHITELIST[varKey] ?? {});

  const prompt = `VARIABLE: ${varKey}
RUN: scenario=${run.scenario_code}, seed=${run.random_seed}
CURRENT PLAN (v${planRow.version}, authored_by=${planRow.authored_by}):
${JSON.stringify(planRow.plan, null, 2)}
PLAN PROVENANCE (sources + declared assumptions):
${JSON.stringify(planRow.provenance, null, 2)}
EVIDENCE DOSSIER (fitted corpus + realized outcomes of the current plan):
${JSON.stringify(evidence, null, 2)}
ADJUSTABLE PARAMETERS (whitelist): ${JSON.stringify(whitelist)}

Decide: keep the plan, or adjust whitelisted parameters. Consider whether the realized fault rate matches base_session_fault_p (sampling noise on small counts is expected — do not overreact), and whether the declared assumptions remain defensible.
Return STRICT JSON:
{"keep_plan": boolean, "adjustments": {"<whitelisted.path>": number, ...}, "run_notes": "one sentence for this run's activation record", "rationale": "2-4 sentences of reasoning grounded ONLY in the numbers above"}`;

  let verdict: any = null; let model = "fallback"; let note = "";
  try {
    const body = JSON.stringify({ model: MODEL,
      messages: [{ role: "system", content: SYS }, { role: "user", content: prompt }],
      temperature: 0.2, top_p: 0.9, max_tokens: 1400, stream: false });
    let res: Response | null = null; let raw = "";
    for (const [, key] of keys) {
      res = await fetch(NIM, { method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, body });
      raw = await res.text();
      if (res.status !== 401 && res.status !== 403) break;
    }
    if (res?.ok) {
      let content = "";
      try { content = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ""; }
      catch { note = `NIM body non-JSON: ${raw.slice(0, 120)}`; }
      if (content) {
        verdict = extractJson(content);
        if (verdict) model = MODEL;
        else note = `no parseable JSON in model output: ${content.slice(0, 160)}`;
      }
    } else note = `nemotron HTTP ${res?.status}: ${raw.slice(0, 160)}`;
  } catch (e) { note = `nemotron error: ${e instanceof Error ? e.message : e}`; }

  // ── validate + apply (model proposes, this code disposes) ──
  let planId = planRow.plan_id;
  let applied: Record<string, { from: number; to: number }> = {};
  const rejected: Record<string, string> = {};
  if (verdict && verdict.keep_plan === false && verdict.adjustments && typeof verdict.adjustments === "object") {
    const newPlan = JSON.parse(JSON.stringify(planRow.plan));
    for (const [path, valRaw] of Object.entries(verdict.adjustments)) {
      const val = Number(valRaw);
      if (!whitelist.includes(path)) { rejected[path] = "not whitelisted"; continue; }
      if (!isFinite(val)) { rejected[path] = "not a number"; continue; }
      const cur = Number(getPath(newPlan, path));
      if (!isFinite(cur)) { rejected[path] = "current value unresolvable"; continue; }
      const clamp = clampFor(planRow.plan, varKey, path);
      let v = val;
      if (clamp) v = Math.min(Math.max(v, clamp[0]), clamp[1]);
      const lo = cur * (1 - MAX_REL_DRIFT), hi = cur * (1 + MAX_REL_DRIFT);
      v = Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));
      if (Math.abs(v - cur) / (Math.abs(cur) || 1) < 1e-6) { rejected[path] = "no effective change after clamps"; continue; }
      if (setPath(newPlan, path, Number(v.toFixed(6)))) applied[path] = { from: cur, to: Number(v.toFixed(6)) };
      else rejected[path] = "path set failed";
    }
    if (Object.keys(applied).length > 0 && !dryRun) {
      const { data: inserted, error } = await sb.from("ottoq_feed_plans").insert({
        var_key: varKey, version: planRow.version + 1, status: "active", method: planRow.method,
        plan: newPlan, provenance: planRow.provenance, authored_by: "nemotron-3-ultra",
        rationale: String(verdict.rationale ?? "").slice(0, 2000),
      }).select("plan_id").single();
      if (!error && inserted) {
        await sb.from("ottoq_feed_plans").update({ status: "superseded" }).eq("plan_id", planRow.plan_id);
        planId = inserted.plan_id;
      } else { note = `plan insert failed: ${error?.message}`; applied = {}; }
    }
  }

  const agentNotes = [
    verdict?.run_notes ? String(verdict.run_notes).slice(0, 400) : null,
    Object.keys(applied).length ? `applied: ${JSON.stringify(applied)}` : "plan kept",
    Object.keys(rejected).length ? `rejected: ${JSON.stringify(rejected)}` : null,
    verdict?.rationale ? `rationale: ${String(verdict.rationale).slice(0, 800)}` : null,
    note || null,
    `latency_ms: ${Date.now() - t0}`,
  ].filter(Boolean).join(" | ");

  if (!dryRun) {
    await sb.from("ottoq_feed_activations").upsert({
      sim_run_id: run.sim_run_id, var_key: varKey, plan_id: planId,
      agent_model: model, agent_notes: agentNotes,
    }, { onConflict: "sim_run_id,var_key" });
  }
  return { var_key: varKey, agent_model: model, applied, rejected, notes: agentNotes };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (req.method === "GET") {
      const runId = new URL(req.url).searchParams.get("sim_run_id");
      if (!runId) return json({ error: "sim_run_id required" }, 400);
      const { data } = await sb.from("ottoq_feed_activations")
        .select("var_key, agent_model, agent_notes, activated_at, plan_id")
        .eq("sim_run_id", runId).order("activated_at");
      return json({ activations: data ?? [] });
    }

    const { sim_run_id, dry_run = false } = await req.json();
    if (!sim_run_id) return json({ error: "sim_run_id required" }, 400);

    const { data: run } = await sb.from("ottoq_sim_runs")
      .select("sim_run_id, scenario_code, random_seed").eq("sim_run_id", sim_run_id).single();
    if (!run) return json({ error: "run not found" }, 404);

    const { data: plans } = await sb.from("ottoq_feed_plans")
      .select("*").eq("status", "active").order("var_key");
    if (!plans || plans.length === 0) return json({ error: "no active feed plans registered" }, 404);

    const keys = nvidiaKeys(); // empty → every agent falls back deterministically
    const results = await Promise.all(plans.map((p: any) => runAgent(sb, keys, run, p, dry_run)));
    return json({ sim_run_id, dry_run, agents: results.length, results, model: MODEL });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
