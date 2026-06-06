// ============================================================================
// ottoq-nemotron-copilot — OTTO-Q's agentic decision auditor (Layer-4 CIL seed).
// Reads OTTO-Q's real decision log + shield interventions for a run, summarizes them,
// and has NVIDIA Nemotron 3 Ultra explain what the depot AI did, judge whether the
// safety-shield overrides were warranted, flag risk patterns, and propose concrete
// improvements. This is the agentic layer living IN OTTO-Q (reasoning over its own
// decisions), distinct from the deterministic shield/optimizer.
// Input: { sim_run_id, limit? }.  Output: { analysis, summary, model }.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const NIM = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const SYS = `You are OTTO-Q's orchestration auditor — the Layer-4 continuous-improvement agent for an autonomous AV/EV depot's decision engine. OTTO-Q uses a Simplex/runtime-assurance design: an L2 optimizer proposes actions, a deterministic L1 safety shield (28 rules) can override any proposal to a safe default, and you audit the results. Be specific, technical, and concise. Never invent numbers — reason only from the provided summary.`;

function summarize(rows: any[]) {
  const byCtx: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const overrideRules: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let overridden = 0, enacted = 0;
  for (const r of rows) {
    byCtx[r.action_context] = (byCtx[r.action_context] || 0) + 1;
    byOutcome[r.outcome_status] = (byOutcome[r.outcome_status] || 0) + 1;
    if (r.overridden) { overridden++; for (const c of (r.override_rule_codes || [])) overrideRules[c] = (overrideRules[c] || 0) + 1; }
    if (r.outcome_status === "enacted") enacted++;
    const src = r.proposed_action?.source; if (src) bySource[src] = (bySource[src] || 0) + 1;
  }
  return { total: rows.length, enacted, overridden, by_context: byCtx, by_outcome: byOutcome, top_override_rules: overrideRules, by_proposal_source: bySource };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { sim_run_id, limit = 80 } = await req.json();
    if (!sim_run_id) return json({ error: "sim_run_id required" }, 400);
    const keyCandidates: [string, string | undefined][] = [
      ["NEMOTRON", Deno.env.get("NVIDIA_API_KEY_NEMOTRON")],
      ["CUOPT", Deno.env.get("NVIDIA_API_KEY_CUOPT")],
      ["GENERIC", Deno.env.get("NVIDIA_API_KEY")],
    ];
    const keys = keyCandidates.filter(([, v]) => v) as [string, string][];
    if (keys.length === 0) return json({ error: "no NVIDIA key set" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows } = await sb.from("ottoq_decisions")
      .select("action_context, outcome_status, overridden, override_rule_codes, proposed_action")
      .eq("sim_run_id", sim_run_id).order("created_at", { ascending: false }).limit(limit);
    if (!rows || rows.length === 0) return json({ error: "no decisions for this run yet" }, 404);

    const summary = summarize(rows);
    // include the A/B score if this run was graded
    const { data: ab } = await sb.from("ottoq_ab_runs")
      .select("policy, productive_deploys, unsafe_deploys, safety_violations, fleet_ready_pct")
      .eq("sim_run_id", sim_run_id).maybeSingle();

    const prompt = `Recent OTTO-Q decision summary for sim run ${sim_run_id} (last ${summary.total} decisions):
${JSON.stringify(summary, null, 2)}
${ab ? `\nGraded outcome for this run:\n${JSON.stringify(ab, null, 2)}` : ""}

Produce:
1. A plain-English summary of what OTTO-Q did this window.
2. Why the safety shield intervened (cite the override rule codes) and whether those overrides look warranted.
3. Any risk or inefficiency patterns you see.
4. 2-3 concrete, specific improvements to the L2 policy or the test scenarios.`;

    const reqBody = JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYS }, { role: "user", content: prompt }],
      temperature: 0.4, top_p: 0.95, max_tokens: 1100, stream: false,
    });
    let res: Response | null = null, raw = "", usedKey: string | null = null;
    for (const [name, key] of keys) {
      res = await fetch(NIM, { method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, body: reqBody });
      raw = await res.text();
      if (res.status !== 401 && res.status !== 403) { usedKey = name; break; }  // auth ok (or non-auth error) — stop trying keys
    }
    if (!res || !res.ok)
      return json({ error: "nemotron HTTP " + (res?.status ?? "?") + ": " + raw.slice(0, 300), summary, tried_keys: keys.map((k) => k[0]) }, 502);
    let result: any; try { result = JSON.parse(raw); } catch { return json({ error: "nemotron non-JSON: " + raw.slice(0, 200), summary }, 502); }
    const analysis = result?.choices?.[0]?.message?.content ?? "";
    return json({ analysis, summary, ab_score: ab ?? null, model: MODEL, auth_key: usedKey });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
